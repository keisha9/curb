// Brain tools (docs/05 section 7) and the scripted brain.
// Both the Claude loop and the scripted fallback act only through executeTool, so the
// same guardrails and the same decision log apply to either.

import type Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { BrainContext } from "../brainData";
import { APP_NAME_SPOKEN } from "../../shared/config";
import { evaluateDelay, paperworkStatus, urgentRideObligation } from "./policy";
import { placeCall, sendSms, type PlaceCallResult } from "./outbound";
import {
  formatDateTime,
  formatWindow,
  renderSms,
  SMS_TEMPLATE_NAMES,
  statusText,
  type Lang,
  type SmsTemplate,
} from "./wording";

export type BrainTrigger = "new_request" | "call_ended" | "delay_reported" | "ineligible";

export const MAX_BROKER_CALLS_PER_TRIGGER = 2;

export type BrainRun = {
  ctx: ActionCtx;
  rideId: Id<"rides">;
  trigger: BrainTrigger;
  callId?: Id<"calls">;
  delayReportId?: Id<"delayReports">;
  brokerCalls: number;
  smsThisRun: Set<string>;
  /** Count of actions with outside effects (calls, texts); used to decide if a fallback is safe. */
  sideEffects: number;
};

export type ToolResult = { ok: boolean; result: unknown };

type Context = BrainContext;

async function loadContext(run: BrainRun): Promise<BrainContext | null> {
  return await run.ctx.runQuery(internal.brainData.getContext, { rideId: run.rideId });
}

/** Templates sent at most once per ride. Delay texts can repeat as new reports come in. */
const ONCE_PER_RIDE: SmsTemplate[] = ["booked", "replacement", "ineligible", "needs_human"];
const LINK_TEMPLATES: SmsTemplate[] = ["booked", "delay_update", "replacement"];

// ---------------------------------------------------------------------------
// Tool definitions for Claude
// ---------------------------------------------------------------------------

const noArgs = { type: "object" as const, properties: {}, additionalProperties: false };

