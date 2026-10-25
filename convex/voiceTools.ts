// Backing mutations for every voice-agent tool (docs/04 section 1.2) plus inbound call routing.
// They only write, run pure policy, and schedule; they never run the brain inline, so
// they return well under a second. Each returns `say`: guidance the assistant speaks from.

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { vLang, vMobility } from "./schema";
import { logEvent } from "./events";
import { createCall } from "./calls";
import { activeRideForMember, rideByConfirmation, transitionRide } from "./rides";
import { reportDelay, type DelayReportResult } from "./delays";
import { paperworkStatus, urgentRideObligation, daysUntilExpiry, normalizeConfirmation } from "./lib/policy";
import { parseLocalIso } from "./lib/time";
import { canTransition } from "./lib/stateMachine";
import { formatDateTime, formatNowForAgent, formatWindow, statusText } from "./lib/wording";

type CallRole = Doc<"calls">["role"];
const RIDER_ROLES: CallRole[] = ["rider_inbound", "rider_callback"];
const BROKER_ROLES: CallRole[] = ["broker_booking", "broker_delay", "broker_inbound"];

async function requireCall(ctx: MutationCtx, callId: Id<"calls">, roles: CallRole[]): Promise<Doc<"calls">> {
  const call = await ctx.db.get(callId);
  if (!call) throw new Error(`call ${callId} not found`);
  if (!roles.includes(call.role)) throw new Error(`tool not allowed on a ${call.role} call`);
  return call;
}

