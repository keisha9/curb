// Trip grouping for the rider website (docs/04 section 3, "Trip grouping rules").

import type { RideStatus } from "./stateMachine";

export type TripGroup = "current" | "upcoming" | "past" | "hidden";

const CURRENT_STATUSES: readonly RideStatus[] = ["delayed", "late", "recovery_calling", "replacement_booked", "needs_human"];
const UPCOMING_STATUSES: readonly RideStatus[] = ["requested", "calling_broker", "booked"];
const PAST_STATUSES: readonly RideStatus[] = ["completed", "cancelled", "ineligible"];

export const CURRENT_LOOKAHEAD_MS = 2 * 60 * 60_000;

export function tripGroup(ride: { status: RideStatus; pickupWindowStart?: number }, now: number): TripGroup {
  if (CURRENT_STATUSES.includes(ride.status)) return "current";
  if (ride.status === "booked" && ride.pickupWindowStart !== undefined && ride.pickupWindowStart - now <= CURRENT_LOOKAHEAD_MS) {
    return "current";
  }
  if (UPCOMING_STATUSES.includes(ride.status)) return "upcoming";
  if (PAST_STATUSES.includes(ride.status)) return "past";
  // collecting / needs_info: the rider is still on the call; nothing to show yet.
  return "hidden";
}
