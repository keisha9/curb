/// <reference types="vite/client" />
// Phase 1 scenarios from docs/06 (Test checklist), run entirely in text with stubbed
// calls and SMS and the scripted brain (no ANTHROPIC_API_KEY in tests).

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MARIA = "+13105550101";
const JAMES = "+13105550102";
const ROSA = "+13105550103";
const BROKER = "+13105550199";
const STRANGER = "+13105550177";

// Friday Oct 23 2026, 1 PM in Los Angeles.
const START = new Date("2026-10-23T20:00:00Z");
const APPT = "2026-10-24T09:00";
const WINDOW = { pickupWindowStart: "2026-10-24T07:30", pickupWindowEnd: "2026-10-24T07:45" };
// 7:35 AM on the day of the ride: inside the pickup window.
const DURING_WINDOW = new Date("2026-10-24T14:35:00Z");

function setup() {
  const t = convexTest(schema, modules);
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, settle };
}

type T = ReturnType<typeof setup>["t"];

async function rideFor(t: T, phone: string) {
  return await t.run(async (ctx) => {
    const member = await ctx.db
      .query("members")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    const rides = await ctx.db
      .query("rides")
      .withIndex("by_member", (q) => q.eq("memberId", member!._id))
      .collect();
    return rides.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  });
}

async function texts(t: T, rideId: Id<"rides">) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("messages")
        .withIndex("by_ride", (q) => q.eq("rideId", rideId))
        .collect()
    ).map((m) => `${m.template}:${m.status}`),
  );
}

async function callsOf(t: T, rideId: Id<"rides">) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("calls")
        .withIndex("by_ride", (q) => q.eq("rideId", rideId))
        .collect()
    ).map((c) => ({ role: c.role, status: c.status, policyAction: c.policyAction })),
  );
}