async function logTool(ctx: MutationCtx, rideId: Id<"rides"> | undefined, name: string, args: unknown, say: string) {
  await logEvent(ctx, { rideId, kind: "tool_call", summary: `Voice tool ${name}`, payload: { args, say } });
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

// ---------------------------------------------------------------------------
// Inbound routing (assistant-request)
// ---------------------------------------------------------------------------

/** Create the call row and decide which assistant answers, by caller number. Never creates a ride. */
export const routeInbound = internalMutation({
  args: { externalCallId: v.string(), callerNumber: v.string() },
  handler: async (ctx, { externalCallId, callerNumber }) => {
    // The call-started event and identify_caller can both route the same call. Match by provider
    // id, else by a live inbound call from the same number in the last few minutes.
    const existing =
      (await ctx.db
        .query("calls")
        .withIndex("by_externalCallId", (q) => q.eq("externalCallId", externalCallId))
        .first()) ??
      (await ctx.db
        .query("calls")
        .withIndex("by_from", (q) => q.eq("fromNumber", callerNumber))
        .order("desc")
        .first()
        .then((c) => (c && c.direction === "inbound" && c.endedAt === undefined && Date.now() - c.createdAt < 10 * 60_000 ? c : null)));

    const member = await ctx.db
      .query("members")
      .withIndex("by_phone", (q) => q.eq("phone", callerNumber))
      .first();
    const broker = member
      ? null
      : await ctx.db
          .query("brokers")
          .withIndex("by_phone", (q) => q.eq("phone", callerNumber))
          .first();

    const role: CallRole = member ? "rider_inbound" : broker ? "broker_inbound" : "unknown_inbound";
    const callId =
      existing?._id ??
      (await createCall(ctx, {
        role,
        direction: "inbound",
        fromNumber: callerNumber,
        externalCallId,
        status: "ringing",
        memberId: member?._id,
        brokerId: broker?._id,
        language: member?.preferredLanguage,
      }));

    if (member) {
      const active = await activeRideForMember(ctx, member._id);
      const lang = member.preferredLanguage;
      const paperwork = paperworkStatus(member, Date.now());
      const days = daysUntilExpiry(member, Date.now());
      return {
        kind: "member" as const,
        callId,
        language: lang,
        variables: {
          memberName: member.name,
          language: lang,
          address: member.address,
          mobility: member.mobility,
          plan: member.plan,
          paperworkSummary: paperwork.valid
            ? `${paperwork.kind} valid${days !== null ? `, expires in ${days} days` : ""}`
            : `${paperwork.kind} ${paperwork.reason}`,
          activeRideSummary: active
            ? `${active.destinationName ?? "appointment"} on ${active.appointmentAt ? formatDateTime(active.appointmentAt, lang) : "?"}, status ${active.status}, pickup ${formatWindow(active.pickupWindowStart, active.pickupWindowEnd, lang)}`
            : "none",
          now: formatNowForAgent(Date.now()),
        },
      };
    }
    if (broker) {
      return { kind: "broker" as const, callId, variables: { brokerName: broker.name, now: formatNowForAgent(Date.now()) } };
    }
    return { kind: "unknown" as const, callId };
  },
});

// ---------------------------------------------------------------------------
// Rider assistant tools
// ---------------------------------------------------------------------------

/** Lazily creates the ride for this call (docs/04 section 1.1: no ride at call start). */
async function rideForRiderCall(ctx: MutationCtx, call: Doc<"calls">): Promise<Doc<"rides">> {
  if (call.rideId) {
    const ride = await ctx.db.get(call.rideId);
    if (ride) return ride;
  }
  if (!call.memberId) throw new Error("rider call has no member");
  const member = await ctx.db.get(call.memberId);
  if (!member) throw new Error("member not found");
  const rideId = await ctx.db.insert("rides", {
    memberId: member._id,
    status: "collecting",
    language: (call.language as "en" | "es" | undefined) ?? member.preferredLanguage,
    mobilitySnapshot: member.mobility,
    pickupAddress: member.address,
    needsHuman: false,
    createdAt: Date.now(),
  });
  await ctx.db.patch(call._id, { rideId, intent: "book" });
  await logEvent(ctx, { rideId, kind: "status_change", summary: "Ride created (collecting) from rider call" });
  return (await ctx.db.get(rideId))!;
}

export const checkEligibility = internalMutation({
  args: { callId: v.id("calls"), appointmentAt: v.string() },
  handler: async (ctx, { callId, appointmentAt }) => {
    const call = await requireCall(ctx, callId, ["rider_inbound"]);
    const ride = await rideForRiderCall(ctx, call);
    const member = (await ctx.db.get(ride.memberId))!;
    const at = parseLocalIso(appointmentAt);

    let say: string;
    let valid = false;
    if (at === null) {
      say = "I could not read that appointment time. Ask the caller for the date and time again.";
    } else if (at < Date.now()) {
      say = "That time is in the past. Ask the caller to confirm the appointment date and time.";
    } else {
      const status = paperworkStatus(member, at);
      valid = status.valid;
      await ctx.db.patch(ride._id, { appointmentAt: at });
      await logEvent(ctx, {
        rideId: ride._id,
        kind: "policy_check",
        summary: `paperworkStatus: ${status.kind} ${status.reason}${status.expiresAt ? ` (expires ${formatDateTime(status.expiresAt, "en")})` : ""}`,
        payload: status,
      });
      if (status.valid) {
        say = "Paperwork is valid for this appointment. Continue: read back the details and ask the caller to confirm.";
      } else {
        await transitionRide(ctx, ride._id, "ineligible", `paperwork ${status.reason}`);
        await ctx.scheduler.runAfter(0, internal.brain.run, { rideId: ride._id, trigger: "ineligible" });
        const form = status.kind === "PCS" ? "the doctor's transportation form (PCS)" : "the plan's ride approval";
        say = `Not eligible: ${form} is ${status.reason === "missing" ? "missing" : "expired"}. Explain gently that it must be renewed with their doctor or health plan before a ride can be booked. Do not book.`;
      }
    }
    await logTool(ctx, ride._id, "check_eligibility", { appointmentAt }, say);
    return { valid, say };
  },
});

export const submitRideRequest = internalMutation({
  args: {
    callId: v.id("calls"),
    appointmentAt: v.string(),
    appointmentType: v.string(),
    destinationName: v.string(),
    destinationAddress: v.string(),
    pickupAddress: v.string(),
    mobility: vMobility,
    riderConfirmed: v.boolean(),
    language: vLang,
  },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, ["rider_inbound"]);
    const ride = await rideForRiderCall(ctx, call);
    const done = (say: string, ok: boolean) => logTool(ctx, ride._id, "submit_ride_request", args, say).then(() => ({ ok, say }));

    if (!args.riderConfirmed) {
      return await done("Not submitted. Read back the day and time, destination, pickup address, and mobility need, and get a clear yes first.", false);
    }
    if (ride.status !== "collecting" && ride.status !== "needs_info") {
      if (ride.status === "ineligible") return await done("Not submitted: the paperwork is not valid. Do not book.", false);
      return await done("Already submitted. Tell the caller you are calling the ride company and will call them back with the pickup time.", true);
    }
    const at = parseLocalIso(args.appointmentAt);
    if (at === null || at < Date.now()) {
      return await done("The appointment time is missing or in the past. Ask for the date and time again.", false);
    }
    const member = (await ctx.db.get(ride.memberId))!;
    const paperwork = paperworkStatus(member, at);
    if (!paperwork.valid) {
      await transitionRide(ctx, ride._id, "ineligible", `paperwork ${paperwork.reason}`);
      await ctx.scheduler.runAfter(0, internal.brain.run, { rideId: ride._id, trigger: "ineligible" });
      return await done("Not eligible: the paperwork must be renewed first. Explain gently. Do not book.", false);
    }
    const broker = await ctx.db
      .query("brokers")
      .withIndex("by_plan", (q) => q.eq("plan", member.plan))
      .first();

    await transitionRide(ctx, ride._id, "requested", "rider confirmed the details", {
      appointmentAt: at,
      appointmentType: args.appointmentType,
      destinationName: args.destinationName,
      destinationAddress: args.destinationAddress,
      pickupAddress: args.pickupAddress,
      mobilitySnapshot: args.mobility,
      language: args.language,
      riderConfirmedAt: Date.now(),
      brokerId: broker?._id,
    });
    await ctx.scheduler.runAfter(0, internal.brain.run, { rideId: ride._id, trigger: "new_request" });
    return await done(
      "Request saved. Tell the caller you will now call the ride company, and you will call them back with the pickup time. Do not say the ride is booked.",
      true,
    );
  },
});

