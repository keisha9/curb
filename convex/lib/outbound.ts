// Outbound calls (Cartesia Managed Agents) and SMS (Twilio), used by brain actions.
// Every number passes checkOutbound first. When Cartesia is not set up (no API key or
// no voiceConfig from cartesiaSetup:run), the call is stubbed: written to the database
// only, so everything also runs in text. SMS is stubbed while Twilio is unset (current plan).

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { cartesia, cartesiaConfigured } from "./cartesia";
import { checkOutbound } from "./safety";
import type { Lang } from "./wording";

type OutboundRole = "broker_booking" | "broker_delay" | "rider_callback";

export type PlaceCallResult = { ok: true; callId: Id<"calls">; stubbed: boolean } | { ok: false; error: string };

export async function placeCall(
  ctx: ActionCtx,
  args: {
    rideId: Id<"rides">;
    role: OutboundRole;
    to: string;
    variableValues: Record<string, string>;
    memberId?: Id<"members">;
    brokerId?: Id<"brokers">;
    language?: Lang;
    policyAction?: string;
    delayReportId?: Id<"delayReports">;
    updateText?: string;
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
    externalCallId: `pending_${crypto.randomUUID()}`,
    status: "ringing",
    rideId: args.rideId,
    memberId: args.memberId,
    brokerId: args.brokerId,
    language: args.language,
    policyAction: args.policyAction,
    delayReportId: args.delayReportId,
    updateText: args.updateText,
  });

  // OUTBOUND_MODE=stub keeps calls in the database even when Cartesia is set up (text testing).
  const live = cartesiaConfigured() && process.env.OUTBOUND_MODE !== "stub";
  const config = live ? await ctx.runQuery(internal.voiceConfig.get, {}) : null;
  if (!config || !config.fromNumberId) {
    await ctx.runMutation(internal.calls.setExternalCallId, { callId, externalCallId: `stub_${callId}` });
    await ctx.runMutation(internal.events.log, {
      rideId: args.rideId,
      kind: "call",
      summary: `Stubbed ${args.role} call to ${args.to} (${live ? "no Cartesia number configured" : "Cartesia not set up or OUTBOUND_MODE=stub"})`,
      payload: { callId, variableValues: args.variableValues },
    });
    return { ok: true, callId, stubbed: true };
  }

  const agentId =
    args.role === "rider_callback"
      ? args.language === "es"
        ? config.callbackAgentIdEs
        : config.callbackAgentIdEn
      : config.brokerAgentId;

  try {
    // https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing
    const res = await cartesia("POST", "/agents/calls", {
      agent_id: agentId,
      from_number_id: config.fromNumberId,
      outbound_calls: [
        {
          to_number: args.to,
          // Our call id rides along so tool calls can find this row before the provider id is stored.
          dynamic_variables: { ...args.variableValues, app_call_id: callId },
        },
      ],
    });
    const entry = (res.body as { calls?: { agent_call_id?: string; error?: unknown }[] } | null)?.calls?.[0];
    if (!res.ok || !entry?.agent_call_id) {
      throw new Error(`Cartesia ${res.status}: ${JSON.stringify(entry?.error ?? res.body).slice(0, 300)}`);
    }
    await ctx.runMutation(internal.calls.setExternalCallId, { callId, externalCallId: entry.agent_call_id });
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
