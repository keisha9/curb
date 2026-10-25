// Demo setup and ops controls. DEMO ONLY: these are public with no login, like the
// ops dashboard itself (documented in README "Known limitations"). Fake data only.

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { vReportedBy } from "./schema";
import { logEvent } from "./events";
import { activeRideForMember } from "./rides";
import { reportDelay } from "./delays";
import { checkOutbound } from "./lib/safety";
import { DAY } from "./lib/policy";
import { hashToken, newRawToken, tokenTtlMs } from "./lib/tokens";

const HOUR = 3_600_000;

// Fictional 555-01xx numbers unless you set real test numbers you control.
function seedPhones() {
  return {
    maria: process.env.DEMO_MARIA_PHONE ?? "+13105550101",
    james: process.env.DEMO_JAMES_PHONE ?? "+13105550102",
    rosa: process.env.DEMO_ROSA_PHONE ?? "+13105550103",
    broker: process.env.DEMO_BROKER_PHONE ?? "+13105550199",
  };
}

async function getDemoState(ctx: MutationCtx): Promise<Doc<"demoState">> {
  const existing = await ctx.db.query("demoState").first();
  if (existing) return existing;
  const id = await ctx.db.insert("demoState", { delayMinutes: 20, brokerLine: seedPhones().broker });
  return (await ctx.db.get(id))!;
}

type SeedMember = Omit<Doc<"members">, "_id" | "_creationTime">;

async function upsertMember(ctx: MutationCtx, m: SeedMember): Promise<Id<"members">> {
  const existing = await ctx.db
    .query("members")
    .withIndex("by_phone", (q) => q.eq("phone", m.phone))
    .first();
  if (existing) {
    await ctx.db.replace(existing._id, m);
    return existing._id;
  }
  return await ctx.db.insert("members", m);
}

async function addPastTrip(
  ctx: MutationCtx,
  memberId: Id<"members">,
  member: SeedMember,
  brokerId: Id<"brokers">,
  daysAgo: number,
  status: "completed" | "cancelled",
  confirmation: string,
) {
  const appointmentAt = Date.now() - daysAgo * DAY;
  const pickup = appointmentAt - HOUR;
  const rideId = await ctx.db.insert("rides", {
    memberId,
    status,
    appointmentAt,
    appointmentType: "dialysis",
    destinationName: "Demo Dialysis Center",
    destinationAddress: "500 Sample Blvd, Los Angeles, CA",
    pickupAddress: member.address,
    mobilitySnapshot: member.mobility,
    riderConfirmedAt: pickup - DAY,
    brokerId,
    brokerConfirmationNumber: confirmation,
    pickupWindowStart: pickup,
    pickupWindowEnd: pickup + 15 * 60_000,
    completedAt: status === "completed" ? appointmentAt + 3 * HOUR : undefined,
    language: member.preferredLanguage,
    needsHuman: false,
    createdAt: pickup - 2 * DAY,
  });
  await ctx.db.insert("agentEvents", {
    rideId,
    kind: "status_change",
    summary: `seeded past trip (${status})`,
    riderText: status === "completed" ? { en: "Trip completed.", es: "Viaje completado." } : { en: "Trip cancelled.", es: "Viaje cancelado." },
    createdAt: status === "completed" ? appointmentAt + 3 * HOUR : pickup - DAY,
  });
}