export const BRAIN_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_ride",
    description: "Returns the ride, member, broker, calls with their outcomes, and SMS templates already sent.",
    input_schema: noArgs,
  },
  {
    name: "check_paperwork",
    description: "Runs the deterministic paperwork policy for the ride's appointment. Read-only.",
    input_schema: noArgs,
  },
  {
    name: "get_delay_reports",
    description: "Returns delay reports for the ride with who reported, channel, and the stored policy evaluation (authoritative).",
    input_schema: noArgs,
  },
  {
    name: "evaluate_delay",
    description: "Re-runs the deterministic delay policy for one report. Read-only; the stored evaluation is authoritative.",
    input_schema: {
      type: "object",
      properties: { reportId: { type: "string" } },
      required: ["reportId"],
      additionalProperties: false,
    },
  },
  {
    name: "place_broker_call",
    description:
      "Places a phone call to the plan's broker. mode=booking books the confirmed ride; mode=delay_recovery checks on a late driver and, if the policy requires it, asks for an urgent replacement. Returns once the call is placed; the result arrives later as a call_ended trigger.",
    input_schema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["booking", "delay_recovery"] } },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    name: "place_rider_callback",
    description: "Calls the rider with the current update (replacement ride, new ETA, or that a person will help). The wording comes from recorded fields.",
    input_schema: noArgs,
  },
  {
    name: "send_sms",
    description:
      "Texts the rider using a fixed template in their language, filled from recorded fields only. booked: ride confirmed. delay_received: we got the rider's delay report. delay_update: new ETA, no replacement. replacement: urgent replacement booked. needs_human: a person will help. ineligible: paperwork needs renewal.",
    input_schema: {
      type: "object",
      properties: { template: { type: "string", enum: SMS_TEMPLATE_NAMES } },
      required: ["template"],
      additionalProperties: false,
    },
  },
  {
    name: "record_decision",
    description: "Writes a one-sentence decision to the ops decision log. Call before each action.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "flag_needs_human",
    description: "Escalates the ride to a person and stops automated handling.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

function str(input: unknown, key: string): string | undefined {
  const v = (input as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : undefined;
}

function fail(error: string): ToolResult {
  return { ok: false, result: { error } };
}

function rideLang(c: Context): Lang {
  return c.ride.language;
}

export function summarizeContext(c: Context) {
  const lang = "en";
  const r = c.ride;
  return {
    ride: {
      id: r._id,
      status: r.status,
      riderConfirmed: r.riderConfirmedAt !== undefined,
      language: r.language,
      appointment: r.appointmentAt ? formatDateTime(r.appointmentAt, lang) : null,
      appointmentType: r.appointmentType ?? null,
      destinationName: r.destinationName ?? null,
      confirmationNumber: r.brokerConfirmationNumber ?? null,
      pickupWindow: formatWindow(r.pickupWindowStart, r.pickupWindowEnd, lang) || null,
      estimatedPickup: r.estimatedPickupAt ? formatDateTime(r.estimatedPickupAt, lang) : null,
      replacementConfirmationNumber: r.replacementConfirmationNumber ?? null,
      replacementWindow: formatWindow(r.replacementWindowStart, r.replacementWindowEnd, lang) || null,
      needsHuman: r.needsHuman,
    },
    member: c.member ? { firstName: c.member.name.split(" ")[0], plan: c.member.plan, mobility: c.member.mobility } : null,
    broker: c.broker ? { name: c.broker.name } : null,
    calls: c.calls.map((call) => ({
      id: call._id,
      role: call.role,
      status: call.status,
      policyAction: call.policyAction ?? null,
      outcome: call.outcome?.result ?? null,
      refusalReason: call.outcome?.refusalReason ?? null,
    })),
    bookingCallsMade: c.calls.filter((call) => call.role === "broker_booking").length,
    smsTemplatesSent: c.smsTemplatesSent,
  };
}

function summarizeReports(c: Context) {
  return c.reports.map((r) => ({
    id: r._id,
    reportedBy: r.reportedBy,
    channel: r.channel,
    delayMinutes: r.delayMinutes ?? null,
    ignored: r.ignoredReason ?? null,
    evaluation: r.evaluation ?? null,
    handled: r.handledAt !== undefined,
  }));
}

/** The delay report this run is about: the trigger's report, else the latest evaluated one. */
function currentReport(run: BrainRun, c: Context): Doc<"delayReports"> | undefined {
  if (run.delayReportId) return c.reports.find((r) => r._id === run.delayReportId);
  return [...c.reports].reverse().find((r) => r.evaluation);
}

function brokerVariables(
  c: Context,
  mode: "booking" | "delay_recovery",
  policyAction: string,
  report: Doc<"delayReports"> | undefined,
): Record<string, string> {
  const r = c.ride;
  const m = c.member!;
  const reporter = report?.reportedBy ?? "rider";
  return {
    appName: APP_NAME_SPOKEN,
    now: formatDateTime(Date.now(), "en"),
    mode,
    mode_phrase: mode === "booking" ? "book a ride" : "follow up on a late ride",
    memberName: m.name,
    medicalId: m.medicalId,
    plan: m.plan,
    pickupAddress: r.pickupAddress ?? m.address,
    destinationName: r.destinationName ?? "",
    destinationAddress: r.destinationAddress ?? "",
    appointmentAt: r.appointmentAt ? formatDateTime(r.appointmentAt, "en") : "",
    mobility: r.mobilitySnapshot ?? m.mobility,
    confirmationNumber: r.brokerConfirmationNumber ?? "",
    originalWindow: formatWindow(r.pickupWindowStart, r.pickupWindowEnd, "en"),
    delayReportedBy: reporter,
    delayReporterPhrase:
      reporter === "rider"
        ? "the member reports the driver has not arrived"
        : "your company reported the driver is running late",
    delayMinutes: report?.delayMinutes !== undefined ? String(report.delayMinutes) : "",
    policyAction,
    obligationText: urgentRideObligation("en"),
  };
}

function callbackUpdate(c: Context): { outcome: string; text: string } | null {
  const r = c.ride;
  const lang = rideLang(c);
  switch (r.status) {
    case "replacement_booked":
      return {
        outcome: "replacement_booked",
        text: `${statusText("replacement_booked", lang, r)} ${lang === "es" ? "Confirmación" : "Confirmation"} ${r.replacementConfirmationNumber ?? ""}.`,
      };
    case "delayed":
      return { outcome: "delay_update", text: statusText("delayed", lang, r) };
    case "needs_human":
      return { outcome: "needs_human", text: statusText("needs_human", lang, r) };
    default:
      return null;
  }
}

async function portalLink(run: BrainRun, memberId: Id<"members">): Promise<string | undefined> {
  const base = process.env.PORTAL_BASE_URL;
  if (!base) return undefined;
  const raw = await run.ctx.runMutation(internal.portal.issueToken, { memberId });
  return `${base.replace(/\/$/, "")}/trips?t=${raw}`;
}

export async function executeTool(run: BrainRun, name: string, input: unknown): Promise<ToolResult> {
  const { ctx, rideId } = run;
  const c = await loadContext(run);
  if (!c || !c.member) return fail("ride or member not found");

  let out: ToolResult;
  switch (name) {
    case "get_ride":
      out = { ok: true, result: summarizeContext(c) };
      break;

    case "check_paperwork":
      out = { ok: true, result: paperworkStatus(c.member, c.ride.appointmentAt ?? Date.now()) };
      break;

    case "get_delay_reports":
      out = { ok: true, result: summarizeReports(c) };
      break;

    case "evaluate_delay": {
      const report = c.reports.find((r) => r._id === str(input, "reportId"));
      out = report ? { ok: true, result: evaluateDelay(c.ride, report, Date.now()) } : fail("report not found");
      break;
    }

    case "place_broker_call": {
      const mode = str(input, "mode");
      if (mode !== "booking" && mode !== "delay_recovery") {
        out = fail("mode must be booking or delay_recovery");
        break;
      }
      if (run.brokerCalls >= MAX_BROKER_CALLS_PER_TRIGGER) {
        out = fail(`limit of ${MAX_BROKER_CALLS_PER_TRIGGER} broker calls per trigger reached`);
        break;
      }
      if (!c.broker) {
        out = fail("no broker configured for this member's plan");
        break;
      }
      let policyAction: string;
      let report: Doc<"delayReports"> | undefined;
      if (mode === "booking") {
        const gate = await ctx.runMutation(internal.brainData.beginBookingCall, { rideId });
        if (!gate.ok) {
          out = fail(gate.error);
          break;
        }
        policyAction = "booking";
      } else {
        report = currentReport(run, c);
        const gate = await ctx.runMutation(internal.brainData.beginDelayCall, { rideId, delayReportId: report?._id });
        if (!gate.ok) {
          out = fail(gate.error);
          break;
        }
        policyAction = gate.policyAction;
      }
      const fresh = (await loadContext(run))!;
      run.brokerCalls += 1;
      run.sideEffects += 1;
      const placed: PlaceCallResult = await placeCall(ctx, {
        rideId,
        role: mode === "booking" ? "broker_booking" : "broker_delay",
        to: c.broker.phone,
        variableValues: brokerVariables(fresh, mode, policyAction, report),
        brokerId: c.broker._id,
        memberId: c.member._id,
        language: "en",
        policyAction,
        delayReportId: report?._id,
      });
      out = placed.ok
        ? { ok: true, result: { callId: placed.callId, stubbed: placed.stubbed, policyAction, note: "Call placed. Stop here; the outcome arrives as a call_ended trigger." } }
        : fail(`call failed: ${placed.error}`);
      break;
    }

    case "place_rider_callback": {
      const update = callbackUpdate(c);
      if (!update) {
        out = fail(`no rider update to give while the ride is ${c.ride.status}`);
        break;
      }
      run.sideEffects += 1;
      const lang = rideLang(c);
      const placed: PlaceCallResult = await placeCall(ctx, {
        rideId,
        role: "rider_callback",
        to: c.member.phone,
        memberId: c.member._id,
        language: lang,
        variableValues: {
          appName: APP_NAME_SPOKEN,
          memberName: c.member.name,
          language: lang,
          outcome: update.outcome,
          updateText: update.text,
          windowText: formatWindow(c.ride.replacementWindowStart ?? c.ride.pickupWindowStart, c.ride.replacementWindowEnd ?? c.ride.pickupWindowEnd, lang),
          reportedBy: currentReport(run, c)?.reportedBy ?? "",
        },
      });
      out = placed.ok ? { ok: true, result: { callId: placed.callId, stubbed: placed.stubbed } } : fail(`callback failed: ${placed.error}`);
      break;
    }

    case "send_sms": {
      const template = str(input, "template") as SmsTemplate | undefined;
      if (!template || !SMS_TEMPLATE_NAMES.includes(template)) {
        out = fail(`template must be one of ${SMS_TEMPLATE_NAMES.join(", ")}`);
        break;
      }
      if (run.smsThisRun.has(template) || (ONCE_PER_RIDE.includes(template) && c.smsTemplatesSent.includes(template))) {
        out = { ok: true, result: { skipped: `${template} text was already sent` } };
        break;
      }
      const lang = rideLang(c);
      const link = LINK_TEMPLATES.includes(template) ? await portalLink(run, c.member._id) : undefined;
      const rendered = renderSms(template, lang, {
        ...c.ride,
        destination: c.ride.destinationName,
        confirmationNumber: c.ride.brokerConfirmationNumber,
        replacementConfirmationNumber: c.ride.replacementConfirmationNumber,
        link,
      });
      if (!rendered.ok) {
        out = fail(`cannot send ${template}: ${rendered.missing} is not recorded`);
        break;
      }
      run.smsThisRun.add(template);
      run.sideEffects += 1;
      const sent = await sendSms(ctx, { rideId, memberId: c.member._id, to: c.member.phone, body: rendered.body, language: lang, template });
      out = sent.ok ? { ok: true, result: { sent: true, stubbed: sent.stubbed } } : fail(`sms failed: ${sent.error}`);
      break;
    }

    case "record_decision": {
      const text = str(input, "text");
      if (!text) {
        out = fail("text is required");
        break;
      }
      await ctx.runMutation(internal.brainData.recordDecision, { rideId, text: text.slice(0, 500) });
      out = { ok: true, result: { recorded: true } };
      break;
    }

    case "flag_needs_human": {
      const reason = str(input, "reason") ?? "unspecified";
      await ctx.runMutation(internal.brainData.flagNeedsHuman, { rideId, reason: reason.slice(0, 500) });
      out = { ok: true, result: { flagged: true } };
      break;
    }

    default:
      out = fail(`unknown tool ${name}`);
  }

  if (!["get_ride", "check_paperwork", "get_delay_reports", "evaluate_delay", "record_decision"].includes(name)) {
    await ctx.runMutation(internal.events.log, {
      rideId,
      kind: out.ok ? "tool_call" : "error",
      summary: `Brain ${name}${input && Object.keys(input as object).length ? ` ${JSON.stringify(input)}` : ""}: ${out.ok ? "ok" : (out.result as { error: string }).error}`,
      payload: { input, result: out.result },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scripted brain: the trigger table from docs/05 section 7, deterministic.
// Used when no API key is set, when BRAIN_MODE=scripted, and as the fallback when the
// Claude run fails before taking any action.
// ---------------------------------------------------------------------------

export async function runScripted(run: BrainRun): Promise<void> {
  const decide = (text: string) => executeTool(run, "record_decision", { text });
  const sms = (template: SmsTemplate) => executeTool(run, "send_sms", { template });
  const humanAndTell = async (reason: string) => {
    await decide(`Escalating to a person: ${reason}`);
    await executeTool(run, "flag_needs_human", { reason });
    await sms("needs_human");
  };

  const c = await loadContext(run);
  if (!c) return;
  const ride = c.ride;

  switch (run.trigger) {
    case "ineligible":
      await decide("Paperwork is not valid for this appointment; texting the rider how to renew.");
      await sms("ineligible");
      return;

    case "new_request": {
      await decide(`Rider confirmed the ride; calling ${c.broker?.name ?? "the broker"} to book it.`);
      const res = await executeTool(run, "place_broker_call", { mode: "booking" });
      if (!res.ok) await humanAndTell(`could not place the booking call (${(res.result as { error: string }).error})`);
      return;
    }

    case "delay_reported": {
      const report = currentReport(run, c);
      const action = report?.evaluation?.action;
      if (!report || !action) return;
      switch (action) {
        case "request_urgent_replacement":
        case "verify_with_broker": {
          if (report.reportedBy === "rider") await sms("delay_received");
          await decide(
            action === "request_urgent_replacement"
              ? `Policy says the urgent-ride obligation applies (${report.evaluation!.reasonCode}); calling the broker for a replacement.`
              : "Driver not here yet but within the threshold; calling the broker for driver status only.",
          );
          const res = await executeTool(run, "place_broker_call", { mode: "delay_recovery" });
          if (!res.ok) await humanAndTell(`could not place the delay call (${(res.result as { error: string }).error})`);
          return;
        }
        case "notify_rider_only":
          await decide("Delay is within the threshold; texting the rider the new ETA, no replacement requested.");
          await sms("delay_update");
          return;
        case "escalate_to_human":
          await humanAndTell("the replacement ride is also delayed");
          return;
        case "reject":
          return;
      }
      return;
    }

    case "call_ended": {
      const call = c.calls.find((x) => x._id === run.callId);
      if (!call) return;

      if (call.role === "rider_callback") {
        await decide("Rider callback finished; nothing more to do.");
        return;
      }

      if (call.role === "broker_booking") {
        if (ride.status === "booked") {
          await decide(`Booking confirmed (${ride.brokerConfirmationNumber}); texting the rider.`);
          await sms("booked");
          return;
        }
        const attempts = c.calls.filter((x) => x.role === "broker_booking").length;
        if (ride.status === "calling_broker" && attempts < 2 && call.outcome?.result !== "refused") {
          await decide("Booking call ended without a confirmation; trying the broker once more.");
          const res = await executeTool(run, "place_broker_call", { mode: "booking" });
          if (res.ok) return;
        }
        if (ride.status !== "needs_human") {
          await humanAndTell(call.outcome?.result === "refused" ? `broker refused: ${call.outcome.refusalReason ?? "no reason"}` : "booking not confirmed after the broker call");
        } else {
          await sms("needs_human");
        }
        return;
      }

      // broker_delay or broker_inbound
      switch (ride.status) {
        case "replacement_booked":
          await decide(`Replacement ride confirmed (${ride.replacementConfirmationNumber}); calling and texting the rider.`);
          await executeTool(run, "place_rider_callback", {});
          await sms("replacement");
          return;
        case "delayed":
          await decide("Broker gave a new ETA within the threshold; texting the rider the update.");
          await sms("delay_update");
          return;
        case "late":
        case "recovery_calling":
          if (call.role === "broker_inbound") {
            await decide("Broker reported a delay past the threshold but no replacement was arranged on that call; calling the broker back for one.");
            const res = await executeTool(run, "place_broker_call", { mode: "delay_recovery" });
            if (!res.ok) await humanAndTell(`could not place the recovery call (${(res.result as { error: string }).error})`);
          } else {
            await humanAndTell("the broker did not confirm an urgent replacement");
          }
          return;
        case "needs_human":
          await decide("Ride needs a person; making sure the rider was told.");
          await sms("needs_human");
          return;
        case "booked": {
          if (call.role === "broker_inbound") {
            const onCall = [...c.reports].reverse().find((r) => r.callId === call._id && r.evaluation);
            if (onCall?.evaluation?.action === "verify_with_broker") {
              await decide("Broker reported a late driver but gave no time; calling the broker back for the driver's status.");
              const res = await executeTool(run, "place_broker_call", { mode: "delay_recovery" });
              if (!res.ok) await humanAndTell(`could not place the status call (${(res.result as { error: string }).error})`);
            } else {
              await decide("Broker call-in ended without a delay on record; nothing to do.");
            }
            return;
          }
          await humanAndTell(
            call.outcome?.result === "refused"
              ? `broker refused: ${call.outcome.refusalReason ?? "no reason"}`
              : "status check with the broker gave no new information",
          );
          return;
        }
        default:
          await decide(`Call ended while the ride is ${ride.status}; no action.`);
          return;
      }
    }
  }
}
