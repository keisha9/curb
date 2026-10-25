// Ride state machine from docs/03-DATA-MODEL.md section 2.
// Only rides.transition / transitionRide may change a ride's status.

export const RIDE_STATUSES = [
  "collecting",
  "needs_info",
  "ineligible",
  "requested",
  "calling_broker",
  "booked",
  "delayed",
  "late",
  "recovery_calling",
  "replacement_booked",
  "needs_human",
  "completed",
  "cancelled",
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

const TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  collecting: ["needs_info", "ineligible", "requested", "cancelled", "needs_human"],
  needs_info: ["collecting", "ineligible", "requested", "cancelled", "needs_human"],
  ineligible: [],
  requested: ["calling_broker", "needs_human", "cancelled"],
  calling_broker: ["booked", "needs_human"],
  booked: ["delayed", "late", "completed", "cancelled", "needs_human"],
  delayed: ["late", "completed", "needs_human"],
  late: ["recovery_calling", "needs_human"],
  recovery_calling: ["replacement_booked", "needs_human"],
  replacement_booked: ["needs_human", "completed"],
  needs_human: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATUSES: readonly RideStatus[] = ["ineligible", "completed", "cancelled"];
