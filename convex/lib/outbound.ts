// Outbound calls (Vapi) and SMS (Twilio), used by brain actions.
// Every number passes checkOutbound first. When the provider key is not set, the call
// or text is stubbed: it is written to the database only, so Phase 1 runs in text.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { checkOutbound } from "./safety";
import type { Lang } from "./wording";

type OutboundRole = "broker_booking" | "broker_delay" | "rider_callback";

export type PlaceCallResult = { ok: true; callId: Id<"calls">; stubbed: boolean } | { ok: false; error: string };

const ASSISTANT_ENV: Record<OutboundRole, string> = {
  broker_booking: "VAPI_BROKER_CALLER_ASSISTANT_ID",
  broker_delay: "VAPI_BROKER_CALLER_ASSISTANT_ID",
  rider_callback: "VAPI_RIDER_ASSISTANT_ID",
};

export async function placeCall(
  ctx: ActionCtx,
  args: {
    rideId: Id<"rides">;
    role: OutboundRole;
    to: string;
    variableValues: Record<string, string>;
    firstMessage?: string;
    memberId?: Id<"members">;
    brokerId?: Id<"brokers">;
    language?: Lang;
    policyAction?: string;
    delayReportId?: Id<"delayReports">;
  },
): Promise<PlaceCallResult> {
  const check = checkOutbound(args.to);
  if (!check.ok) {
    await ctx.runMutation(internal.events.log, {
      rideId: args.rideId,
      kind: "error",
      summary: `Outbound call blocked: ${check.reason}`,
    });
    return { ok: false, error: check.reason };
  }

  const callId = await ctx.runMutation(internal.calls.create, {
    role: args.role,
    direction: "outbound",
    vapiCallId: `pending_${crypto.randomUUID()}`,
    status: "ringing",
    rideId: args.rideId,
    memberId: args.memberId,
    brokerId: args.brokerId,
    language: args.language,
    policyAction: args.policyAction,
    delayReportId: args.delayReportId,
  });

  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    await ctx.runMutation(internal.calls.setVapiCallId, { callId, vapiCallId: `stub_${callId}` });
    await ctx.runMutation(internal.events.log, {
      rideId: args.rideId,
      kind: "call",
      summary: `Stubbed ${args.role} call to ${args.to} (VAPI_API_KEY not set)`,
      payload: { callId, variableValues: args.variableValues },
    });
    return { ok: true, callId, stubbed: true };
  }

  // VERIFY against current Vapi docs (docs/04 section 4): create-call body shape.
  try {
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId: process.env[ASSISTANT_ENV[args.role]],
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: args.to },
        // Our call id rides along so webhooks can match even before setVapiCallId lands.
        metadata: { callId },
        assistantOverrides: {
          variableValues: { ...args.variableValues, callId },
          ...(args.firstMessage ? { firstMessage: args.firstMessage } : {}),
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: unknown };
    if (!res.ok || !body.id) throw new Error(`Vapi ${res.status}: ${JSON.stringify(body.message ?? body)}`);
    await ctx.runMutation(internal.calls.setVapiCallId, { callId, vapiCallId: body.id });
    return { ok: true, callId, stubbed: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.calls.markFailed, { callId, error });
    return { ok: false, error };
  }
}

export type SendSmsResult = { ok: true; stubbed: boolean } | { ok: false; error: string };

export async function sendSms(
  ctx: ActionCtx,
  args: { rideId?: Id<"rides">; memberId: Id<"members">; to: string; body: string; language: Lang; template?: string },
): Promise<SendSmsResult> {
  const record = { rideId: args.rideId, memberId: args.memberId, to: args.to, body: args.body, language: args.language, template: args.template };
  const check = checkOutbound(args.to);
  if (!check.ok) {
    await ctx.runMutation(internal.messages.record, { ...record, status: "blocked", error: check.reason });
    return { ok: false, error: check.reason };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    await ctx.runMutation(internal.messages.record, { ...record, status: "stubbed" });
    return { ok: true, stubbed: true };
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: args.to, From: from, Body: args.body }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? "unknown error"}`);
    await ctx.runMutation(internal.messages.record, { ...record, status: "sent", twilioSid: body.sid });
    return { ok: true, stubbed: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.messages.record, { ...record, status: "failed", error });
    return { ok: false, error };
  }
}