function riderDelaySay(result: DelayReportResult): string {
  if (result.outcome !== "evaluated") {
    return "We already have this report and are working on it. Tell the caller we will call them back with the update.";
  }
  switch (result.evaluation!.action) {
    case "request_urgent_replacement":
      return "The driver is past the allowed wait. Tell the caller you are asking the ride company for an urgent replacement ride now, and you will call them back. Do not promise the replacement.";
    case "verify_with_broker":
      return "Tell the caller you are checking with the ride company about the driver now, and you will call them back with an update.";
    case "notify_rider_only":
      return "The delay is within the plan's wait time, so no replacement yet. Tell the caller you will call them back with the new estimated pickup time, and to call again if the driver does not arrive.";
    case "escalate_to_human":
      return "This is already a replacement ride. Tell the caller a person needs to help, and they can also call their health plan.";
    case "reject":
      return "That ride does not have a booked pickup yet. Tell the caller you will call them back as soon as it is booked.";
  }
}

export const reportDelayRider = internalMutation({
  args: { callId: v.id("calls"), minutesLate: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, RIDER_ROLES);
    if (!call.memberId) throw new Error("rider call has no member");
    const ride = await activeRideForMember(ctx, call.memberId);
    if (!ride) {
      const say = "No upcoming ride found. Say so, and offer to book one.";
      await logTool(ctx, undefined, "report_delay_rider", args, say);
      return { say };
    }
    await ctx.db.patch(call._id, { rideId: call.rideId ?? ride._id, intent: "report_delay" });
    const result = await reportDelay(ctx, {
      rideId: ride._id,
      reportedBy: "rider",
      channel: "rider_call",
      callId: call._id,
      delayMinutes: args.minutesLate,
      note: args.note,
    });
    const say = riderDelaySay(result);
    await logTool(ctx, ride._id, "report_delay_rider", args, say);
    return { say, action: result.evaluation?.action ?? null };
  },
});

