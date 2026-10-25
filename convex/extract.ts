"use node";
// Call outcome extraction (Haiku 5.5): broker transcript -> structured JSON (docs/05 section 8).
// Only stated facts; unstated fields are null; parse failures become "unclear".

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { extractJson, llmConfigured } from "./lib/llm";
import { parseLocalIso } from "./lib/time";
import { formatDateTime } from "./lib/wording";
import { EXTRACTOR_SCHEMA, EXTRACTOR_SYSTEM_PROMPT } from "./prompts/extractor";

type Outcome = NonNullable<Doc<"calls">["outcome"]>;
const RESULTS: Outcome["result"][] = ["booked", "replacement_booked", "delay_info", "refused", "unclear"];

const UNCLEAR: Outcome = {
  result: "unclear",
  confirmationNumber: null,
  pickupWindowStart: null,
  pickupWindowEnd: null,
  delayMinutes: null,
  newEstimatedPickupAt: null,
  refusalReason: null,
  driverStatus: null,
};

function normalize(raw: unknown): Outcome {
  if (!raw || typeof raw !== "object") return UNCLEAR;
  const o = raw as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : null);
  const t = (k: string) => {
    const val = s(k);
    return val ? parseLocalIso(val) : null;
  };
  const result = RESULTS.includes(o.result as Outcome["result"]) ? (o.result as Outcome["result"]) : "unclear";
  return {
    result,
    confirmationNumber: s("confirmationNumber")?.toUpperCase() ?? null,
    pickupWindowStart: t("pickupWindowStart"),
    pickupWindowEnd: t("pickupWindowEnd"),
    delayMinutes: typeof o.delayMinutes === "number" && Number.isFinite(o.delayMinutes) ? o.delayMinutes : null,
    newEstimatedPickupAt: t("newEstimatedPickupAt"),
    refusalReason: s("refusalReason"),
    driverStatus: s("driverStatus"),
  };
}

const SPEAKER: Record<string, string> = { agent: "Assistant", broker: "Broker", rider: "Rider" };

/** Extracts and stores the outcome of a broker call. Returns null when there is nothing to read. */
export async function extractCallOutcome(ctx: ActionCtx, callId: Id<"calls">): Promise<Outcome | null> {
  const call: Doc<"calls"> | null = await ctx.runQuery(internal.calls.getInternal, { callId });
  if (!call || call.outcome || !call.role.startsWith("broker_")) return call?.outcome ?? null;
  const lines: Doc<"transcriptLines">[] = await ctx.runQuery(internal.calls.transcriptInternal, { callId });
  if (lines.length === 0 || !llmConfigured()) return null;

  const transcript = lines.map((l) => `${SPEAKER[l.speaker] ?? l.speaker}: ${l.text}`).join("\n");
  let outcome = UNCLEAR;
  try {
    const raw = await extractJson(ctx, {
      rideId: call.rideId,
      purpose: "extract_call_outcome",
      system: EXTRACTOR_SYSTEM_PROMPT,
      user: `Call purpose: ${call.role === "broker_booking" ? "booking a new ride" : "a late driver"}.\nReference date and time: ${formatDateTime(call.createdAt, "en")} (America/Los_Angeles).\n\nTranscript:\n${transcript}`,
      schema: EXTRACTOR_SCHEMA as unknown as Record<string, unknown>,
    });
    outcome = normalize(raw);
  } catch (e) {
    await ctx.runMutation(internal.events.log, {
      rideId: call.rideId,
      kind: "error",
      summary: `Outcome extraction failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  await ctx.runMutation(internal.calls.setOutcome, { callId, outcome });
  return outcome;
}

export const callOutcome = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<Outcome | null> => await extractCallOutcome(ctx, callId),
});