/** Seed, book Maria's ride, and have the broker confirm it. */
async function bookMaria(t: T, settle: () => Promise<void>) {
  await t.mutation(api.demo.seed, {});
  await t.action(internal.sim.riderBooks, { phone: MARIA, appointmentAt: APPT });
  await settle();
  const ride = await rideFor(t, MARIA);
  await t.action(internal.sim.brokerConfirmsBooking, { rideId: ride._id, confirmationNumber: "TR-4821", ...WINDOW });
  await settle();
  return ride._id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  process.env.ALLOWED_OUTBOUND_NUMBERS = [MARIA, JAMES, ROSA, BROKER].join(",");
  process.env.PORTAL_BASE_URL = "https://demo.test";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("booking", () => {
  test("inbound Spanish call -> broker call -> booked -> Spanish SMS with link", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    // The demo runs English-only for now; the Spanish path stays supported and tested.
    await t.run(async (ctx) => {
      const maria = await ctx.db
        .query("members")
        .withIndex("by_phone", (q) => q.eq("phone", MARIA))
        .first();
      await ctx.db.patch(maria!._id, { preferredLanguage: "es" });
    });
    const call = (await t.action(internal.sim.riderBooks, { phone: MARIA, appointmentAt: APPT })) as {
      eligibility: { valid: boolean };
    };
    expect(call.eligibility.valid).toBe(true);
    await settle();

    let ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("calling_broker");
    expect(ride.riderConfirmedAt).toBeDefined();
    expect(ride.language).toBe("es");
    expect(await callsOf(t, ride._id)).toEqual([expect.objectContaining({ role: "rider_inbound" }), expect.objectContaining({ role: "broker_booking", status: "ringing" })]);

    await t.action(internal.sim.brokerConfirmsBooking, { rideId: ride._id, confirmationNumber: "tr-4821", ...WINDOW });
    await settle();
    ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("booked");
    expect(ride.brokerConfirmationNumber).toBe("TR4821");

    // The rider hears the confirmation by phone, in Spanish, from recorded fields.
    const callback = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("calls")
          .withIndex("by_ride", (q) => q.eq("rideId", ride._id))
          .collect()
      ).find((c) => c.role === "rider_callback"),
    );
    expect(callback?.language).toBe("es");
    expect(callback?.updateText).toMatch(/^Su transporte está reservado\. Recogida .*7:30.*Confirmación TR4821\.$/);

    const sms = await t.run(async (ctx) => await ctx.db.query("messages").collect());
    expect(sms).toHaveLength(1);
    expect(sms[0]!.status).toBe("stubbed");
    expect(sms[0]!.body).toMatch(/^Su transporte a Demo Dialysis Center esta reservado\. Recogida .*7:30.*Confirmacion TR4821\. Vea sus viajes: https:\/\/demo\.test\/trips\?t=[0-9a-f]{48}$/);

    // The decision log reads as a story.
    const log = await t.query(api.events.byRide, { rideId: ride._id });
    const kinds = log.map((e) => e.kind);
    expect(kinds).toContain("policy_check");
    expect(kinds).toContain("decision");
    expect(kinds).toContain("sms");
  });

  test("expired paperwork (Rosa): declined gently, no broker call, ineligible SMS", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    const res = (await t.action(internal.sim.riderBooks, { phone: ROSA, appointmentAt: APPT })) as {
      eligibility: { valid: boolean; say: string };
      submit: unknown;
    };
    expect(res.eligibility.valid).toBe(false);
    expect(res.submit).toBeNull();
    await settle();
    const ride = await rideFor(t, ROSA);
    expect(ride.status).toBe("ineligible");
    expect((await callsOf(t, ride._id)).map((c) => c.role)).toEqual(["rider_inbound"]);
    expect(await texts(t, ride._id)).toEqual(["ineligible:stubbed"]);
  });

  test("unknown caller is declined and nothing is created", async () => {
    const { t } = setup();
    await t.mutation(api.demo.seed, {});
    const route = await t.mutation(internal.voiceTools.routeInbound, { externalCallId: "v1", callerNumber: STRANGER });
    expect(route.kind).toBe("unknown");
    const rides = await t.run(async (ctx) => await ctx.db.query("rides").collect());
    expect(rides.filter((r) => r.status !== "completed" && r.status !== "cancelled")).toHaveLength(0);
  });

  test("confirmation gate: no rider yes, no request and no booking call", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    const res = (await t.action(internal.sim.riderBooks, { phone: JAMES, appointmentAt: APPT, confirm: false })) as {
      submit: { ok: boolean };
    };
    expect(res.submit.ok).toBe(false);
    await settle();
    const ride = await rideFor(t, JAMES);
    expect(ride.status).toBe("collecting");
    // Even if something asks the brain layer directly, the gate refuses.
    const gate = await t.mutation(internal.brainData.beginBookingCall, { rideId: ride._id });
    expect(gate.ok).toBe(false);
    expect((await callsOf(t, ride._id)).map((c) => c.role)).toEqual(["rider_inbound"]);
  });

  test("allowlist: SMS and calls to unlisted numbers are blocked and logged", async () => {
    const { t, settle } = setup();
    process.env.ALLOWED_OUTBOUND_NUMBERS = MARIA; // broker line not listed
    await t.mutation(api.demo.seed, {});
    await t.action(internal.sim.riderBooks, { phone: MARIA, appointmentAt: APPT });
    await settle();
    const ride = await rideFor(t, MARIA);
    // No broker call went out; the rider (allowlisted) is called back that a person will help.
    expect((await callsOf(t, ride._id)).map((c) => c.role)).toEqual(["rider_inbound", "rider_callback"]);
    expect(ride.status).toBe("needs_human");
    const errors = (await t.query(api.events.byRide, { rideId: ride._id })).filter((e) => e.kind === "error");
    expect(errors.some((e) => e.summary.includes("not in ALLOWED_OUTBOUND_NUMBERS"))).toBe(true);
  });
});