export const getRideStatus = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await requireCall(ctx, callId, RIDER_ROLES);
    if (!call.memberId) throw new Error("rider call has no member");
    const ride = await activeRideForMember(ctx, call.memberId);
    const lang = (call.language as "en" | "es" | undefined) ?? "en";
    const say = ride ? statusText(ride.status, lang, ride) : lang === "es" ? "No tiene viajes próximos." : "No upcoming ride found.";
    await logTool(ctx, ride?._id, "get_ride_status", {}, say);
    return { say };
  },
});

// ---------------------------------------------------------------------------
// Broker tools (broker-caller and broker-inbound assistants). Callers are untrusted:
// minimal info out; they can only record delays, replacements, and refusals.
// ---------------------------------------------------------------------------

export const lookupRide = internalMutation({
  args: { callId: v.id("calls"), confirmationNumber: v.string() },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, ["broker_inbound"]);
    const ride = await rideByConfirmation(ctx, args.confirmationNumber);
    if (!ride) {
      const say = "Not found. Say you cannot find that confirmation number and ask the broker to check it.";
      await logTool(ctx, undefined, "lookup_ride", args, say);
      return { found: false, say };
    }
    await ctx.db.patch(call._id, { rideId: ride._id, intent: "broker_report" });
    const member = await ctx.db.get(ride.memberId);
    const say = [
      `Found. Member first name: ${firstName(member?.name ?? "")}.`,
      ride.appointmentAt ? `Appointment: ${formatDateTime(ride.appointmentAt, "en")}.` : "",
      `Pickup window: ${formatWindow(ride.pickupWindowStart, ride.pickupWindowEnd, "en") || "not recorded"}.`,
      `Destination: ${ride.destinationName ?? "not recorded"}.`,
      "Confirm only the pickup window and destination name back. Do not share addresses, IDs, or health details.",
    ]
      .filter(Boolean)
      .join(" ");
    await logTool(ctx, ride._id, "lookup_ride", args, say);
    return { found: true, say };
  },
});

function parseWindow(start: string, end: string): { start: number; end: number } | null {
  const s = parseLocalIso(start);
  const e = parseLocalIso(end);
  if (s === null || e === null || e < s) return null;
  return { start: s, end: e };
}

export const confirmBooking = internalMutation({
  args: {
    callId: v.id("calls"),
    confirmationNumber: v.string(),
    pickupWindowStart: v.string(),
    pickupWindowEnd: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, ["broker_booking"]);
    if (!call.rideId) throw new Error("booking call has no ride");
    const ride = (await ctx.db.get(call.rideId))!;
    const num = normalizeConfirmation(args.confirmationNumber);
    const window = parseWindow(args.pickupWindowStart, args.pickupWindowEnd);
    let say: string;
    if (!num || !window) {
      say = "Not recorded: the confirmation number or pickup window was unclear. Ask the broker to repeat them once.";
    } else if (ride.status === "booked" && ride.brokerConfirmationNumber === num) {
      say = "Already recorded. Thank the broker and end the call.";
    } else if (ride.status !== "calling_broker") {
      say = `Not recorded: the ride is ${ride.status}. Thank the broker and say you will follow up.`;
    } else {
      await transitionRide(ctx, ride._id, "booked", `broker confirmed ${num}`, {
        brokerConfirmationNumber: num,
        pickupWindowStart: window.start,
        pickupWindowEnd: window.end,
      });
      say = `Recorded confirmation ${num}, pickup ${formatWindow(window.start, window.end, "en")}. Read both back to the broker, thank them, and end the call.`;
    }
    await logTool(ctx, ride._id, "confirm_booking", args, say);
    return { say };
  },
});

