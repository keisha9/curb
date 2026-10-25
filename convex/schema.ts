// Convex schema from docs/03-DATA-MODEL.md. All data is fake.
// Timestamps are ms since epoch. Phones are E.164.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { RIDE_STATUSES } from "./lib/stateMachine";

export const vLang = v.union(v.literal("en"), v.literal("es"));
export const vMobility = v.union(v.literal("ambulatory"), v.literal("wheelchair"), v.literal("gurney"));
export const vRideStatus = v.union(...RIDE_STATUSES.map((s) => v.literal(s)));
export const vReportedBy = v.union(v.literal("rider"), v.literal("broker"));
export const vDelayChannel = v.union(
  v.literal("rider_call"),
  v.literal("rider_web"),
  v.literal("broker_call"),
  v.literal("ops_dashboard"),
);
export const vCallRole = v.union(
  v.literal("rider_inbound"),
  v.literal("broker_booking"),
  v.literal("broker_delay"),
  v.literal("broker_inbound"),
  v.literal("rider_callback"),
  v.literal("unknown_inbound"),
);
export const vCallStatus = v.union(
  v.literal("ringing"),
  v.literal("in_progress"),
  v.literal("ended"),
  v.literal("failed"),
);
export const vEventKind = v.union(
  v.literal("decision"),
  v.literal("tool_call"),
  v.literal("policy_check"),
  v.literal("status_change"),
  v.literal("delay_report"),
  v.literal("sms"),
  v.literal("call"),
  v.literal("error"),
);
export const vBilingual = v.object({ en: v.string(), es: v.string() });

export const vDelayEvaluation = v.object({
  action: v.union(
    v.literal("reject"),
    v.literal("escalate_to_human"),
    v.literal("request_urgent_replacement"),
    v.literal("verify_with_broker"),
    v.literal("notify_rider_only"),
  ),
  obligationApplies: v.boolean(),
  minutesPastWindowStart: v.union(v.number(), v.null()),
  projectedPickupAt: v.union(v.number(), v.null()),
  reasonCode: v.string(),
  thresholdMinutes: v.number(),
});

export const vCallOutcome = v.object({
  result: v.union(
    v.literal("booked"),
    v.literal("replacement_booked"),
    v.literal("delay_info"),
    v.literal("refused"),
    v.literal("unclear"),
  ),
  confirmationNumber: v.union(v.string(), v.null()),
  pickupWindowStart: v.union(v.number(), v.null()),
  pickupWindowEnd: v.union(v.number(), v.null()),
  delayMinutes: v.union(v.number(), v.null()),
  newEstimatedPickupAt: v.union(v.number(), v.null()),
  refusalReason: v.union(v.string(), v.null()),
  driverStatus: v.union(v.string(), v.null()),
});

