import { v } from "convex/values";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { vRideStatus } from "./schema";
import { logEvent } from "./events";
import { canTransition, type RideStatus } from "./lib/stateMachine";
import { statusTextBoth } from "./lib/wording";

type RidePatch = Partial<Omit<Doc<"rides">, "_id" | "_creationTime" | "status">>;

/**
 * The only way to change a ride's status. Enforces the state machine and writes a
 * status_change event carrying the rider-facing wording.
 */
export async function transitionRide(
  ctx: MutationCtx,
  rideId: Id<"rides">,
  to: RideStatus,
  reason: string,
  patch: RidePatch = {},
): Promise<Doc<"rides">> {
  const ride = await ctx.db.get(rideId);
  if (!ride) throw new Error(`ride ${rideId} not found`);
  if (!canTransition(ride.status, to)) {
    throw new Error(`invalid ride transition ${ride.status} -> ${to} (${reason})`);
  }
  const extra: RidePatch = { ...patch };
  if (to === "needs_human") extra.needsHuman = true;
  if (to === "completed") extra.completedAt = Date.now();
  await ctx.db.patch(rideId, { ...extra, status: to });
  const updated = { ...ride, ...extra, status: to };
  await logEvent(ctx, {
    rideId,
    kind: "status_change",
    summary: `${ride.status} -> ${to}: ${reason}`,
    payload: { from: ride.status, to, reason },
    riderText: statusTextBoth(to, updated),
  });
  return updated;
}

export const transition = internalMutation({
  args: { rideId: v.id("rides"), to: vRideStatus, reason: v.string() },
  handler: async (ctx, { rideId, to, reason }) => {
    await transitionRide(ctx, rideId, to, reason);
  },
});

const ACTIVE_STATUSES: readonly RideStatus[] = ["booked", "delayed", "late", "recovery_calling", "replacement_booked"];

/** The member's booked-or-later ride that a delay report would apply to (most recent first). */
export async function activeRideForMember(
  ctx: QueryCtx,
  memberId: Id<"members">,
): Promise<Doc<"rides"> | null> {
  const rides = await ctx.db
    .query("rides")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .order("desc")
    .collect();
  return rides.find((r) => ACTIVE_STATUSES.includes(r.status)) ?? null;
}

export async function rideByConfirmation(ctx: QueryCtx, confirmationNumber: string): Promise<Doc<"rides"> | null> {
  const num = confirmationNumber.trim().toUpperCase();
  return (
    (await ctx.db
      .query("rides")
      .withIndex("by_confirmation", (q) => q.eq("brokerConfirmationNumber", num))
      .first()) ??
    (await ctx.db
      .query("rides")
      .withIndex("by_replacement_confirmation", (q) => q.eq("replacementConfirmationNumber", num))
      .first())
  );
}

// ---- Ops dashboard queries ----

export const listLive = query({
  args: {},
  handler: async (ctx) => {
    const rides = await ctx.db.query("rides").order("desc").take(50);
    return await Promise.all(
      rides.map(async (r) => {
        const member = await ctx.db.get(r.memberId);
        const broker = r.brokerId ? await ctx.db.get(r.brokerId) : null;
        return { ...r, memberName: member?.name ?? "?", brokerName: broker?.name ?? null };
      }),
    );
  },
});

export const get = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const ride = await ctx.db.get(rideId);
    if (!ride) return null;
    const member = await ctx.db.get(ride.memberId);
    const broker = ride.brokerId ? await ctx.db.get(ride.brokerId) : null;
    return { ride, member, broker };
  },
});