describe("delay reported by the rider", () => {
  test("website report past the threshold -> replacement -> callback and SMS; page updates", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    const member = await t.run(async (ctx) => (await ctx.db.get(rideId))!.memberId);
    const token = await t.mutation(api.demo.openTripsLink, { memberId: member });

    vi.setSystemTime(DURING_WINDOW);
    let trips = (await t.query(api.portal.trips, { token }))!;
    expect(trips.current.map((x) => x.id)).toEqual([rideId]);
    expect(trips.past).toHaveLength(3);
    expect(trips.current[0]!.canReportDelay).toBe(true);

    const res = await t.mutation(api.portal.reportDelay, { token, rideId, minutesLate: 25 });
    expect(res.ok).toBe(true);
    await settle();

    let ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("recovery_calling");
    expect(await callsOf(t, rideId)).toContainEqual({ role: "broker_delay", status: "ringing", policyAction: "request_urgent_replacement" });
    expect(await texts(t, rideId)).toEqual(["booked:stubbed", "delay_received:stubbed"]);

    await t.action(internal.sim.brokerAnswersDelayCall, {
      rideId,
      delayMinutes: 25,
      replacementConfirmationNumber: "TR-4822",
      replacementWindowStart: "2026-10-24T07:55",
      replacementWindowEnd: "2026-10-24T08:05",
    });
    await settle();
    ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("replacement_booked");
    expect(ride.replacementConfirmationNumber).toBe("TR4822");
    // One callback for the booking, one for the replacement; never the same update twice.
    expect((await callsOf(t, rideId)).filter((c) => c.role === "rider_callback")).toHaveLength(2);
    expect(await texts(t, rideId)).toEqual(["booked:stubbed", "delay_received:stubbed", "replacement:stubbed"]);

    // The website shows the replacement live, with rider-safe wording only.
    trips = (await t.query(api.portal.trips, { token }))!;
    expect(trips.current[0]!.statusText.es).toContain("Va en camino otro transporte");
    expect(trips.current[0]!.replacement?.confirmationNumber).toBe("TR4822");
    const detail = (await t.query(api.portal.tripDetail, { token, rideId }))!;
    const timelineText = JSON.stringify(detail.timeline);
    expect(timelineText).not.toMatch(/evaluateDelay|policy|Voice tool|Brain/);
    expect(JSON.stringify(detail)).not.toMatch(/DEMO-9000|Demo Street/); // no IDs or addresses
  });

  test("phone report with no minutes within the threshold -> status check only", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(new Date("2026-10-24T14:35:00Z")); // 5 min into the window
    const r = (await t.action(internal.sim.riderReportsDelay, { phone: MARIA })) as { action: string };
    expect(r.action).toBe("verify_with_broker");
    await settle();
    const ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("booked");
    expect(await callsOf(t, rideId)).toContainEqual({ role: "broker_delay", status: "ringing", policyAction: "verify_with_broker" });

    // The broker says 10 minutes: within the threshold, rider gets the new ETA, no replacement.
    await t.action(internal.sim.brokerAnswersDelayCall, { rideId, delayMinutes: 10 });
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("delayed");
    expect(await texts(t, rideId)).toEqual(["booked:stubbed", "delay_received:stubbed", "delay_update:stubbed"]);
  });

  test("duplicate reports within 2 minutes are ignored and logged", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.mutation(api.demo.simulateDelay, { rideId, as: "rider", delayMinutes: 10 });
    const second = await t.mutation(api.demo.simulateDelay, { rideId, as: "rider", delayMinutes: 10 });
    expect(second.outcome).toBe("duplicate");
    await settle();
    const reports = await t.query(api.delays.byRide, { rideId });
    expect(reports.map((r) => r.ignoredReason ?? "evaluated")).toEqual(["evaluated", "duplicate"]);
  });
});

