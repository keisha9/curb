import { describe, expect, test } from "vitest";
import {
  DAY,
  DRIVER_LATE_THRESHOLD_MINUTES,
  MINUTE,
  daysUntilExpiry,
  evaluateDelay,
  isDuplicateReport,
  normalizeConfirmation,
  paperworkStatus,
} from "./policy";
import { checkOutbound, parseAllowlist } from "./safety";
import { canTransition } from "./stateMachine";
import { parseLocalIso } from "./time";
import { tripGroup } from "./trips";
import { renderSms, statusText } from "./wording";

const NOW = Date.UTC(2026, 9, 25, 14, 30); // 7:30 AM PDT
const appt = NOW + DAY;

describe("paperworkStatus", () => {
  test("NEMT with a valid PCS", () => {
    expect(paperworkStatus({ rideType: "NEMT", pcsExpiresAt: appt + DAY }, appt)).toMatchObject({ valid: true, kind: "PCS", reason: "valid" });
  });
  test("NEMT with an expired PCS", () => {
    expect(paperworkStatus({ rideType: "NEMT", pcsExpiresAt: NOW - DAY }, appt)).toMatchObject({ valid: false, reason: "expired" });
  });
  test("PCS that expires before the appointment is invalid", () => {
    expect(paperworkStatus({ rideType: "NEMT", pcsExpiresAt: appt - MINUTE }, appt).valid).toBe(false);
  });
  test("NEMT with no PCS on file", () => {
    expect(paperworkStatus({ rideType: "NEMT" }, appt)).toMatchObject({ valid: false, reason: "missing", expiresAt: null });
  });
  test("NMT checks the NMT approval, not the PCS", () => {
    expect(paperworkStatus({ rideType: "NMT", nmtApprovalExpiresAt: appt + DAY }, appt)).toMatchObject({ valid: true, kind: "NMT_APPROVAL" });
    expect(paperworkStatus({ rideType: "NMT", pcsExpiresAt: appt + DAY }, appt)).toMatchObject({ valid: false, reason: "missing" });
  });
  test("daysUntilExpiry", () => {
    expect(daysUntilExpiry({ rideType: "NEMT", pcsExpiresAt: NOW + 10 * DAY }, NOW)).toBe(10);
    expect(daysUntilExpiry({ rideType: "NMT" }, NOW)).toBeNull();
  });
});

