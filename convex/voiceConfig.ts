import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("voiceConfig").first(),
});

export const save = internalMutation({
  args: {
    inboundAgentId: v.string(),
    brokerAgentId: v.string(),
    callbackAgentIdEn: v.string(),
    callbackAgentIdEs: v.string(),
    fromNumberId: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    eventWebhookId: v.optional(v.string()),
    toolIds: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("voiceConfig").first();
    const row = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("voiceConfig", row);
  },
});