describe("delay reported by the broker", () => {
  test("broker calls in past the threshold -> replacement on the same call -> rider called back", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    const res = (await t.action(internal.sim.brokerCallsIn, {
      brokerPhone: BROKER,
      confirmationNumber: "TR-4821",
      delayMinutes: 20,
      replacementConfirmationNumber: "TR-4822",
      replacementWindowStart: "2026-10-24T07:55",
      replacementWindowEnd: "2026-10-24T08:05",
    })) as { lookup: { found: boolean; say: string }; steps: { tool: string; say: string }[] };
    expect(res.lookup.found).toBe(true);
    expect(res.lookup.say).not.toMatch(/Demo Street|DEMO-9000/); // minimal info to an unverified caller
    expect(res.steps[0]!.say).toContain("urgent replacement");
    await settle();

    const ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("replacement_booked");
    const roles = (await callsOf(t, rideId)).map((c) => c.role);
    expect(roles).toContain("broker_inbound");
    expect(roles).toContain("rider_callback");
    expect(roles).not.toContain("broker_delay");
    expect(await texts(t, rideId)).toEqual(["booked:stubbed", "replacement:stubbed"]);
    const reports = await t.query(api.delays.byRide, { rideId });
    expect(reports[0]).toMatchObject({ reportedBy: "broker", channel: "broker_call" });
  });

  test("broker reports a delay below the threshold -> rider told the ETA, no replacement", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.action(internal.sim.brokerCallsIn, { brokerPhone: BROKER, confirmationNumber: "TR-4821", delayMinutes: 10 });
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("delayed");
    expect(await texts(t, rideId)).toEqual(["booked:stubbed", "delay_update:stubbed"]);
    expect((await callsOf(t, rideId)).map((c) => c.role)).not.toContain("broker_delay");
  });

  test("broker call-in past the threshold but no replacement given -> we call the broker back", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.action(internal.sim.brokerCallsIn, { brokerPhone: BROKER, confirmationNumber: "TR-4821", delayMinutes: 30 });
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("recovery_calling");
    expect(await callsOf(t, rideId)).toContainEqual({ role: "broker_delay", status: "ringing", policyAction: "request_urgent_replacement" });
  });

  test("ops simulated broker report triggers the same recovery", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.mutation(api.demo.simulateDelay, { as: "broker", delayMinutes: 20 });
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("recovery_calling");
    expect((await callsOf(t, rideId)).map((c) => c.role)).toContain("broker_delay");
    expect(await texts(t, rideId)).toEqual(["booked:stubbed"]); // broker reported: no "we got your report" text
  });

  test("a delay after the replacement is booked escalates to a human", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.action(internal.sim.brokerCallsIn, {
      brokerPhone: BROKER,
      confirmationNumber: "TR-4821",
      delayMinutes: 20,
      replacementConfirmationNumber: "TR-4822",
      replacementWindowStart: "2026-10-24T07:55",
      replacementWindowEnd: "2026-10-24T08:05",
    });
    await settle();
    vi.advanceTimersByTime(30 * 60_000);
    await t.mutation(api.demo.simulateDelay, { rideId, as: "rider", delayMinutes: 40 });
    await settle();
    const ride = await rideFor(t, MARIA);
    expect(ride.status).toBe("needs_human");
    expect(await texts(t, rideId)).toContain("needs_human:stubbed");
  });

  test("a confirmation number misheard with a dash still matches when the broker calls in", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    await t.action(internal.sim.riderBooks, { phone: MARIA, appointmentAt: APPT });
    await settle();
    const rideId = (await rideFor(t, MARIA))._id;
    // Seen on a real call: the broker said "TR-4821" and speech recognition heard "TR482-1".
    await t.action(internal.sim.brokerConfirmsBooking, { rideId, confirmationNumber: "TR482-1", ...WINDOW });
    await settle();
    expect((await rideFor(t, MARIA)).brokerConfirmationNumber).toBe("TR4821");
    const broker = await t.mutation(internal.voiceTools.routeInbound, { externalCallId: "v9", callerNumber: BROKER });
    const hit = await t.mutation(internal.voiceTools.lookupRide, { callId: broker.callId, confirmationNumber: "TR 4821" });
    expect(hit.found).toBe(true);
  });

  test("broker tools cannot be used from a rider call, and lookups miss on wrong numbers", async () => {
    const { t, settle } = setup();
    await bookMaria(t, settle);
    const rider = await t.mutation(internal.voiceTools.routeInbound, { externalCallId: "v2", callerNumber: MARIA });
    await expect(t.mutation(internal.voiceTools.confirmReplacement, { callId: rider.callId, confirmationNumber: "X", ...WINDOW })).rejects.toThrow();
    const broker = await t.mutation(internal.voiceTools.routeInbound, { externalCallId: "v3", callerNumber: BROKER });
    const miss = await t.mutation(internal.voiceTools.lookupRide, { callId: broker.callId, confirmationNumber: "TR-0000" });
    expect(miss.found).toBe(false);
  });
});

