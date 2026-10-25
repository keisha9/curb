import { v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { vBilingual, vEventKind } from "./schema";
import type { Bilingual } from "./lib/wording";

export type EventKind =
  | "decision"
  | "tool_call"
  | "policy_check"
  | "status_change"
  | "delay_report"
  | "sms"
  | "call"
  | "error";

/** Every agent decision, tool call, and status change goes through here (CLAUDE.md hard rule 8). */
export async function logEvent(
  ctx: MutationCtx,
  e: { rideId?: Id<"rides">; kind: EventKind; summary: string; payload?: unknown; riderText?: Bilingual },
): Promise<Id<"agentEvents">> {
  return await ctx.db.insert("agentEvents", { ...e, createdAt: Date.now() });
}

export const log = internalMutation({
  args: {
    rideId: v.optional(v.id("rides")),
    kind: vEventKind,
    summary: v.string(),
    payload: v.optional(v.any()),
    riderText: v.optional(vBilingual),
  },
  handler: async (ctx, args) => {
    await logEvent(ctx, args);
  },
});

/** Ops dashboard decision log for one ride. */
export const byRide = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .order("asc")
      .collect();
  },
});

/** Ops dashboard global feed. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_created")
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
  },
});
