import { v, type Infer } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { vDelayChannel, vDelayEvaluation, vReportedBy } from "./schema";
import { logEvent } from "./events";
import { transitionRide } from "./rides";
import { evaluateDelay, isDuplicateReport } from "./lib/policy";
import { formatDateTime } from "./lib/wording";

export type DelayChannel = "rider_call" | "rider_web" | "broker_call" | "ops_dashboard";

export type DelayReportInput = {
  rideId: Id<"rides">;
  reportedBy: "rider" | "broker";
  channel: DelayChannel;
  callId?: Id<"calls">;
  delayMinutes?: number;
  newEstimatedPickupAt?: number;
  reason?: string;
  note?: string;
};

export type DelayReportResult = {
  reportId: Id<"delayReports">;
  outcome: "evaluated" | "duplicate" | "attached_to_open_recovery";
  evaluation: Infer<typeof vDelayEvaluation> | null;
  rideStatus: Doc<"rides">["status"];
};

const CHANNEL_LABEL: Record<DelayChannel, string> = {
  rider_call: "rider by phone",
  rider_web: "rider on the website",
  broker_call: "broker by phone",
  ops_dashboard: "ops dashboard (simulated)",
};

function describe(input: DelayReportInput): string {
  const parts = [`Delay reported by ${input.reportedBy} via ${CHANNEL_LABEL[input.channel]}`];
  if (input.delayMinutes !== undefined) parts.push(`${input.delayMinutes} min late`);
  if (input.newEstimatedPickupAt !== undefined) parts.push(`new ETA ${formatDateTime(input.newEstimatedPickupAt, "en")}`);
  if (input.reason) parts.push(`reason: ${input.reason}`);
  return parts.join(", ");
}

/**
 * Single entry point for every delay report, from any channel (docs/04, delays.report).
 * Runs the deterministic policy synchronously and returns the evaluation so a voice
 * tool can answer immediately. Schedules the brain except for live broker calls,
 * where the brain waits for the end-of-call report.
 */
export async function reportDelay(ctx: MutationCtx, input: DelayReportInput): Promise<DelayReportResult> {
  const now = Date.now();
  const ride = await ctx.db.get(input.rideId);
  if (!ride) throw new Error(`ride ${input.rideId} not found`);

  const previous = await ctx.db
    .query("delayReports")
    .withIndex("by_ride", (q) => q.eq("rideId", input.rideId))
    .collect();
  const lastEvaluation = [...previous].reverse().find((r) => r.evaluation)?.evaluation ?? null;
  const fields = {
    rideId: input.rideId,
    reportedBy: input.reportedBy,
    channel: input.channel,
    callId: input.callId,
    delayMinutes: input.delayMinutes,
    newEstimatedPickupAt: input.newEstimatedPickupAt,
    reason: input.reason,
    note: input.note,
    createdAt: now,
  };

  // Repeat from the same channel within the duplicate window: log, do not re-evaluate.
  if (isDuplicateReport(previous, input.channel, now)) {
    const reportId = await ctx.db.insert("delayReports", { ...fields, ignoredReason: "duplicate" });
    await logEvent(ctx, {
      rideId: input.rideId,
      kind: "delay_report",
      summary: `${describe(input)} (duplicate, ignored)`,
      payload: { reportId, ...input },
    });
    return { reportId, outcome: "duplicate", evaluation: lastEvaluation, rideStatus: ride.status };
  }

  // A recovery is already open: attach the report to it instead of starting a new one.
  if (ride.status === "late" || ride.status === "recovery_calling") {
    const reportId = await ctx.db.insert("delayReports", { ...fields, ignoredReason: "attached_to_open_recovery" });
    const eta =
      input.newEstimatedPickupAt ??
      (input.delayMinutes !== undefined && ride.pickupWindowStart !== undefined
        ? ride.pickupWindowStart + input.delayMinutes * 60_000
        : undefined);
    if (eta !== undefined) await ctx.db.patch(input.rideId, { estimatedPickupAt: eta });
    await logEvent(ctx, {
      rideId: input.rideId,
      kind: "delay_report",
      summary: `${describe(input)} (attached to the open recovery)`,
      payload: { reportId, ...input },
    });
    return { reportId, outcome: "attached_to_open_recovery", evaluation: lastEvaluation, rideStatus: ride.status };
  }

  const evaluation = evaluateDelay(ride, input, now);
  const reportId = await ctx.db.insert("delayReports", { ...fields, evaluation });
  await logEvent(ctx, {
    rideId: input.rideId,
    kind: "delay_report",
    summary: describe(input),
    payload: { reportId, ...input },
  });
  await logEvent(ctx, {
    rideId: input.rideId,
    kind: "policy_check",
    summary: `evaluateDelay: ${evaluation.action} (${evaluation.reasonCode}, ${evaluation.minutesPastWindowStart ?? "?"} min past window start, threshold ${evaluation.thresholdMinutes})`,
    payload: { reportId, evaluation },
  });

  const patch = {
    firstDelayReportedAt: ride.firstDelayReportedAt ?? now,
    ...(evaluation.projectedPickupAt !== null ? { estimatedPickupAt: evaluation.projectedPickupAt } : {}),
  };
  let rideStatus: Doc<"rides">["status"] = ride.status;
  switch (evaluation.action) {
    case "reject":
      break;
    case "escalate_to_human":
      rideStatus = (await transitionRide(ctx, ride._id, "needs_human", "replacement ride also delayed", patch)).status;
      break;
    case "request_urgent_replacement":
      rideStatus = (await transitionRide(ctx, ride._id, "late", `delay past threshold (${evaluation.reasonCode})`, patch)).status;
      break;
    case "verify_with_broker":
      await ctx.db.patch(ride._id, patch);
      await logEvent(ctx, {
        rideId: ride._id,
        kind: "decision",
        summary: "Driver not here yet but still within the threshold: check driver status with the broker",
        riderText: {
          en: "We got your report. We are checking with the ride company.",
          es: "Recibimos su aviso. Estamos consultando con la empresa de transporte.",
        },
      });
      break;
    case "notify_rider_only":
      if (ride.status === "booked") {
        rideStatus = (await transitionRide(ctx, ride._id, "delayed", "delay within threshold", patch)).status;
      } else {
        // Already delayed: record the new ETA and tell the rider.
        await ctx.db.patch(ride._id, patch);
        const eta = patch.estimatedPickupAt;
        if (eta !== undefined) {
          await logEvent(ctx, {
            rideId: ride._id,
            kind: "status_change",
            summary: "Updated estimated pickup",
            riderText: {
              en: `Your driver is running late. New estimated pickup ${formatDateTime(eta, "en")}.`,
              es: `Su conductor se retrasó. Nueva hora estimada de recogida ${formatDateTime(eta, "es")}.`,
            },
          });
        }
      }
      break;
  }

  if (evaluation.action !== "reject" && input.channel !== "broker_call") {
    await ctx.scheduler.runAfter(0, internal.brain.run, {
      rideId: ride._id,
      trigger: "delay_reported",
      delayReportId: reportId,
    });
  }
  return { reportId, outcome: "evaluated", evaluation, rideStatus };
}

export const report = internalMutation({
  args: {
    rideId: v.id("rides"),
    reportedBy: vReportedBy,
    channel: vDelayChannel,
    callId: v.optional(v.id("calls")),
    delayMinutes: v.optional(v.number()),
    newEstimatedPickupAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => await reportDelay(ctx, args),
});

/** Ops dashboard: delay reports with who reported, channel, and the policy evaluation. */
export const byRide = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    return await ctx.db
      .query("delayReports")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .order("asc")
      .collect();
  },
});
