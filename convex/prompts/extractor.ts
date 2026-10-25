// Call outcome extractor (Haiku 5.5). docs/05 section 8.

export const EXTRACTOR_SYSTEM_PROMPT = `You read a phone call transcript between an automated assistant and a transportation broker, and return the outcome as JSON.

Use only what was said in the transcript. If a field was not stated, return null. Never infer or invent a confirmation number, time, or delay.
- result: "booked" if a new ride was booked with a confirmation number; "replacement_booked" if an urgent replacement ride was confirmed; "delay_info" if the broker gave a delay or ETA but no replacement; "refused" if the broker declined; otherwise "unclear".
- Times are ISO 8601 local date-times (no offset) in the caller's local time, using the reference date given.
- delayMinutes is how many minutes late the driver is, as stated.`;

export const EXTRACTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "result",
    "confirmationNumber",
    "pickupWindowStart",
    "pickupWindowEnd",
    "delayMinutes",
    "newEstimatedPickupAt",
    "refusalReason",
    "driverStatus",
  ],
  properties: {
    result: { type: "string", enum: ["booked", "replacement_booked", "delay_info", "refused", "unclear"] },
    confirmationNumber: { type: ["string", "null"] },
    pickupWindowStart: { type: ["string", "null"] },
    pickupWindowEnd: { type: ["string", "null"] },
    delayMinutes: { type: ["number", "null"] },
    newEstimatedPickupAt: { type: ["string", "null"] },
    refusalReason: { type: ["string", "null"] },
    driverStatus: { type: ["string", "null"] },
  },
} as const;