export const reportDelayBroker = internalMutation({
  args: {
    callId: v.id("calls"),
    confirmationNumber: v.optional(v.string()),
    delayMinutes: v.optional(v.number()),
    newEstimatedPickupAt: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, BROKER_ROLES);
    let ride = call.rideId ? await ctx.db.get(call.rideId) : null;
    if (!ride && args.confirmationNumber) ride = await rideByConfirmation(ctx, args.confirmationNumber);
    if (!ride) {
      const say = "No ride found. Ask the broker for the confirmation number and call lookup_ride.";
      await logTool(ctx, undefined, "report_delay_broker", args, say);
      return { say };
    }
    if (!call.rideId) await ctx.db.patch(call._id, { rideId: ride._id, intent: "broker_report" });

    const eta = args.newEstimatedPickupAt ? parseLocalIso(args.newEstimatedPickupAt) : null;
    const result = await reportDelay(ctx, {
      rideId: ride._id,
      reportedBy: "broker",
      channel: "broker_call",
      callId: call._id,
      delayMinutes: args.delayMinutes,
      newEstimatedPickupAt: eta ?? undefined,
      reason: args.reason,
    });

    const current = (await ctx.db.get(ride._id))!;
    let say: string;
    if (current.status === "late" || current.status === "recovery_calling") {
      if (current.status === "late") {
        await transitionRide(ctx, ride._id, "recovery_calling", "asking the broker for an urgent replacement on this call", {
          replacementRequestedAt: Date.now(),
        });
      }
      say = `Delay exceeds the plan threshold. Say: "${urgentRideObligation()}" Ask the broker to arrange an urgent replacement ride and give you a confirmation number and pickup window. Read them back, then call confirm_replacement.`;
    } else if (result.evaluation?.action === "escalate_to_human") {
      say = "This is already the replacement ride. Thank the broker and say a person will follow up with the member.";
    } else if (result.evaluation?.action === "reject") {
      say = "That ride has no booked pickup on record. Thank the broker and say you will follow up.";
    } else if (result.evaluation?.action === "verify_with_broker") {
      say = "No delay time was given, and the driver is still within the plan's wait time. Ask the broker how many minutes late the driver is, or the new estimated arrival, then call report_delay_broker again with it.";
    } else {
      say = "Within the plan's wait time, so no replacement is needed. Thank the broker. The member will be told the new estimated pickup.";
    }
    await logTool(ctx, ride._id, "report_delay_broker", args, say);
    return { say };
  },
});

export const confirmReplacement = internalMutation({
  args: {
    callId: v.id("calls"),
    confirmationNumber: v.string(),
    pickupWindowStart: v.string(),
    pickupWindowEnd: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, BROKER_ROLES);
    const ride = call.rideId ? await ctx.db.get(call.rideId) : null;
    if (!ride) {
      const say = "No ride linked to this call. Ask for the original confirmation number and call lookup_ride first.";
      await logTool(ctx, undefined, "confirm_replacement", args, say);
      return { say };
    }
    const num = normalizeConfirmation(args.confirmationNumber);
    const window = parseWindow(args.pickupWindowStart, args.pickupWindowEnd);
    let say: string;
    if (!num || !window) {
      say = "Not recorded: the confirmation number or pickup window was unclear. Ask the broker to repeat them once.";
    } else if (ride.status === "replacement_booked" && ride.replacementConfirmationNumber === num) {
      say = "Already recorded. Thank the broker and end the call.";
    } else if (ride.status !== "late" && ride.status !== "recovery_calling") {
      say = "Not recorded: the plan rules did not call for a replacement on this ride. Say you must check with the member first.";
    } else {
      if (ride.status === "late") {
        await transitionRide(ctx, ride._id, "recovery_calling", "replacement offered on the call", { replacementRequestedAt: Date.now() });
      }
      await transitionRide(ctx, ride._id, "replacement_booked", `broker confirmed replacement ${num}`, {
        replacementConfirmationNumber: num,
        replacementWindowStart: window.start,
        replacementWindowEnd: window.end,
      });
      say = `Recorded replacement ${num}, pickup ${formatWindow(window.start, window.end, "en")}. Read both back, say the member will be informed, thank the broker, and end the call.`;
    }
    await logTool(ctx, ride._id, "confirm_replacement", args, say);
    return { say };
  },
});

export const reportRefusal = internalMutation({
  args: { callId: v.id("calls"), reason: v.string() },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.callId, BROKER_ROLES);
    const ride = call.rideId ? await ctx.db.get(call.rideId) : null;
    if (ride && canTransition(ride.status, "needs_human")) {
      await transitionRide(ctx, ride._id, "needs_human", `broker refused: ${args.reason}`);
    }
    const say = "Noted. Thank the broker, say a person will follow up, and end the call.";
    await logTool(ctx, ride?._id, "report_refusal", args, say);
    return { say };
  },
});
