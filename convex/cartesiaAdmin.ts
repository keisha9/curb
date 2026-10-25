// Setup helpers for Cartesia Managed Agents, run from the CLI (`npx convex run cartesiaAdmin:...`).
// Internal only. Responses never include the API key.

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { cartesia, cartesiaConfigured } from "./lib/cartesia";

/** GET a Cartesia API path and return status plus a truncated body. For discovery while wiring Phase 2. */
export const get = internalAction({
  args: { path: v.string() },
  handler: async (_ctx, { path }): Promise<unknown> => {
    if (!cartesiaConfigured()) return { error: "CARTESIA_API_KEY is not set on this deployment" };
    const r = await cartesia("GET", path);
    const text = JSON.stringify(r.body);
    return { status: r.status, body: text.length > 6000 ? `${text.slice(0, 6000)}...[truncated]` : r.body };
  },
});

/** POST/PATCH/DELETE a Cartesia API path (discovery and setup). */
export const send = internalAction({
  args: { method: v.union(v.literal("POST"), v.literal("PATCH"), v.literal("DELETE")), path: v.string(), body: v.optional(v.any()) },
  handler: async (_ctx, { method, path, body }): Promise<unknown> => {
    if (!cartesiaConfigured()) return { error: "CARTESIA_API_KEY is not set on this deployment" };
    const r = await cartesia(method, path, body);
    return { status: r.status, body: r.body };
  },
});

/**
 * Calls our own /voice routes the way Cartesia does, from the server (the secret stays in Convex).
 * Checks: health, 401 without the secret, and identify_caller for a caller number.
 */
export const selfTest = internalAction({
  args: { callerNumber: v.string() },
  handler: async (_ctx, { callerNumber }): Promise<unknown> => {
    const site = process.env.CONVEX_SITE_URL!;
    const secret = process.env.VOICE_WEBHOOK_SECRET ?? "";
    const health = await fetch(`${site}/health`);
    const noAuth = await fetch(`${site}/voice/tools/identify_caller`, { method: "POST", body: "{}" });
    const badEvent = await fetch(`${site}/voice/events`, { method: "POST", body: "{}" });
    const conversationId = `selftest_${crypto.randomUUID()}`;
    const identify = await fetch(`${site}/voice/tools/identify_caller`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, caller_id: callerNumber, app_call_id: "{{app_call_id}}" }),
    });
    const status = await fetch(`${site}/voice/tools/get_ride_status`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, caller_id: callerNumber }),
    });
    return {
      health: health.status,
      toolWithoutSecret: noAuth.status,
      eventWithoutSecret: badEvent.status,
      identify: { status: identify.status, body: await identify.text() },
      getRideStatus: { status: status.status, body: await status.text() },
    };
  },
});

/** Recent raw provider webhook payloads (debugging event field names). */
export const recentWebhooks = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("webhookLog").order("desc").take(limit ?? 20);
    return rows.map((r) => ({ type: r.type, at: new Date(r.createdAt).toISOString(), body: r.body.slice(0, 3000) }));
  },
});
