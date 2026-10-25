// Database reads and writes the brain needs. Guardrails that must hold no matter what
// the model asks for (rider confirmation gate, call limits) are enforced here.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { logEvent } from "./events";
import { transitionRide } from "./rides";
import { reportDelay } from "./delays";
import { canTransition } from "./lib/stateMachine";
import type { Doc, Id } from "./_generated/dataModel";

export type BrainCall = Pick<Doc<"calls">, "role" | "status" | "policyAction" | "delayReportId" | "outcome" | "summary" | "updateText" | "answered" | "createdAt"> & {
  _id: Id<"calls">;
};
export type BrainContext = {
  ride: Doc<"rides">;
  member: Doc<"members"> | null;
  broker: Doc<"brokers"> | null;
  reports: Doc<"delayReports">[];
  calls: BrainCall[];
  smsTemplatesSent: string[];
};

export const MAX_BOOKING_CALLS_PER_RIDE = 2;
export const MAX_DELAY_CALLS_PER_REPORT = 2;

export const getContext = internalQuery({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }): Promise<BrainContext | null> => {
    const ride = await ctx.db.get(rideId);
    if (!ride) return null;
    const member = await ctx.db.get(ride.memberId);
    const broker = ride.brokerId ? await ctx.db.get(ride.brokerId) : null;
    const reports = await ctx.db
      .query("delayReports")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    return {
      ride,
      member,
      broker,
      reports,
      calls: calls.map((c) => ({
        _id: c._id,
        role: c.role,
        status: c.status,
        policyAction: c.policyAction,
        delayReportId: c.delayReportId,
        outcome: c.outcome,
        summary: c.summary,
        updateText: c.updateText,
        answered: c.answered,
        createdAt: c.createdAt,
      })),
      smsTemplatesSent: messages.filter((m) => m.status === "sent" || m.status === "stubbed").map((m) => m.template ?? ""),
    };
  },
});

export const recordDecision = internalMutation({
  args: { rideId: v.id("rides"), text: v.string(), payload: v.optional(v.any()) },
  handler: async (ctx, { rideId, text, payload }) => {
    await logEvent(ctx, { rideId, kind: "decision", summary: text, payload });
  },
});

export const flagNeedsHuman = internalMutation({
  args: { rideId: v.id("rides"), reason: v.string() },
  handler: async (ctx, { rideId, reason }) => {
    const ride = await ctx.db.get(rideId);
    if (!ride) return { ok: false, error: "ride not found" };
    if (ride.status === "needs_human") return { ok: true };
    if (!canTransition(ride.status, "needs_human")) {
      await ctx.db.patch(rideId, { needsHuman: true });
      await logEvent(ctx, { rideId, kind: "decision", summary: `Flagged for a human: ${reason}` });
      return { ok: true };
    }
    await transitionRide(ctx, rideId, "needs_human", reason);
    return { ok: true };
  },
});

/**
 * Gate for every booking call (CLAUDE.md hard rule 5): refuses unless the rider
 * confirmed. Moves requested -> calling_broker on the first attempt.
 */
export const beginBookingCall = internalMutation({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const ride = await ctx.db.get(rideId);
    if (!ride) return { ok: false as const, error: "ride not found" };
    if (ride.riderConfirmedAt === undefined) {
      await logEvent(ctx, { rideId, kind: "error", summary: "Refused booking call: rider has not confirmed (riderConfirmedAt unset)" });
      return { ok: false as const, error: "rider has not confirmed this ride; booking calls are not allowed" };
    }
    if (ride.status !== "requested" && ride.status !== "calling_broker") {
      return { ok: false as const, error: `ride is ${ride.status}; a booking call is not needed` };
    }
    const attempts = (
      await ctx.db
        .query("calls")
        .withIndex("by_ride", (q) => q.eq("rideId", rideId))
        .collect()
    ).filter((c) => c.role === "broker_booking").length;
    if (attempts >= MAX_BOOKING_CALLS_PER_RIDE) {
      return { ok: false as const, error: `already made ${attempts} booking calls; flag for a human instead` };
    }
    if (ride.status === "requested") await transitionRide(ctx, rideId, "calling_broker", "placing booking call");
    return { ok: true as const, attempt: attempts + 1 };
  },
});