export default defineSchema({
  members: defineTable({
    name: v.string(),
    phone: v.string(),
    preferredLanguage: vLang,
    medicalId: v.string(),
    plan: v.string(),
    address: v.string(),
    mobility: vMobility,
    rideType: v.union(v.literal("NEMT"), v.literal("NMT")),
    pcsExpiresAt: v.optional(v.number()),
    nmtApprovalExpiresAt: v.optional(v.number()),
    agentAuthorizedAt: v.optional(v.number()),
    caregiverName: v.optional(v.string()),
    caregiverPhone: v.optional(v.string()),
  }).index("by_phone", ["phone"]),

  brokers: defineTable({
    name: v.string(),
    plan: v.string(),
    phone: v.string(),
    advanceNoticeHours: v.number(),
  })
    .index("by_plan", ["plan"])
    .index("by_phone", ["phone"]),

  rides: defineTable({
    memberId: v.id("members"),
    status: vRideStatus,
    appointmentAt: v.optional(v.number()),
    appointmentType: v.optional(v.string()),
    destinationName: v.optional(v.string()),
    destinationAddress: v.optional(v.string()),
    pickupAddress: v.optional(v.string()),
    mobilitySnapshot: v.optional(vMobility),
    riderConfirmedAt: v.optional(v.number()),
    brokerId: v.optional(v.id("brokers")),
    brokerConfirmationNumber: v.optional(v.string()),
    pickupWindowStart: v.optional(v.number()),
    pickupWindowEnd: v.optional(v.number()),
    estimatedPickupAt: v.optional(v.number()),
    firstDelayReportedAt: v.optional(v.number()),
    replacementRequestedAt: v.optional(v.number()),
    replacementConfirmationNumber: v.optional(v.string()),
    replacementWindowStart: v.optional(v.number()),
    replacementWindowEnd: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    language: vLang,
    needsHuman: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_status", ["status"])
    .index("by_confirmation", ["brokerConfirmationNumber"])
    .index("by_replacement_confirmation", ["replacementConfirmationNumber"]),

  delayReports: defineTable({
    rideId: v.id("rides"),
    reportedBy: vReportedBy,
    channel: vDelayChannel,
    callId: v.optional(v.id("calls")),
    delayMinutes: v.optional(v.number()),
    newEstimatedPickupAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    evaluation: v.optional(vDelayEvaluation),
    // Set when the report was not evaluated on its own: a repeat from the same channel,
    // or a report that arrived while a recovery was already open.
    ignoredReason: v.optional(v.union(v.literal("duplicate"), v.literal("attached_to_open_recovery"))),
    handledAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_ride", ["rideId", "createdAt"]),

  calls: defineTable({
    rideId: v.optional(v.id("rides")),
    memberId: v.optional(v.id("members")),
    brokerId: v.optional(v.id("brokers")),
    role: vCallRole,
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    intent: v.optional(v.string()),
    externalCallId: v.string(),
    status: vCallStatus,
    language: v.optional(v.string()),
    // For outbound broker calls: the policy action the call was placed for.
    policyAction: v.optional(v.string()),
    delayReportId: v.optional(v.id("delayReports")),
    // Rider callbacks: the exact update spoken, so the same update is never called in twice.
    updateText: v.optional(v.string()),
    // Set when the call ends: false if it failed or the other side never spoke (missed, unanswered).
    answered: v.optional(v.boolean()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    outcome: v.optional(vCallOutcome),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_externalCallId", ["externalCallId"])
    .index("by_ride", ["rideId"]),

  transcriptLines: defineTable({
    callId: v.id("calls"),
    rideId: v.optional(v.id("rides")),
    speaker: v.union(v.literal("agent"), v.literal("rider"), v.literal("broker")),
    text: v.string(),
    ts: v.number(),
    isFinal: v.boolean(),
    // Provider turn id, so a turn delivered twice (per-turn event and end-of-call transcript) is stored once.
    turnId: v.optional(v.string()),
  })
    .index("by_call", ["callId", "ts"])
    .index("by_turn", ["callId", "turnId"]),

  agentEvents: defineTable({
    rideId: v.optional(v.id("rides")),
    kind: vEventKind,
    summary: v.string(),
    payload: v.optional(v.any()),
    riderText: v.optional(vBilingual),
    createdAt: v.number(),
  })
    .index("by_ride", ["rideId", "createdAt"])
    .index("by_created", ["createdAt"]),

  messages: defineTable({
    rideId: v.optional(v.id("rides")),
    memberId: v.id("members"),
    to: v.string(),
    body: v.string(),
    language: vLang,
    template: v.optional(v.string()),
    twilioSid: v.optional(v.string()),
    status: v.union(v.literal("stubbed"), v.literal("sent"), v.literal("failed"), v.literal("blocked")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_ride", ["rideId"]),

  portalTokens: defineTable({
    memberId: v.id("members"),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["tokenHash"]),

  llmUsage: defineTable({
    rideId: v.optional(v.id("rides")),
    purpose: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_ride", ["rideId"]),

  // Cartesia Managed Agents setup, written by cartesiaSetup:run (ids are not secrets).
  voiceConfig: defineTable({
    inboundAgentId: v.string(),
    brokerAgentId: v.string(),
    callbackAgentIdEn: v.string(),
    callbackAgentIdEs: v.string(),
    fromNumberId: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    eventWebhookId: v.optional(v.string()),
    toolIds: v.record(v.string(), v.string()),
    updatedAt: v.number(),
  }),

  // Raw provider webhook payloads (truncated), to check field names against real calls. Cleared on reset.
  webhookLog: defineTable({
    source: v.string(),
    type: v.string(),
    body: v.string(),
    createdAt: v.number(),
  }),

  demoState: defineTable({
    activeRideId: v.optional(v.id("rides")),
    delayMinutes: v.number(),
    brokerLine: v.string(),
  }),
});
