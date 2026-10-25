// Deterministic policy rules. Pure functions: no database, no network, no model.
// The model may call these as tools and explain the result; it never decides them.

export const MINUTE = 60_000;
export const DAY = 86_400_000;

/**
 * DEMO ASSUMPTION, not verified: a driver counts as late this many minutes past
 * the start of the pickup window. The 15-minute figure in the DHCS summary is
 * about rider readiness, not driver lateness. Verify before the pitch.
 */
export const DRIVER_LATE_THRESHOLD_MINUTES = 15;

/** Repeat reports from the same channel inside this window are ignored. */
export const DUPLICATE_REPORT_WINDOW_MS = 2 * MINUTE;

/** Paperwork expiring within this many days triggers an alert (P1). */
export const EXPIRY_ALERT_DAYS = 30;

export type RideType = "NEMT" | "NMT";

export type PaperworkMember = {
  rideType: RideType;
  pcsExpiresAt?: number;
  nmtApprovalExpiresAt?: number;
};

export type PaperworkStatus = {
  valid: boolean;
  kind: "PCS" | "NMT_APPROVAL";
  expiresAt: number | null;
  reason: "valid" | "missing" | "expired";
};

/** NEMT needs a PCS form; NMT needs a plan approval. Invalid if missing or expired by the appointment. */
export function paperworkStatus(member: PaperworkMember, appointmentAt: number): PaperworkStatus {
  const kind = member.rideType === "NEMT" ? "PCS" : "NMT_APPROVAL";
  const expiresAt = kind === "PCS" ? member.pcsExpiresAt : member.nmtApprovalExpiresAt;
  if (expiresAt === undefined) return { valid: false, kind, expiresAt: null, reason: "missing" };
  if (expiresAt <= appointmentAt) return { valid: false, kind, expiresAt, reason: "expired" };
  return { valid: true, kind, expiresAt, reason: "valid" };
}

/** Whole days until the member's relevant paperwork expires, or null if there is none. */
export function daysUntilExpiry(member: PaperworkMember, now: number): number | null {
  const expiresAt = member.rideType === "NEMT" ? member.pcsExpiresAt : member.nmtApprovalExpiresAt;
  if (expiresAt === undefined) return null;
  return Math.floor((expiresAt - now) / DAY);
}

export type DelayAction =
  | "reject"
  | "escalate_to_human"
  | "request_urgent_replacement"
  | "verify_with_broker"
  | "notify_rider_only";

export type DelayReasonCode =
  | "no_booked_ride"
  | "replacement_also_delayed"
  | "projected_past_threshold"
  | "not_arrived_past_threshold"
  | "not_arrived_within_threshold"
  | "within_threshold";

export type DelayEvaluation = {
  action: DelayAction;
  obligationApplies: boolean;
  minutesPastWindowStart: number | null;
  projectedPickupAt: number | null;
  reasonCode: DelayReasonCode;
  thresholdMinutes: number;
};

export type DelayRide = { status: string; pickupWindowStart?: number };
export type DelayReport = {
  reportedBy: "rider" | "broker";
  delayMinutes?: number;
  newEstimatedPickupAt?: number;
};

/** Statuses in which a ride has a live booking that can be late. */
const BOOKED_STATUSES = new Set(["booked", "delayed", "late", "recovery_calling", "replacement_booked"]);

/** See docs/03-DATA-MODEL.md section 3 for the rule table; rules are applied in order. */
export function evaluateDelay(
  ride: DelayRide,
  report: DelayReport,
  now: number,
  thresholdMinutes: number = DRIVER_LATE_THRESHOLD_MINUTES,
): DelayEvaluation {
  const result = (
    action: DelayAction,
    reasonCode: DelayReasonCode,
    minutesPastWindowStart: number | null,
    projectedPickupAt: number | null,
  ): DelayEvaluation => ({
    action,
    obligationApplies: action === "request_urgent_replacement",
    minutesPastWindowStart,
    projectedPickupAt,
    reasonCode,
    thresholdMinutes,
  });

  // 1. No booked pickup window
  const start = ride.pickupWindowStart;
  if (start === undefined || !BOOKED_STATUSES.has(ride.status)) {
    return result("reject", "no_booked_ride", null, null);
  }

  const projected =
    report.newEstimatedPickupAt ??
    (report.delayMinutes !== undefined ? start + report.delayMinutes * MINUTE : null);
  const minutesPast = Math.round(((projected ?? now) - start) / MINUTE);

  // 2. The replacement is also delayed
  if (ride.status === "replacement_booked") {
    return result("escalate_to_human", "replacement_also_delayed", minutesPast, projected);
  }
  // 3. Projected pickup is past the threshold
  if (projected !== null && minutesPast > thresholdMinutes) {
    return result("request_urgent_replacement", "projected_past_threshold", minutesPast, projected);
  }
  if (projected === null && report.reportedBy === "rider") {
    // 4. Driver has not arrived and we are past the threshold
    if (minutesPast > thresholdMinutes) {
      return result("request_urgent_replacement", "not_arrived_past_threshold", minutesPast, null);
    }
    // 5. Driver has not arrived but we are still within the threshold: only ask the broker
    return result("verify_with_broker", "not_arrived_within_threshold", minutesPast, null);
  }
  // 6. Anything else (an ETA within the threshold)
  return result("notify_rider_only", "within_threshold", minutesPast, projected);
}

/** True if an earlier report from the same channel makes this one a duplicate. */
export function isDuplicateReport(
  previous: { channel: string; createdAt: number }[],
  channel: string,
  now: number,
): boolean {
  return previous.some((r) => r.channel === channel && now - r.createdAt < DUPLICATE_REPORT_WINDOW_MS);
}

/**
 * Plan obligation text spoken to the broker. VERIFY wording against DHCS APL 22-008
 * and the DHCS transportation FAQ before the pitch.
 */
export function urgentRideObligation(language: "en" | "es" = "en"): string {
  return language === "es"
    ? "Según las reglas del plan Medi-Cal del miembro, cuando el conductor llega tarde o no llega, el plan debe autorizar un transporte urgente de reemplazo."
    : "Under the member's Medi-Cal plan rules, when a scheduled driver is late or does not arrive, the plan must authorize an urgent replacement ride.";
}