/** Before a delay call: moves late -> recovery_calling when a replacement will be requested. */
export const beginDelayCall = internalMutation({
  args: { rideId: v.id("rides"), delayReportId: v.optional(v.id("delayReports")) },
  handler: async (ctx, { rideId, delayReportId }) => {
    const ride = await ctx.db.get(rideId);
    if (!ride) return { ok: false as const, error: "ride not found" };
    const calls = (
      await ctx.db
        .query("calls")
        .withIndex("by_ride", (q) => q.eq("rideId", rideId))
        .collect()
    ).filter((c) => c.role === "broker_delay" && c.delayReportId === delayReportId);
    if (calls.length >= MAX_DELAY_CALLS_PER_REPORT) {
      return { ok: false as const, error: `already made ${calls.length} delay calls for this report; flag for a human instead` };
    }
    if (ride.status === "late") {
      await transitionRide(ctx, rideId, "recovery_calling", "calling the broker for an urgent replacement", {
        replacementRequestedAt: Date.now(),
      });
      return { ok: true as const, policyAction: "request_urgent_replacement" as const };
    }
    if (ride.status === "recovery_calling") return { ok: true as const, policyAction: "request_urgent_replacement" as const };
    if (ride.status === "booked" || ride.status === "delayed") return { ok: true as const, policyAction: "verify_with_broker" as const };
    return { ok: false as const, error: `ride is ${ride.status}; no delay call needed` };
  },
});

export const markReportHandled = internalMutation({
  args: { delayReportId: v.id("delayReports") },
  handler: async (ctx, { delayReportId }) => {
    await ctx.db.patch(delayReportId, { handledAt: Date.now() });
  },
});

/** Apply an extracted booking when the broker gave one but the tool was not called on the call. */
export const applyExtractedBooking = internalMutation({
  args: { rideId: v.id("rides"), confirmationNumber: v.string(), pickupWindowStart: v.number(), pickupWindowEnd: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ride = await ctx.db.get(args.rideId);
    if (!ride || ride.status !== "calling_broker") return { ok: false };
    await transitionRide(ctx, args.rideId, "booked", "booking taken from the call transcript", {
      brokerConfirmationNumber: args.confirmationNumber.trim().toUpperCase(),
      pickupWindowStart: args.pickupWindowStart,
      pickupWindowEnd: args.pickupWindowEnd,
    });
    return { ok: true };
  },
});

export const applyExtractedReplacement = internalMutation({
  args: { rideId: v.id("rides"), confirmationNumber: v.string(), pickupWindowStart: v.number(), pickupWindowEnd: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ride = await ctx.db.get(args.rideId);
    if (!ride || (ride.status !== "late" && ride.status !== "recovery_calling")) return { ok: false };
    if (ride.status === "late") await transitionRide(ctx, args.rideId, "recovery_calling", "replacement found in transcript");
    await transitionRide(ctx, args.rideId, "replacement_booked", "replacement taken from the call transcript", {
      replacementConfirmationNumber: args.confirmationNumber.trim().toUpperCase(),
      replacementWindowStart: args.pickupWindowStart,
      replacementWindowEnd: args.pickupWindowEnd,
    });
    return { ok: true };
  },
});

/** Apply an extracted delay or ETA as a broker report when report_delay was not called on the call. */
export const applyExtractedDelay = internalMutation({
  args: {
    rideId: v.id("rides"),
    callId: v.id("calls"),
    delayMinutes: v.optional(v.number()),
    newEstimatedPickupAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const already = (
      await ctx.db
        .query("delayReports")
        .withIndex("by_ride", (q) => q.eq("rideId", args.rideId))
        .collect()
    ).some((r) => r.callId === args.callId);
    if (already) return { ok: false };
    await reportDelay(ctx, {
      rideId: args.rideId,
      reportedBy: "broker",
      channel: "broker_call",
      callId: args.callId,
      delayMinutes: args.delayMinutes,
      newEstimatedPickupAt: args.newEstimatedPickupAt,
      reason: "from call transcript",
    });
    return { ok: true };
  },
});