describe("rider website scoping", () => {
  test("a token sees only its member's trips, and expired or junk tokens see nothing", async () => {
    const { t, settle } = setup();
    const mariaRide = await bookMaria(t, settle);
    const jamesId = await t.run(async (ctx) =>
      (await ctx.db
        .query("members")
        .withIndex("by_phone", (q) => q.eq("phone", JAMES))
        .first())!._id,
    );
    const jamesToken = await t.mutation(api.demo.openTripsLink, { memberId: jamesId });

    const trips = (await t.query(api.portal.trips, { token: jamesToken }))!;
    expect(trips.past).toHaveLength(1);
    expect([...trips.current, ...trips.upcoming].map((x) => x.id)).not.toContain(mariaRide);
    expect(await t.query(api.portal.tripDetail, { token: jamesToken, rideId: mariaRide })).toBeNull();
    const cross = await t.mutation(api.portal.reportDelay, { token: jamesToken, rideId: mariaRide, minutesLate: 30 });
    expect(cross).toEqual({ ok: false, error: "not_found" });

    expect(await t.query(api.portal.me, { token: "not-a-token" })).toBeNull();
    vi.advanceTimersByTime(15 * 86_400_000); // past the 14-day default
    expect(await t.query(api.portal.trips, { token: jamesToken })).toBeNull();
  });
});

describe("English end to end (James)", () => {
  test("book -> rider calls, no minutes, past the threshold -> replacement -> English callback and SMS", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    await t.action(internal.sim.riderBooks, { phone: JAMES, appointmentAt: APPT });
    await settle();
    const rideId = (await rideFor(t, JAMES))._id;
    expect((await rideFor(t, JAMES)).language).toBe("en");
    await t.action(internal.sim.brokerConfirmsBooking, { rideId, confirmationNumber: "OC-1234", ...WINDOW });
    await settle();

    // 7:50 AM, 20 minutes into the window: the clock alone crosses the threshold.
    vi.setSystemTime(new Date("2026-10-24T14:50:00Z"));
    const r = (await t.action(internal.sim.riderReportsDelay, { phone: JAMES })) as { action: string };
    expect(r.action).toBe("request_urgent_replacement");
    await settle();
    await t.action(internal.sim.brokerAnswersDelayCall, {
      rideId,
      replacementConfirmationNumber: "OC-1235",
      replacementWindowStart: "2026-10-24T08:10",
      replacementWindowEnd: "2026-10-24T08:20",
    });
    await settle();

    expect((await rideFor(t, JAMES)).status).toBe("replacement_booked");
    const bodies = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("messages")
          .withIndex("by_ride", (q) => q.eq("rideId", rideId))
          .collect()
      ).map((m) => `${m.language} ${m.body}`),
    );
    expect(bodies[0]).toMatch(/^en Your ride to Demo Dialysis Center is booked\. Pickup .*7:30 AM - 7:45 AM\. Confirmation OC1234\. See your trips: /);
    expect(bodies[1]).toBe("en We got your report that your driver is late. We are contacting the ride company now.");
    expect(bodies[2]).toMatch(/^en Your driver was late\. A replacement ride is coming\. New pickup .*8:10 AM - 8:20 AM\. Confirmation OC1235\./);
    const callback = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("calls")
          .withIndex("by_ride", (q) => q.eq("rideId", rideId))
          .collect()
      ).find((c) => c.role === "rider_callback"),
    );
    expect(callback?.language).toBe("en");
  });
});

