// HTTP routes (docs/04 section 1), for Cartesia Managed Agents.
//   POST /voice/tools/<name>  webhook tools, Authorization: Bearer $VOICE_WEBHOOK_SECRET
//   POST /voice/events        call events, X-Webhook-Secret: $VOICE_WEBHOOK_SECRET
// Handlers only write, run pure policy, and schedule (CLAUDE.md hard rule 6). Errors are
// logged and still answered, so a call is never dropped on a bug.

import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok", { status: 200 })),
});

function secretOk(provided: string | null): boolean {
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  return !!secret && provided === secret;
}

type Json = Record<string, unknown>;

const str = (b: Json, k: string): string | undefined => {
  const v = b[k];
  // Unset dynamic variables may arrive empty or as the raw "{{name}}" placeholder.
  return typeof v === "string" && v.trim() && !v.includes("{{") ? v.trim() : undefined;
};
const num = (b: Json, k: string): number | undefined => {
  const v = b[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (b: Json, k: string): boolean => b[k] === true || b[k] === "true";

/**
 * Our call row for a tool request. Outbound calls carry our id as app_call_id. Inbound
 * calls are found by the provider's conversation id, or routed by caller number if the
 * agent called a tool before identify_caller.
 */
async function resolveCall(ctx: ActionCtx, body: Json): Promise<Id<"calls"> | null> {
  const conversationId = str(body, "conversation_id");
  const found: Doc<"calls"> | null = await ctx.runQuery(internal.calls.findForProvider, {
    appCallId: str(body, "app_call_id"),
    externalCallId: conversationId,
  });
  if (found) {
    if (conversationId && found.externalCallId !== conversationId) {
      await ctx.runMutation(internal.calls.setExternalCallId, { callId: found._id, externalCallId: conversationId });
    }
    return found._id;
  }
  const caller = str(body, "caller_id");
  if (!conversationId || !caller) return null;
  const route = await ctx.runMutation(internal.voiceTools.routeInbound, { externalCallId: conversationId, callerNumber: caller });
  return route.callId;
}

type ToolHandler = (ctx: ActionCtx, callId: Id<"calls">, b: Json) => Promise<string>;

/** Runs first on inbound calls: creates the call row and says who is calling (docs/04 section 1.1). */
async function identifyCaller(ctx: ActionCtx, b: Json): Promise<string> {
  {
    const route = await ctx.runMutation(internal.voiceTools.routeInbound, {
      externalCallId: str(b, "conversation_id") ?? `unknown_${crypto.randomUUID()}`,
      callerNumber: str(b, "caller_id") ?? "",
    });
    await ctx.runMutation(internal.calls.setStatus, { callId: route.callId, status: "in_progress" });
    if (route.kind === "member") {
      const x = route.variables;
      return JSON.stringify({
        caller_kind: "member",
        member_name: x.memberName,
        language: x.language,
        say: `Caller is the member ${x.memberName}. Preferred language: ${x.language === "es" ? "Spanish" : "English"}. Default pickup: ${x.address}. Mobility: ${x.mobility}. Plan: ${x.plan}. Paperwork: ${x.paperworkSummary}. Upcoming ride: ${x.activeRideSummary}. Current date and time: ${x.now}. Follow the MEMBER section. Greet them by first name.`,
      });
    }
    if (route.kind === "broker") {
      return JSON.stringify({
        caller_kind: "broker",
        member_name: "",
        language: "en",
        say: `Caller is the ride company ${route.variables.brokerName}. Current date and time: ${route.variables.now}. Speak English. Follow the RIDE COMPANY section.`,
      });
    }
    return JSON.stringify({
      caller_kind: "unknown",
      member_name: "",
      language: "en",
      say: "Unknown caller. Say politely, in English and Spanish, that this line only serves registered members, and end the call.",
    });
  }
}

const TOOLS: Record<string, ToolHandler> = {
  check_eligibility: async (ctx, callId, b) =>
    (await ctx.runMutation(internal.voiceTools.checkEligibility, { callId, appointmentAt: str(b, "appointmentAt") ?? "" })).say,
  submit_ride_request: async (ctx, callId, b) => {
    const mobility = str(b, "mobility");
    const language = str(b, "language");
    return (
      await ctx.runMutation(internal.voiceTools.submitRideRequest, {
        callId,
        appointmentAt: str(b, "appointmentAt") ?? "",
        appointmentType: str(b, "appointmentType") ?? "medical appointment",
        destinationName: str(b, "destinationName") ?? "",
        destinationAddress: str(b, "destinationAddress") ?? "",
        pickupAddress: str(b, "pickupAddress") ?? "",
        mobility: mobility === "wheelchair" || mobility === "gurney" ? mobility : "ambulatory",
        riderConfirmed: bool(b, "riderConfirmed"),
        language: language === "es" ? "es" : "en",
      })
    ).say;
  },
  report_delay_rider: async (ctx, callId, b) =>
    (await ctx.runMutation(internal.voiceTools.reportDelayRider, { callId, minutesLate: num(b, "minutesLate"), note: str(b, "note") })).say,
  get_ride_status: async (ctx, callId) => (await ctx.runMutation(internal.voiceTools.getRideStatus, { callId })).say,
  lookup_ride: async (ctx, callId, b) =>
    (await ctx.runMutation(internal.voiceTools.lookupRide, { callId, confirmationNumber: str(b, "confirmationNumber") ?? "" })).say,
  confirm_booking: async (ctx, callId, b) =>
    (
      await ctx.runMutation(internal.voiceTools.confirmBooking, {
        callId,
        confirmationNumber: str(b, "confirmationNumber") ?? "",
        pickupWindowStart: str(b, "pickupWindowStart") ?? "",
        pickupWindowEnd: str(b, "pickupWindowEnd") ?? "",
      })
    ).say,
  report_delay_broker: async (ctx, callId, b) =>
    (
      await ctx.runMutation(internal.voiceTools.reportDelayBroker, {
        callId,
        confirmationNumber: str(b, "confirmationNumber"),
        delayMinutes: num(b, "delayMinutes"),
        newEstimatedPickupAt: str(b, "newEstimatedPickupAt"),
        reason: str(b, "reason"),
      })
    ).say,
  confirm_replacement: async (ctx, callId, b) =>
    (
      await ctx.runMutation(internal.voiceTools.confirmReplacement, {
        callId,
        confirmationNumber: str(b, "confirmationNumber") ?? "",
        pickupWindowStart: str(b, "pickupWindowStart") ?? "",
        pickupWindowEnd: str(b, "pickupWindowEnd") ?? "",
      })
    ).say,
  report_refusal: async (ctx, callId, b) =>
    (await ctx.runMutation(internal.voiceTools.reportRefusal, { callId, reason: str(b, "reason") ?? "no reason given" })).say,
};

http.route({
  pathPrefix: "/voice/tools/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = request.headers.get("Authorization");
    if (!secretOk(auth?.startsWith("Bearer ") ? auth.slice(7) : null)) return new Response("unauthorized", { status: 401 });
    const name = new URL(request.url).pathname.split("/").pop() ?? "";
    const handler = TOOLS[name];
    if (!handler && name !== "identify_caller") return new Response(`unknown tool ${name}`, { status: 404 });

    let body: Json = {};
    try {
      body = (await request.json()) as Json;
    } catch {
      // empty or invalid body: handled below like missing fields
    }
    try {
      let text: string;
      if (!handler) {
        text = await identifyCaller(ctx, body);
      } else {
        const callId = await resolveCall(ctx, body);
        text = callId ? await handler(ctx, callId, body) : "Could not match this call. Call identify_caller first.";
      }
      return new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.events.log, { kind: "error", summary: `Voice tool ${name} failed: ${message}`, payload: { body } });
      // A valid answer the agent can speak from, never a dropped call.
      return new Response("That did not work. Apologize, say a person will follow up, and do not promise anything.", { status: 200 });
    }
  }),
});

