// Rider trips website API (docs/04 section 3). Every function takes the token,
// resolves it to exactly one member, and returns only that member's rider-safe data:
// no transcripts, no decision log, no internal fields (CLAUDE.md hard rule 9).

import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { reportDelay as reportDelayCore } from "./delays";
import { daysUntilExpiry, EXPIRY_ALERT_DAYS } from "./lib/policy";
import { hashToken, newRawToken, tokenTtlMs } from "./lib/tokens";
import { tripGroup } from "./lib/trips";
import { statusTextBoth, type Bilingual } from "./lib/wording";

/** Creates a token for the member's SMS link and returns the raw value (never stored). */
export const issueToken = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const raw = newRawToken();
    const now = Date.now();
    await ctx.db.insert("portalTokens", {
      memberId,
      tokenHash: await hashToken(raw),
      createdAt: now,
      expiresAt: now + tokenTtlMs(),
    });
    return raw;
  },
});

async function resolveToken(ctx: QueryCtx, token: string): Promise<Doc<"portalTokens"> | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const hash = await hashToken(token);
  const found = await ctx.db
    .query("portalTokens")
    .withIndex("by_hash", (q) => q.eq("tokenHash", hash))
    .first();
  if (!found || found.revokedAt !== undefined || found.expiresAt < Date.now()) return null;
  return found;
}

type PortalTrip = {
  id: Id<"rides">;
  group: "current" | "upcoming" | "past";
  appointmentAt: number | null;
  appointmentType: string | null;
  destinationName: string | null;
  status: Doc<"rides">["status"];
  statusText: Bilingual;
  pickupWindowStart: number | null;
  pickupWindowEnd: number | null;
  estimatedPickupAt: number | null;
  confirmationNumber: string | null;
  replacement: { confirmationNumber: string; windowStart: number | null; windowEnd: number | null } | null;
  canReportDelay: boolean;
};

const DELAY_REPORTABLE = new Set(["booked", "delayed", "late", "recovery_calling", "replacement_booked"]);

function toPortalTrip(ride: Doc<"rides">, group: PortalTrip["group"]): PortalTrip {
  return {
    id: ride._id,
    group,
    appointmentAt: ride.appointmentAt ?? null,
    appointmentType: ride.appointmentType ?? null,
    destinationName: ride.destinationName ?? null,
    status: ride.status,
    statusText: statusTextBoth(ride.status, ride),
    pickupWindowStart: ride.pickupWindowStart ?? null,
    pickupWindowEnd: ride.pickupWindowEnd ?? null,
    estimatedPickupAt: ride.estimatedPickupAt ?? null,
    confirmationNumber: ride.brokerConfirmationNumber ?? null,
    replacement: ride.replacementConfirmationNumber
      ? {
          confirmationNumber: ride.replacementConfirmationNumber,
          windowStart: ride.replacementWindowStart ?? null,
          windowEnd: ride.replacementWindowEnd ?? null,
        }
      : null,
    canReportDelay: group === "current" && DELAY_REPORTABLE.has(ride.status) && ride.status !== "late" && ride.status !== "recovery_calling",
  };
}

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await resolveToken(ctx, token);
    if (!t) return null;
    const member = await ctx.db.get(t.memberId);
    if (!member) return null;
    const days = daysUntilExpiry(member, Date.now());
    return {
      firstName: member.name.split(" ")[0] ?? member.name,
      language: member.preferredLanguage,
      paperworkNotice:
        days !== null && days >= 0 && days <= EXPIRY_ALERT_DAYS
          ? { daysLeft: days, kind: member.rideType === "NEMT" ? ("PCS" as const) : ("NMT_APPROVAL" as const) }
          : null,
    };
  },
});

export const trips = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await resolveToken(ctx, token);
    if (!t) return null;
    const rides = await ctx.db
      .query("rides")
      .withIndex("by_member", (q) => q.eq("memberId", t.memberId))
      .collect();
    const now = Date.now();
    const out = { current: [] as PortalTrip[], upcoming: [] as PortalTrip[], past: [] as PortalTrip[] };
    for (const ride of rides) {
      const group = tripGroup(ride, now);
      if (group === "hidden") continue;
      out[group].push(toPortalTrip(ride, group));
    }
    const byTime = (a: PortalTrip, b: PortalTrip) => (a.appointmentAt ?? 0) - (b.appointmentAt ?? 0);
    out.current.sort(byTime);
    out.upcoming.sort(byTime);
    out.past.sort((a, b) => -byTime(a, b));
    return out;
  },
});

const CALL_LABEL: Partial<Record<Doc<"calls">["role"], Bilingual>> = {
  rider_inbound: { en: "You called us.", es: "Usted nos llamó." },
  broker_booking: { en: "We called the ride company.", es: "Llamamos a la empresa de transporte." },
  broker_delay: { en: "We called the ride company about the delay.", es: "Llamamos a la empresa de transporte por el retraso." },
  broker_inbound: { en: "The ride company called us.", es: "La empresa de transporte nos llamó." },
  rider_callback: { en: "We called you with an update.", es: "Le llamamos con una actualización." },
};

export const tripDetail = query({
  args: { token: v.string(), rideId: v.id("rides") },
  handler: async (ctx, { token, rideId }) => {
    const t = await resolveToken(ctx, token);
    if (!t) return null;
    const ride = await ctx.db.get(rideId);
    if (!ride || ride.memberId !== t.memberId) return null;
    const group = tripGroup(ride, Date.now());
    if (group === "hidden") return null;

    const events = await ctx.db
      .query("agentEvents")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_ride", (q) => q.eq("rideId", rideId))
      .collect();
    // Only events that carry rider wording, plus a plain label per call. Never transcripts or summaries.
    const timeline = [
      ...events.filter((e) => e.riderText).map((e) => ({ at: e.createdAt, text: e.riderText! })),
      ...calls.flatMap((c) => (CALL_LABEL[c.role] ? [{ at: c.createdAt, text: CALL_LABEL[c.role]! }] : [])),
    ].sort((a, b) => a.at - b.at);

    return { trip: toPortalTrip(ride, group), timeline };
  },
});

export const reportDelay = mutation({
  args: {
    token: v.string(),
    rideId: v.id("rides"),
    minutesLate: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { token, rideId, minutesLate, note }) => {
    const t = await resolveToken(ctx, token);
    if (!t) return { ok: false as const, error: "invalid_link" };
    const ride = await ctx.db.get(rideId);
    if (!ride || ride.memberId !== t.memberId) return { ok: false as const, error: "not_found" };
    if (minutesLate !== undefined && (!Number.isFinite(minutesLate) || minutesLate < 0 || minutesLate > 600)) {
      return { ok: false as const, error: "bad_minutes" };
    }
    await ctx.db.patch(t._id, { lastUsedAt: Date.now() });
    const result = await reportDelayCore(ctx, {
      rideId,
      reportedBy: "rider",
      channel: "rider_web",
      delayMinutes: minutesLate,
      note: note?.slice(0, 500),
    });
    const updated = (await ctx.db.get(rideId))!;
    return {
      ok: true as const,
      outcome: result.outcome,
      statusText: statusTextBoth(updated.status, updated),
    };
  },
});