describe("clock rules for broker reports", () => {
  async function brokerCallIn(t: T) {
    const route = await t.mutation(internal.voiceTools.routeInbound, { externalCallId: `v_${Math.random()}`, callerNumber: BROKER });
    await t.mutation(internal.voiceTools.lookupRide, { callId: route.callId, confirmationNumber: "TR-4821" });
    return route.callId;
  }

  test("broker says the driver is late with no time, past the threshold -> urgent replacement", async () => {
    const { t, settle } = setup();
    await bookMaria(t, settle);
    vi.setSystemTime(new Date("2026-10-24T14:50:00Z")); // 20 min into the window
    const callId = await brokerCallIn(t);
    const r = await t.mutation(internal.voiceTools.reportDelayBroker, { callId });
    expect(r.say).toContain("urgent replacement");
    expect((await rideFor(t, MARIA)).status).toBe("recovery_calling");
  });

  test("within the threshold: agent asks for a time, and the follow-up on the same call is not a duplicate", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(new Date("2026-10-24T14:35:00Z")); // 5 min into the window
    const callId = await brokerCallIn(t);
    const first = await t.mutation(internal.voiceTools.reportDelayBroker, { callId });
    expect(first.say).toContain("Ask the broker how many minutes late");
    expect((await rideFor(t, MARIA)).status).toBe("booked");

    const second = await t.mutation(internal.voiceTools.reportDelayBroker, { callId, delayMinutes: 25 });
    expect(second.say).toContain("urgent replacement");
    const reports = await t.query(api.delays.byRide, { rideId });
    expect(reports.map((x) => [x.ignoredReason ?? "evaluated", x.evaluation?.action])).toEqual([
      ["evaluated", "verify_with_broker"],
      ["evaluated", "request_urgent_replacement"],
    ]);
  });

  test("call-in ends with no time given -> brain calls the broker back for status", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(new Date("2026-10-24T14:35:00Z"));
    const callId = await brokerCallIn(t);
    await t.mutation(internal.voiceTools.reportDelayBroker, { callId });
    await t.mutation(internal.calls.end, { callId });
    await settle();
    expect(await callsOf(t, rideId)).toContainEqual({ role: "broker_delay", status: "ringing", policyAction: "verify_with_broker" });
  });

  test("dashboard reports with no time are not judged by the clock, even long past the window", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(new Date("2026-10-24T15:30:00Z")); // an hour into the window
    const res = await t.mutation(internal.delays.report, { rideId, reportedBy: "rider", channel: "ops_dashboard" });
    expect(res.evaluation?.action).toBe("verify_with_broker");
    expect(res.evaluation?.reasonCode).toBe("no_eta_simulated");
    expect((await rideFor(t, MARIA)).status).toBe("booked");
  });
});

describe("missed calls", () => {
  async function endUnanswered(t: T, rideId: Id<"rides">, role: "broker_booking" | "broker_delay" | "rider_callback") {
    const call = await t.query(internal.calls.openForRide, { rideId, role });
    await t.mutation(internal.calls.end, { callId: call!._id });
  }

  test("broker misses the booking call twice -> retried once after 2 minutes, then a person", async () => {
    const { t, settle } = setup();
    await t.mutation(api.demo.seed, {});
    await t.action(internal.sim.riderBooks, { phone: MARIA, appointmentAt: APPT });
    await settle();
    const rideId = (await rideFor(t, MARIA))._id;

    await endUnanswered(t, rideId, "broker_booking");
    await t.finishInProgressScheduledFunctions();
    // The retry waits: nothing new before 2 minutes pass.
    expect((await callsOf(t, rideId)).filter((c) => c.role === "broker_booking")).toHaveLength(1);
    await settle();
    expect((await callsOf(t, rideId)).filter((c) => c.role === "broker_booking")).toHaveLength(2);

    await endUnanswered(t, rideId, "broker_booking");
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("needs_human");
    expect((await callsOf(t, rideId)).filter((c) => c.role === "broker_booking")).toHaveLength(2);
    expect((await callsOf(t, rideId)).map((c) => c.role)).toContain("rider_callback");
  });

  test("rider misses a callback -> one retry with the same update, then 'not reached'", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    await endUnanswered(t, rideId, "rider_callback");
    await settle();
    const callbacks = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("calls")
          .withIndex("by_ride", (q) => q.eq("rideId", rideId))
          .collect()
      ).filter((c) => c.role === "rider_callback"),
    );
    expect(callbacks).toHaveLength(2);
    expect(callbacks[1]!.updateText).toBe(callbacks[0]!.updateText);

    await endUnanswered(t, rideId, "rider_callback");
    await settle();
    expect((await callsOf(t, rideId)).filter((c) => c.role === "rider_callback")).toHaveLength(2);
    const log = await t.query(api.events.byRide, { rideId });
    expect(log.some((e) => e.summary.includes("Rider not reached"))).toBe(true);
    expect((await rideFor(t, MARIA)).status).toBe("booked"); // the ride itself is fine
  });

  test("broker misses the urgent delay call -> retried after 1 minute, not escalated at once", async () => {
    const { t, settle } = setup();
    const rideId = await bookMaria(t, settle);
    vi.setSystemTime(DURING_WINDOW);
    await t.mutation(api.demo.simulateDelay, { rideId, as: "rider", delayMinutes: 25 });
    await settle();
    await endUnanswered(t, rideId, "broker_delay");
    await settle();
    expect((await rideFor(t, MARIA)).status).toBe("recovery_calling");
    expect((await callsOf(t, rideId)).filter((c) => c.role === "broker_delay")).toHaveLength(2);
  });
});

