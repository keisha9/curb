"use node";
// The brain (docs/05 section 7). Runs asynchronously, triggered by the scheduler from
// webhooks and mutations; it returns after placing a call and is re-triggered by the
// call's end-of-call report instead of blocking.

import { v } from "convex/values";
import type Anthropic from "@anthropic-ai/sdk";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { brainTurn, llmConfigured } from "./lib/llm";
import { BRAIN_TOOLS, executeTool, runScripted, summarizeContext, type BrainRun, type BrainTrigger } from "./lib/brainTools";
import { BRAIN_SYSTEM_PROMPT } from "./prompts/brain";
import { extractCallOutcome } from "./extract";

/** Model turns per brain run (docs/05: default step limit 6). */
const STEP_LIMIT = 6;

function brainMode(): "llm" | "scripted" {
  if (process.env.BRAIN_MODE === "scripted" || !llmConfigured()) return "scripted";
  return "llm";
}

/** Fill in facts the broker said but the voice tools did not record, from the transcript. */
async function applyTranscriptFacts(ctx: ActionCtx, rideId: Id<"rides">, callId: Id<"calls">) {
  const outcome = await extractCallOutcome(ctx, callId);
  if (!outcome) return;
  const start = outcome.pickupWindowStart;
  const end = outcome.pickupWindowEnd ?? undefined;
  if (outcome.result === "booked" && outcome.confirmationNumber && start !== null) {
    await ctx.runMutation(internal.brainData.applyExtractedBooking, { rideId, confirmationNumber: outcome.confirmationNumber, pickupWindowStart: start, pickupWindowEnd: end });
  } else if (outcome.result === "replacement_booked" && outcome.confirmationNumber && start !== null) {
    await ctx.runMutation(internal.brainData.applyExtractedReplacement, { rideId, confirmationNumber: outcome.confirmationNumber, pickupWindowStart: start, pickupWindowEnd: end });
  } else if (outcome.result === "delay_info" && (outcome.delayMinutes !== null || outcome.newEstimatedPickupAt !== null)) {
    await ctx.runMutation(internal.brainData.applyExtractedDelay, {
      rideId,
      callId,
      delayMinutes: outcome.delayMinutes ?? undefined,
      newEstimatedPickupAt: outcome.newEstimatedPickupAt ?? undefined,
    });
  }
}

async function runClaude(run: BrainRun): Promise<void> {
  const context = await run.ctx.runQuery(internal.brainData.getContext, { rideId: run.rideId });
  if (!context) return;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: JSON.stringify({
        trigger: run.trigger,
        callId: run.callId ?? null,
        delayReportId: run.delayReportId ?? null,
        context: summarizeContext(context),
      }),
    },
  ];

  for (let step = 0; step < STEP_LIMIT; step++) {
    const response = await brainTurn(run.ctx, { rideId: run.rideId, system: BRAIN_SYSTEM_PROMPT, tools: BRAIN_TOOLS, messages });
    if (response.stop_reason === "refusal") throw new Error("model declined the request");
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) return;
    if (response.stop_reason === "max_tokens") throw new Error("brain turn hit max_tokens mid tool call");

    // Run in order: tools have side effects, and the model's order is its plan.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const out = await executeTool(run, use.name, use.input);
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.result), is_error: !out.ok });
    }
    messages.push({ role: "user", content: results });
  }
  await run.ctx.runMutation(internal.events.log, {
    rideId: run.rideId,
    kind: "error",
    summary: `Brain stopped at the step limit (${STEP_LIMIT}) for ${run.trigger}`,
  });
}

export const run = internalAction({
  args: {
    rideId: v.id("rides"),
    trigger: v.union(v.literal("new_request"), v.literal("call_ended"), v.literal("delay_reported"), v.literal("ineligible")),
    callId: v.optional(v.id("calls")),
    delayReportId: v.optional(v.id("delayReports")),
  },
  handler: async (ctx, args) => {
    const run: BrainRun = {
      ctx,
      rideId: args.rideId,
      trigger: args.trigger as BrainTrigger,
      callId: args.callId,
      delayReportId: args.delayReportId,
      brokerCalls: 0,
      smsThisRun: new Set(),
      sideEffects: 0,
    };
    try {
      if (args.trigger === "call_ended" && args.callId) await applyTranscriptFacts(ctx, args.rideId, args.callId);

      // Ineligible needs no judgment: always the fixed text.
      const mode = args.trigger === "ineligible" ? "scripted" : brainMode();
      if (mode === "scripted") {
        await runScripted(run);
        return;
      }
      try {
        await runClaude(run);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const safeToRetry = run.sideEffects === 0;
        await ctx.runMutation(internal.events.log, {
          rideId: args.rideId,
          kind: "error",
          summary: `Claude brain failed (${message}); ${safeToRetry ? "falling back to the scripted brain" : "actions were already taken, not retrying"}`,
        });
        if (safeToRetry) await runScripted(run);
        else await ctx.runMutation(internal.brainData.flagNeedsHuman, { rideId: args.rideId, reason: `brain error: ${message}` });
      }
    } finally {
      if (args.delayReportId) await ctx.runMutation(internal.brainData.markReportHandled, { delayReportId: args.delayReportId });
    }
  },
});
