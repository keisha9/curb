import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

export const record = internalMutation({
  args: {
    rideId: v.optional(v.id("rides")),
    purpose: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("llmUsage", { ...args, createdAt: Date.now() });
  },
});

/** Total tokens (input + output + cache) spent on one ride; used by the per-ride budget check. */
export const rideTotal = internalQuery({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const rows = await ctx.db
      .query("llmUsage")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    return rows.reduce((n, r) => n + r.inputTokens + r.outputTokens + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0), 0);
  },
});

/** Per-ride token usage for the ops dashboard (P1 cost display). */
export const byRide = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    return await ctx.db
      .query("llmUsage")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
  },
});
