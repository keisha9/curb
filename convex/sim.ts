// Text-only stand-ins for the phone side, for Phase 1 testing with `npx convex run`.
// Each step calls the same voiceTools / calls functions the Vapi webhook will call, one
// transaction per step, the way real tool calls arrive. Internal: not callable from clients.

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

async function say(ctx: ActionCtx, callId: Id<"calls">, speaker: "agent" | "rider" | "broker", text: string) {
  await ctx.runMutation(internal.calls.appendTranscript, { callId, speaker, text, isFinal: true });
}

/** A rider calls in and books a ride. Returns the call and the tool responses. */
export const riderBooks = internalAction({
  args: {
    phone: v.string(),
    appointmentAt: v.string(), // local ISO, e.g. "2026-10-26T09:00"
    destinationName: v.optional(v.string()),
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const route = await ctx.runMutation(internal.voiceTools.routeInbound, {
      vapiCallId: `sim_${crypto.randomUUID()}`,
      callerNumber: args.phone,
    });
    if (route.kind !== "member") return { route };
    const { callId } = route;
    const lang = route.language;
    await ctx.runMutation(internal.calls.setStatus, { callId, status: "in_progress" });
    await say(ctx, callId, "rider", lang === "es" ? "Necesito transporte a diálisis mañana a las 9." : "I need a ride to dialysis tomorrow at 9.");
    const eligibility = await ctx.runMutation(internal.voiceTools.checkEligibility, { callId, appointmentAt: args.appointmentAt });
    await say(ctx, callId, "agent", eligibility.say);
    let submit = null;
    if (eligibility.valid) {
      submit = await ctx.runMutation(internal.voiceTools.submitRideRequest, {
        callId,
        appointmentAt: args.appointmentAt,
        appointmentType: "dialysis",
        destinationName: args.destinationName ?? "Demo Dialysis Center",
        destinationAddress: "500 Sample Blvd, Los Angeles, CA",
        pickupAddress: route.variables.address,
        mobility: route.variables.mobility as "ambulatory" | "wheelchair" | "gurney",
        riderConfirmed: args.confirm ?? true,
        language: lang,
      });
      await say(ctx, callId, "agent", submit.say);
    }
    await ctx.runMutation(internal.calls.end, { callId, summary: "simulated rider booking call" });
    return { callId, eligibility, submit };
  },
});

/** The broker answers the open booking call and gives a confirmation. */
export const brokerConfirmsBooking = internalAction({
  args: {
    rideId: v.id("rides"),
    confirmationNumber: v.optional(v.string()),
    pickupWindowStart: v.string(),
    pickupWindowEnd: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const call = await ctx.runQuery(internal.calls.openForRide, { rideId: args.rideId, role: "broker_booking" });
    if (!call) throw new Error("no open booking call for this ride");
    const num = args.confirmationNumber ?? "TR-4821";
    await ctx.runMutation(internal.calls.setStatus, { callId: call._id, status: "in_progress" });
    await say(ctx, call._id, "broker", `Ride booked. Confirmation number ${num}.`);
    const result = await ctx.runMutation(internal.voiceTools.confirmBooking, {
      callId: call._id,
      confirmationNumber: num,
      pickupWindowStart: args.pickupWindowStart,
      pickupWindowEnd: args.pickupWindowEnd,
    });
    await say(ctx, call._id, "agent", result.say);
    await ctx.runMutation(internal.calls.end, { callId: call._id, summary: "simulated booking call" });
    return result;
  },
});