describe("evaluateDelay", () => {
  const start = NOW;
  const booked = { status: "booked", pickupWindowStart: start };
  const T = DRIVER_LATE_THRESHOLD_MINUTES;

  test("rule 1: no booked pickup window -> reject", () => {
    expect(evaluateDelay({ status: "requested" }, { reportedBy: "rider", delayMinutes: 30 }, NOW).action).toBe("reject");
    expect(evaluateDelay({ status: "completed", pickupWindowStart: start }, { reportedBy: "rider" }, NOW).reasonCode).toBe("no_booked_ride");
  });
  test("rule 2: replacement also delayed -> escalate", () => {
    const r = evaluateDelay({ status: "replacement_booked", pickupWindowStart: start }, { reportedBy: "broker", delayMinutes: 5 }, NOW);
    expect(r.action).toBe("escalate_to_human");
    expect(r.obligationApplies).toBe(false);
  });
  test("rule 3: projected pickup past the threshold -> urgent replacement (minutes)", () => {
    const r = evaluateDelay(booked, { reportedBy: "broker", delayMinutes: T + 5 }, NOW);
    expect(r).toMatchObject({ action: "request_urgent_replacement", obligationApplies: true, reasonCode: "projected_past_threshold", minutesPastWindowStart: T + 5 });
    expect(r.projectedPickupAt).toBe(start + (T + 5) * MINUTE);
  });
  test("rule 3: an ETA past the threshold wins over minutes", () => {
    const r = evaluateDelay(booked, { reportedBy: "rider", delayMinutes: 2, newEstimatedPickupAt: start + 40 * MINUTE }, NOW);
    expect(r.action).toBe("request_urgent_replacement");
    expect(r.minutesPastWindowStart).toBe(40);
  });
  test("exactly at the threshold is not past it", () => {
    expect(evaluateDelay(booked, { reportedBy: "broker", delayMinutes: T }, NOW).action).toBe("notify_rider_only");
  });
  test("rule 4: rider, no ETA, past the threshold -> urgent replacement", () => {
    const r = evaluateDelay(booked, { reportedBy: "rider" }, start + (T + 1) * MINUTE);
    expect(r).toMatchObject({ action: "request_urgent_replacement", reasonCode: "not_arrived_past_threshold", projectedPickupAt: null });
  });
  test("rule 5: rider, no ETA, within the threshold -> verify with broker", () => {
    const r = evaluateDelay(booked, { reportedBy: "rider" }, start + 5 * MINUTE);
    expect(r).toMatchObject({ action: "verify_with_broker", obligationApplies: false, reasonCode: "not_arrived_within_threshold" });
  });
  test("rules 4-5 use the clock for broker reports too", () => {
    expect(evaluateDelay(booked, { reportedBy: "broker", channel: "broker_call" }, start + (T + 1) * MINUTE)).toMatchObject({
      action: "request_urgent_replacement",
      reasonCode: "not_arrived_past_threshold",
    });
    expect(evaluateDelay(booked, { reportedBy: "broker", channel: "broker_call" }, start + 5 * MINUTE).action).toBe("verify_with_broker");
  });
  test("simulated dashboard reports are never judged by the clock", () => {
    const late = start + 60 * MINUTE;
    for (const reportedBy of ["rider", "broker"] as const) {
      expect(evaluateDelay(booked, { reportedBy, channel: "ops_dashboard" }, late)).toMatchObject({
        action: "verify_with_broker",
        obligationApplies: false,
        reasonCode: "no_eta_simulated",
      });
    }
    // With minutes, the dashboard follows the same minute-based rules as everyone else.
    expect(evaluateDelay(booked, { reportedBy: "broker", channel: "ops_dashboard", delayMinutes: 20 }, NOW).action).toBe("request_urgent_replacement");
  });
  test("rule 6: ETA within the threshold -> notify rider only", () => {
    const r = evaluateDelay(booked, { reportedBy: "broker", delayMinutes: 10 }, NOW);
    expect(r).toMatchObject({ action: "notify_rider_only", obligationApplies: false, reasonCode: "within_threshold" });
  });
  test("a delayed ride can cross the threshold on a later report", () => {
    expect(evaluateDelay({ status: "delayed", pickupWindowStart: start }, { reportedBy: "broker", delayMinutes: 25 }, NOW).action).toBe(
      "request_urgent_replacement",
    );
  });
  test("threshold is configurable", () => {
    expect(evaluateDelay(booked, { reportedBy: "broker", delayMinutes: 10 }, NOW, 5).action).toBe("request_urgent_replacement");
  });
});

describe("duplicate reports", () => {
  const prev = [{ channel: "rider_web", createdAt: NOW - MINUTE, delayMinutes: 10 }];
  test("the same report from the same channel within 2 minutes is a duplicate", () => {
    expect(isDuplicateReport(prev, { channel: "rider_web", delayMinutes: 10 }, NOW)).toBe(true);
  });
  test("different channel, older than 2 minutes, or new information is not", () => {
    expect(isDuplicateReport(prev, { channel: "broker_call", delayMinutes: 10 }, NOW)).toBe(false);
    expect(isDuplicateReport(prev, { channel: "rider_web", delayMinutes: 10 }, NOW + 2 * MINUTE)).toBe(false);
    expect(isDuplicateReport(prev, { channel: "rider_web", delayMinutes: 25 }, NOW)).toBe(false);
    expect(isDuplicateReport([{ channel: "broker_call", createdAt: NOW - MINUTE }], { channel: "broker_call", delayMinutes: 20 }, NOW)).toBe(false);
  });
});