describe("Cartesia webhooks (payload shapes from a real call)", () => {
  const SECRET = "test-secret";
  const CALL = "ac_CAtest123";
  const event = (type: string, extra: Record<string, unknown>) =>
    JSON.stringify({ type, call_id: CALL, agent_id: "agent_x", webhook_id: "agent_webhook_x", webhook_request_id: `w_${Math.random()}`, ...extra });
  const post = (t: T, path: string, body: string, headers: Record<string, string>) =>
    t.fetch(path, { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } });

  test("secret is required on tools and events", async () => {
    process.env.VOICE_WEBHOOK_SECRET = SECRET;
    const { t } = setup();
    expect((await post(t, "/voice/tools/identify_caller", "{}", {})).status).toBe(401);
    expect((await post(t, "/voice/events", "{}", { "X-Webhook-Secret": "wrong" })).status).toBe(401);
  });

  test("inbound call: started -> identify -> numeric-id turns -> completed -> summary, one call row", async () => {
    process.env.VOICE_WEBHOOK_SECRET = SECRET;
    const { t } = setup();
    await t.mutation(api.demo.seed, {});
    const ev = (body: string) => post(t, "/voice/events", body, { "X-Webhook-Secret": SECRET });

    await ev(event("call_started", { body: null, call: { id: CALL, telephony_params: { from: MARIA, to: "+16627802148", direction: "inbound" }, status: "started" } }));
    // identify_caller with a conversation id that may differ from the call id: still one row.
    const idRes = await post(t, "/voice/tools/identify_caller", JSON.stringify({ conversation_id: "conv_other", caller_id: MARIA }), { Authorization: `Bearer ${SECRET}` });
    expect(await idRes.text()).toContain("Caller is the member Maria Gonzalez");

    const turn1 = { id: 1, role: "assistant", text: "Hello, this is PROJECT_NAME.", start_timestamp: 0.2, end_timestamp: 2.1, was_interrupted: false };
    const turn2 = { id: 2, role: "user", text: "Um, I'm Maria.", start_timestamp: 3, end_timestamp: 4, was_interrupted: false };
    const metric = { role: "system", log_metric: { name: "llm_first_text_ms", value: 1193 } };
    const toolTurn = { id: 3, role: "assistant", tool_calls: [{ name: "identify_caller", arguments: {}, result: "..." }] };
    await ev(event("call_turn", { body: turn1 }));
    await ev(event("call_turn", { body: turn2 }));
    await ev(event("call_completed", { body: [turn1, turn2, metric, toolTurn] }));
    await ev(event("post_call_analysis", { body: null, analysis: { summary: "Maria asked for a ride." } }));

    const calls = await t.run(async (ctx) => await ctx.db.query("calls").collect());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: "rider_inbound", status: "ended", answered: true, summary: "Maria asked for a ride." });
    const lines = await t.run(async (ctx) => await ctx.db.query("transcriptLines").collect());
    expect(lines.map((l) => `${l.speaker}: ${l.text}`)).toEqual(["agent: Hello, this is PROJECT_NAME.", "rider: Um, I'm Maria."]);
    const errors = await t.run(async (ctx) => (await ctx.db.query("agentEvents").collect()).filter((e) => e.kind === "error"));
    expect(errors).toEqual([]);
  });
});