// ---- Call events: https://docs.cartesia.ai/line/infrastructure/observability#webhooks ----

type Turn = { id?: string; role?: string; text?: string; start_time?: string; started_at?: string };

function turnsOf(x: unknown): Turn[] {
  return Array.isArray(x) ? (x.filter((t) => t && typeof t === "object") as Turn[]) : [];
}

async function storeTurns(ctx: ActionCtx, call: Doc<"calls">, turns: Turn[]) {
  const other = call.role.startsWith("broker") ? "broker" : "rider";
  for (const t of turns) {
    if (!t.text?.trim()) continue;
    const ts = Date.parse(t.start_time ?? t.started_at ?? "");
    await ctx.runMutation(internal.calls.appendTranscript, {
      callId: call._id,
      speaker: t.role === "assistant" ? "agent" : other,
      text: t.text,
      isFinal: true,
      turnId: t.id,
      ts: Number.isNaN(ts) ? undefined : ts,
    });
  }
}

http.route({
  path: "/voice/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!secretOk(request.headers.get("X-Webhook-Secret"))) return new Response("unauthorized", { status: 401 });
    const raw = await request.text();
    let event: Json = {};
    try {
      event = JSON.parse(raw) as Json;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const type = typeof event.type === "string" ? event.type : "unknown";
    await ctx.runMutation(internal.calls.logWebhook, { source: "cartesia", type, body: raw });

    try {
      const callObj = (event.call ?? {}) as Json;
      const vars = (callObj.dynamic_variables ?? {}) as Json;
      const telephony = (callObj.telephony_params ?? {}) as Json;
      const externalCallId = (typeof event.call_id === "string" ? event.call_id : undefined) ?? str(callObj, "id");

      let call: Doc<"calls"> | null = await ctx.runQuery(internal.calls.findForProvider, {
        appCallId: str(vars, "app_call_id"),
        externalCallId,
      });
      if (!call && externalCallId && type === "call_started" && str(telephony, "direction") === "inbound" && str(telephony, "from")) {
        const route = await ctx.runMutation(internal.voiceTools.routeInbound, { externalCallId, callerNumber: str(telephony, "from")! });
        call = await ctx.runQuery(internal.calls.getInternal, { callId: route.callId });
      }
      if (!call) return new Response("ok", { status: 200 });
      if (externalCallId && call.externalCallId !== externalCallId) {
        await ctx.runMutation(internal.calls.setExternalCallId, { callId: call._id, externalCallId });
      }

      switch (type) {
        case "call_started":
          await ctx.runMutation(internal.calls.setStatus, { callId: call._id, status: "in_progress" });
          break;
        case "call_turn":
          await storeTurns(ctx, call, turnsOf([event.turn ?? (event.data as Json | undefined)?.turn].filter(Boolean)));
          break;
        case "call_completed":
        case "call_failed":
          await storeTurns(ctx, call, turnsOf(callObj.transcript));
          await ctx.runMutation(internal.calls.end, {
            callId: call._id,
            summary: str(callObj, "summary"),
            error: type === "call_failed" ? (str(callObj, "error_message") ?? str(callObj, "end_reason") ?? "call failed") : undefined,
          });
          break;
        case "post_call_analysis": {
          const summary = str(callObj, "summary") ?? str(event, "summary");
          if (summary) await ctx.runMutation(internal.calls.setSummary, { callId: call._id, summary });
          break;
        }
      }
    } catch (e) {
      await ctx.runMutation(internal.events.log, {
        kind: "error",
        summary: `Call event ${type} failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