describe("confirmation numbers", () => {
  test("spoken variants of the same number normalize to one form", () => {
    for (const heard of ["TR-4821", "TR482-1", "tr 4821", "T R 4 8 2 1", " TR4821 "]) expect(normalizeConfirmation(heard)).toBe("TR4821");
    expect(normalizeConfirmation(" - ")).toBe("");
  });
});

describe("allowlist", () => {
  test("only listed E.164 numbers pass", () => {
    const list = "+13105550101, +13105550199";
    expect(checkOutbound("+13105550101", list).ok).toBe(true);
    expect(checkOutbound("+13105550102", list).ok).toBe(false);
    expect(checkOutbound("3105550101", list).ok).toBe(false);
  });
  test("an empty or missing list allows nothing", () => {
    expect(checkOutbound("+13105550101", "").ok).toBe(false);
    expect(checkOutbound("+13105550101", undefined).ok).toBe(false);
    expect(parseAllowlist(" , ").size).toBe(0);
  });
});

describe("state machine", () => {
  test("allowed and refused transitions", () => {
    expect(canTransition("collecting", "requested")).toBe(true);
    expect(canTransition("booked", "late")).toBe(true);
    expect(canTransition("late", "replacement_booked")).toBe(false);
    expect(canTransition("collecting", "booked")).toBe(false);
    expect(canTransition("completed", "booked")).toBe(false);
  });
});

describe("time parsing", () => {
  test("no offset is read as Los Angeles local time", () => {
    expect(parseLocalIso("2026-10-26T09:00")).toBe(Date.UTC(2026, 9, 26, 16, 0)); // PDT, UTC-7
    expect(parseLocalIso("2026-11-02T09:00:00")).toBe(Date.UTC(2026, 10, 2, 17, 0)); // PST, UTC-8
  });
  test("explicit offsets are respected; junk is null", () => {
    expect(parseLocalIso("2026-10-26T09:00:00Z")).toBe(Date.UTC(2026, 9, 26, 9, 0));
    expect(parseLocalIso("tomorrow at 9")).toBeNull();
  });
});

describe("trip grouping", () => {
  test("booked within 2 hours is current, later is upcoming", () => {
    expect(tripGroup({ status: "booked", pickupWindowStart: NOW + 60 * MINUTE }, NOW)).toBe("current");
    expect(tripGroup({ status: "booked", pickupWindowStart: NOW + DAY }, NOW)).toBe("upcoming");
  });
  test("delays and recoveries are current; finished trips are past; collecting is hidden", () => {
    expect(tripGroup({ status: "late" }, NOW)).toBe("current");
    expect(tripGroup({ status: "ineligible" }, NOW)).toBe("past");
    expect(tripGroup({ status: "collecting" }, NOW)).toBe("hidden");
  });
});

describe("wording", () => {
  test("SMS is built only from recorded facts", () => {
    expect(renderSms("booked", "en", { destination: "Clinic" })).toEqual({ ok: false, missing: "booking" });
    const r = renderSms("booked", "es", {
      destination: "Centro",
      confirmationNumber: "TR-4821",
      pickupWindowStart: NOW,
      pickupWindowEnd: NOW + 15 * MINUTE,
      link: "https://x.test/trips?t=abc",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toContain("TR-4821");
      expect(r.body).toContain("Vea sus viajes: https://x.test/trips?t=abc");
      expect(r.body).not.toMatch(/[áéíóúñ]/); // SMS strips accents
      expect(r.body).not.toContain("..");
    }
  });
  test("status text fills the window and keeps accents for the website", () => {
    const text = statusText("booked", "es", { pickupWindowStart: NOW, pickupWindowEnd: NOW + 15 * MINUTE });
    expect(text).toContain("está reservado");
    expect(text).toMatch(/7:30/);
  });
});
