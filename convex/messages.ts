import { v } from "convex/values";
import { assertOps, vOpsKey } from "./lib/ops";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { vLang } from "./schema";
import { logEvent } from "./events";

export const record = internalMutation({
  args: {
    rideId: v.optional(v.id("rides")),
    memberId: v.id("members"),
    to: v.string(),
    body: v.string(),
    language: vLang,
    template: v.optional(v.string()),
    twilioSid: v.optional(v.string()),
    status: v.union(v.literal("stubbed"), v.literal("sent"), v.literal("failed"), v.literal("blocked")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { ...args, createdAt: Date.now() });
    await logEvent(ctx, {
      rideId: args.rideId,
      kind: args.status === "failed" || args.status === "blocked" ? "error" : "sms",
      summary: `SMS ${args.template ?? ""} ${args.status}${args.error ? `: ${args.error}` : ""}`.replace(/\s+/g, " "),
      payload: { to: args.to, body: args.body, twilioSid: args.twilioSid },
    });
  },
});

export const templatesSent = internalQuery({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    return rows.filter((m) => m.status === "sent" || m.status === "stubbed").map((m) => m.template ?? "");
  },
});

/** Ops dashboard: texts sent for a ride. */
export const byRide = query({
  args: { opsKey: vOpsKey, rideId: v.id("rides") },
  handler: async (ctx, { opsKey, rideId }) => {
    assertOps(opsKey);
    return await ctx.db
      .query("messages")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
  },
});
