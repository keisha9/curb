import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { vCallOutcome, vCallRole, vCallStatus } from "./schema";
import { logEvent } from "./events";

const ROLE_LABEL: Record<Doc<"calls">["role"], string> = {
  rider_inbound: "Rider call (inbound)",
  broker_booking: "Booking call to broker",
  broker_delay: "Delay call to broker",
  broker_inbound: "Broker call (inbound)",
  rider_callback: "Callback to rider",
  unknown_inbound: "Unknown caller (inbound)",
};

/** Calls whose end should trigger a brain run (docs/04 section 1.4). */
const BRAIN_ON_END = new Set<Doc<"calls">["role"]>(["broker_booking", "broker_delay", "broker_inbound", "rider_callback"]);

type NewCall = Omit<Doc<"calls">, "_id" | "_creationTime" | "createdAt">;

export async function createCall(ctx: MutationCtx, args: NewCall): Promise<Id<"calls">> {
  const callId = await ctx.db.insert("calls", { ...args, createdAt: Date.now() });
  await logEvent(ctx, {
    rideId: args.rideId,
    kind: "call",
    summary: `${ROLE_LABEL[args.role]} started`,
    payload: { callId, ...args },
  });
  return callId;
}

export const create = internalMutation({
  args: {
    role: vCallRole,
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    vapiCallId: v.string(),
    status: vCallStatus,
    rideId: v.optional(v.id("rides")),
    memberId: v.optional(v.id("members")),
    brokerId: v.optional(v.id("brokers")),
    intent: v.optional(v.string()),
    language: v.optional(v.string()),
    policyAction: v.optional(v.string()),
    delayReportId: v.optional(v.id("delayReports")),
  },
  handler: async (ctx, args) => await createCall(ctx, args),
});

export const setVapiCallId = internalMutation({
  args: { callId: v.id("calls"), vapiCallId: v.string() },
  handler: async (ctx, { callId, vapiCallId }) => {
    await ctx.db.patch(callId, { vapiCallId });
  },
});

export const markFailed = internalMutation({
  args: { callId: v.id("calls"), error: v.string() },
  handler: async (ctx, { callId, error }) => {
    const call = await ctx.db.get(callId);
    if (!call) return;
    await ctx.db.patch(callId, { status: "failed", error, endedAt: Date.now() });
    await logEvent(ctx, { rideId: call.rideId, kind: "error", summary: `${ROLE_LABEL[call.role]} failed: ${error}` });
  },
});

export const setStatus = internalMutation({
  args: { callId: v.id("calls"), status: vCallStatus },
  handler: async (ctx, { callId, status }) => {
    const call = await ctx.db.get(callId);
    if (!call || call.status === "ended") return;
    await ctx.db.patch(callId, { status, ...(status === "in_progress" && !call.startedAt ? { startedAt: Date.now() } : {}) });
  },
});

export const appendTranscript = internalMutation({
  args: {
    callId: v.id("calls"),
    speaker: v.union(v.literal("agent"), v.literal("rider"), v.literal("broker")),
    text: v.string(),
    isFinal: v.boolean(),
  },
  handler: async (ctx, { callId, speaker, text, isFinal }) => {
    const call = await ctx.db.get(callId);
    if (!call) return;
    await ctx.db.insert("transcriptLines", { callId, rideId: call.rideId, speaker, text, isFinal, ts: Date.now() });
  },
});

/** End of call: store the summary and schedule the brain for broker and callback calls. Idempotent. */
export const end = internalMutation({
  args: { callId: v.id("calls"), summary: v.optional(v.string()), recordingUrl: v.optional(v.string()) },
  handler: async (ctx, { callId, summary, recordingUrl }) => {
    const call = await ctx.db.get(callId);
    if (!call || call.endedAt !== undefined) return;
    await ctx.db.patch(callId, { status: "ended", endedAt: Date.now(), summary, recordingUrl });
    await logEvent(ctx, {
      rideId: call.rideId,
      kind: "call",
      summary: `${ROLE_LABEL[call.role]} ended${summary ? `: ${summary}` : ""}`,
      payload: { callId },
    });
    if (call.rideId && BRAIN_ON_END.has(call.role)) {
      await ctx.scheduler.runAfter(0, internal.brain.run, { rideId: call.rideId, trigger: "call_ended", callId });
    }
  },
});

export const setOutcome = internalMutation({
  args: { callId: v.id("calls"), outcome: vCallOutcome },
  handler: async (ctx, { callId, outcome }) => {
    const call = await ctx.db.get(callId);
    if (!call) return;
    await ctx.db.patch(callId, { outcome });
    await logEvent(ctx, {
      rideId: call.rideId,
      kind: "tool_call",
      summary: `Call outcome extracted: ${outcome.result}${outcome.confirmationNumber ? ` (${outcome.confirmationNumber})` : ""}`,
      payload: { callId, outcome },
    });
  },
});

export const getInternal = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => await ctx.db.get(callId),
});

export const transcriptInternal = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) =>
    await ctx.db
      .query("transcriptLines")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .collect(),
});

/** Latest outbound call of a role that has not ended (used by sim.ts). */
export const openForRide = internalQuery({
  args: { rideId: v.id("rides"), role: v.union(v.literal("broker_booking"), v.literal("broker_delay"), v.literal("rider_callback")) },
  handler: async (ctx, { rideId, role }) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    return [...calls].reverse().find((c) => c.role === role && c.status !== "ended" && c.status !== "failed") ?? null;
  },
});

// ---- Ops dashboard ----

/** Calls for a ride with their transcript lines, oldest first. */
export const byRide = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    return await Promise.all(
      calls.map(async (c) => ({
        ...c,
        label: ROLE_LABEL[c.role],
        lines: await ctx.db
          .query("transcriptLines")
          .withIndex("by_call", (q) => q.eq("callId", c._id))
          .collect(),
      })),
    );
  },
});

/** Most recent calls across all rides (inbound calls may not have a ride yet). */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const calls = await ctx.db.query("calls").order("desc").take(Math.min(limit ?? 10, 50));
    return await Promise.all(
      calls.map(async (c) => ({
        ...c,
        label: ROLE_LABEL[c.role],
        lines: await ctx.db
          .query("transcriptLines")
          .withIndex("by_call", (q) => q.eq("callId", c._id))
          .collect(),
      })),
    );
  },
});