/** A broker call (ours, or a call-in) where the broker reports a delay and optionally arranges a replacement. */
async function brokerDelayConversation(
  ctx: ActionCtx,
  callId: Id<"calls">,
  args: {
    delayMinutes?: number;
    replacementConfirmationNumber?: string;
    replacementWindowStart?: string;
    replacementWindowEnd?: string;
    confirmationNumber?: string;
  },
) {
  const steps: { tool: string; say: string }[] = [];
  if (args.delayMinutes !== undefined) {
    await say(ctx, callId, "broker", `The driver is running about ${args.delayMinutes} minutes late.`);
    const r = await ctx.runMutation(internal.voiceTools.reportDelayBroker, {
      callId,
      confirmationNumber: args.confirmationNumber,
      delayMinutes: args.delayMinutes,
      reason: "traffic",
    });
    steps.push({ tool: "report_delay", say: r.say });
    await say(ctx, callId, "agent", r.say);
  }
  if (args.replacementConfirmationNumber && args.replacementWindowStart && args.replacementWindowEnd) {
    await say(ctx, callId, "broker", `Urgent ride arranged. Confirmation ${args.replacementConfirmationNumber}.`);
    const r = await ctx.runMutation(internal.voiceTools.confirmReplacement, {
      callId,
      confirmationNumber: args.replacementConfirmationNumber,
      pickupWindowStart: args.replacementWindowStart,
      pickupWindowEnd: args.replacementWindowEnd,
    });
    steps.push({ tool: "confirm_replacement", say: r.say });
    await say(ctx, callId, "agent", r.say);
  }
  await ctx.runMutation(internal.calls.end, { callId, summary: "simulated broker delay conversation" });
  return steps;
}

const vDelayConversation = {
  delayMinutes: v.optional(v.number()),
  replacementConfirmationNumber: v.optional(v.string()),
  replacementWindowStart: v.optional(v.string()),
  replacementWindowEnd: v.optional(v.string()),
};

/** The broker answers our open delay call. */
export const brokerAnswersDelayCall = internalAction({
  args: { rideId: v.id("rides"), ...vDelayConversation },
  handler: async (ctx, { rideId, ...rest }): Promise<unknown> => {
    const call = await ctx.runQuery(internal.calls.openForRide, { rideId, role: "broker_delay" });
    if (!call) throw new Error("no open delay call for this ride");
    await ctx.runMutation(internal.calls.setStatus, { callId: call._id, status: "in_progress" });
    return await brokerDelayConversation(ctx, call._id, rest);
  },
});

/** The broker calls the system number from the registered broker line to report a delay. */
export const brokerCallsIn = internalAction({
  args: { brokerPhone: v.string(), confirmationNumber: v.string(), ...vDelayConversation },
  handler: async (ctx, { brokerPhone, confirmationNumber, ...rest }): Promise<unknown> => {
    const route = await ctx.runMutation(internal.voiceTools.routeInbound, {
      vapiCallId: `sim_${crypto.randomUUID()}`,
      callerNumber: brokerPhone,
    });
    if (route.kind !== "broker") return { route };
    await ctx.runMutation(internal.calls.setStatus, { callId: route.callId, status: "in_progress" });
    await say(ctx, route.callId, "broker", `This is the ride company. Confirmation ${confirmationNumber}.`);
    const lookup = await ctx.runMutation(internal.voiceTools.lookupRide, { callId: route.callId, confirmationNumber });
    await say(ctx, route.callId, "agent", lookup.say);
    if (!lookup.found) {
      await ctx.runMutation(internal.calls.end, { callId: route.callId });
      return { lookup };
    }
    return { lookup, steps: await brokerDelayConversation(ctx, route.callId, rest) };
  },
});

/** The rider reports a late driver by phone. */
export const riderReportsDelay = internalAction({
  args: { phone: v.string(), minutesLate: v.optional(v.number()) },
  handler: async (ctx, { phone, minutesLate }): Promise<unknown> => {
    const route = await ctx.runMutation(internal.voiceTools.routeInbound, { vapiCallId: `sim_${crypto.randomUUID()}`, callerNumber: phone });
    if (route.kind !== "member") return { route };
    await say(ctx, route.callId, "rider", "My driver is late.");
    const r = await ctx.runMutation(internal.voiceTools.reportDelayRider, { callId: route.callId, minutesLate });
    await say(ctx, route.callId, "agent", r.say);
    await ctx.runMutation(internal.calls.end, { callId: route.callId, summary: "simulated rider delay call" });
    return r;
  },
});

/** Any open outbound call (e.g. the rider callback) is answered and ends. */
export const endOpenCall = internalAction({
  args: { rideId: v.id("rides"), role: v.union(v.literal("broker_booking"), v.literal("broker_delay"), v.literal("rider_callback")) },
  handler: async (ctx, { rideId, role }): Promise<unknown> => {
    const call = await ctx.runQuery(internal.calls.openForRide, { rideId, role });
    if (!call) return null;
    await ctx.runMutation(internal.calls.end, { callId: call._id, summary: "simulated call ended" });
    return call._id;
  },
});