/** Loads fake members, brokers, and past trips. Safe to run again: members and brokers are upserted by phone. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const phones = seedPhones();

    const brokers = [
      { name: "Call the Car (mock)", plan: "L.A. Care", phone: phones.broker, advanceNoticeHours: 24 },
      { name: "Orange County Rides (mock)", plan: "CalOptima", phone: phones.broker, advanceNoticeHours: 48 },
    ];
    const brokerIds: Record<string, Id<"brokers">> = {};
    for (const b of brokers) {
      const existing = await ctx.db
        .query("brokers")
        .withIndex("by_plan", (q) => q.eq("plan", b.plan))
        .first();
      brokerIds[b.plan] = existing ? (await ctx.db.replace(existing._id, b), existing._id) : await ctx.db.insert("brokers", b);
    }

    const maria: SeedMember = {
      name: "Maria Gonzalez",
      phone: phones.maria,
      preferredLanguage: "es",
      medicalId: "DEMO-90000001",
      plan: "L.A. Care",
      address: "123 Demo Street, Los Angeles, CA",
      mobility: "wheelchair",
      rideType: "NEMT",
      pcsExpiresAt: now + 150 * DAY,
      agentAuthorizedAt: now,
    };
    const james: SeedMember = {
      name: "James Carter",
      phone: phones.james,
      preferredLanguage: "en",
      medicalId: "DEMO-90000002",
      plan: "CalOptima",
      address: "456 Sample Road, Santa Ana, CA",
      mobility: "ambulatory",
      rideType: "NMT",
      nmtApprovalExpiresAt: now + 200 * DAY,
      agentAuthorizedAt: now,
    };
    const rosa: SeedMember = {
      name: "Rosa Delgado",
      phone: phones.rosa,
      preferredLanguage: "es",
      medicalId: "DEMO-90000003",
      plan: "L.A. Care",
      address: "789 Placeholder Ave, Los Angeles, CA",
      mobility: "wheelchair",
      rideType: "NEMT",
      pcsExpiresAt: now - 20 * DAY, // expired: shows the ineligible path
      agentAuthorizedAt: now,
    };

    const ids = {
      maria: await upsertMember(ctx, maria),
      james: await upsertMember(ctx, james),
      rosa: await upsertMember(ctx, rosa),
    };

    const hasRides = async (memberId: Id<"members">) =>
      (await ctx.db
        .query("rides")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .first()) !== null;
    if (!(await hasRides(ids.maria))) {
      await addPastTrip(ctx, ids.maria, maria, brokerIds["L.A. Care"]!, 2, "completed", "TR-3101");
      await addPastTrip(ctx, ids.maria, maria, brokerIds["L.A. Care"]!, 4, "completed", "TR-3087");
      await addPastTrip(ctx, ids.maria, maria, brokerIds["L.A. Care"]!, 9, "cancelled", "TR-3012");
    }
    if (!(await hasRides(ids.james))) {
      await addPastTrip(ctx, ids.james, james, brokerIds["CalOptima"]!, 5, "completed", "OC-7720");
    }

    const state = await getDemoState(ctx);
    await ctx.db.patch(state._id, { brokerLine: phones.broker });
    const allowlistWarnings = Object.entries(phones)
      .map(([who, phone]) => ({ who, check: checkOutbound(phone) }))
      .filter((x) => !x.check.ok)
      .map((x) => `${x.who}: ${(x.check as { reason: string }).reason}`);
    await logEvent(ctx, { kind: "decision", summary: "Demo data seeded", payload: { allowlistWarnings } });
    return { members: ids, brokers: brokerIds, allowlistWarnings };
  },
});

const RESET_TABLES = ["rides", "calls", "transcriptLines", "delayReports", "agentEvents", "messages", "portalTokens", "llmUsage"] as const;

/** Clears rides, calls, transcripts, reports, events, texts, tokens, and usage. Keeps members and brokers. */
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of RESET_TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      counts[table] = rows.length;
    }
    const state = await getDemoState(ctx);
    await ctx.db.patch(state._id, { activeRideId: undefined });
    return counts;
  },
});

export const state = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("demoState").first();
    const members = await ctx.db.query("members").collect();
    return {
      delayMinutes: s?.delayMinutes ?? 20,
      brokerLine: s?.brokerLine ?? null,
      activeRideId: s?.activeRideId ?? null,
      members: members.map((m) => ({ id: m._id, name: m.name, language: m.preferredLanguage, plan: m.plan })),
    };
  },
});

/** Ops control: report a delay as the rider or as the broker (channel ops_dashboard). */
export const simulateDelay = mutation({
  args: {
    rideId: v.optional(v.id("rides")),
    as: vReportedBy,
    delayMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await getDemoState(ctx);
    let rideId = args.rideId ?? state.activeRideId;
    if (!rideId) {
      // Most recent ride that is booked or later.
      const candidates = await ctx.db.query("rides").order("desc").take(20);
      for (const r of candidates) {
        const active = await activeRideForMember(ctx, r.memberId);
        if (active) {
          rideId = active._id;
          break;
        }
      }
    }
    if (!rideId) throw new Error("no booked ride to delay");
    return await reportDelay(ctx, {
      rideId,
      reportedBy: args.as,
      channel: "ops_dashboard",
      delayMinutes: args.delayMinutes ?? state.delayMinutes,
      note: "simulated from the ops dashboard",
    });
  },
});

export const setDelayMinutes = mutation({
  args: { delayMinutes: v.number() },
  handler: async (ctx, { delayMinutes }) => {
    if (!Number.isFinite(delayMinutes) || delayMinutes < 0 || delayMinutes > 240) throw new Error("delayMinutes must be 0-240");
    const state = await getDemoState(ctx);
    await ctx.db.patch(state._id, { delayMinutes });
  },
});

export const setActiveRide = mutation({
  args: { rideId: v.optional(v.id("rides")) },
  handler: async (ctx, { rideId }) => {
    const state = await getDemoState(ctx);
    await ctx.db.patch(state._id, { activeRideId: rideId });
  },
});

/** Changes the human broker's number for every broker; must be on the allowlist. */
export const setBrokerLine = mutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const check = checkOutbound(phone.trim());
    if (!check.ok) throw new Error(check.reason);
    for (const b of await ctx.db.query("brokers").collect()) await ctx.db.patch(b._id, { phone: phone.trim() });
    const state = await getDemoState(ctx);
    await ctx.db.patch(state._id, { brokerLine: phone.trim() });
    await logEvent(ctx, { kind: "decision", summary: `Broker line set to ${phone.trim()}` });
  },
});

/** Ops backup (docs/07 section 5): open a member's trips site with a fresh link. */
export const openTripsLink = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    if (!(await ctx.db.get(memberId))) throw new Error("member not found");
    const raw = newRawToken();
    const now = Date.now();
    await ctx.db.insert("portalTokens", { memberId, tokenHash: await hashToken(raw), createdAt: now, expiresAt: now + tokenTtlMs() });
    return raw;
  },
});
