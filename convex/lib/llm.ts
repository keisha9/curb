// The only code that calls Anthropic (CLAUDE.md hard rule 7). Every call:
//  - refuses to run if the ride is over its token budget,
//  - sets max_tokens,
//  - caches the stable system prompt,
//  - logs usage to llmUsage.
// Import only from "use node" action files.

import Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export const BRAIN_MODEL = "claude-sonnet-5-5";
export const FAST_MODEL = "claude-haiku-5-5";

export class LlmBudgetExceeded extends Error {}
export class LlmUnavailable extends Error {}

export function llmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function rideBudget(): number {
  const n = Number(process.env.LLM_RIDE_TOKEN_BUDGET ?? "200000");
  return Number.isFinite(n) && n > 0 ? n : 200_000;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!llmConfigured()) throw new LlmUnavailable("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

async function checkBudget(ctx: ActionCtx, rideId: Id<"rides"> | undefined) {
  if (!rideId) return;
  const spent = await ctx.runQuery(internal.usage.rideTotal, { rideId });
  if (spent >= rideBudget()) {
    throw new LlmBudgetExceeded(`ride ${rideId} used ${spent} tokens (budget ${rideBudget()})`);
  }
}

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

async function logUsage(ctx: ActionCtx, rideId: Id<"rides"> | undefined, purpose: string, model: string, usage: Usage) {
  await ctx.runMutation(internal.usage.record, {
    rideId,
    purpose,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  });
}

/**
 * One brain turn on Sonnet 5.5 with tools. Server-side refusal fallback is on
 * (`fallbacks: "default"`), so a safety decline is retried on Anthropic's
 * recommended fallback model instead of failing the turn.
 */
export async function brainTurn(
  ctx: ActionCtx,
  opts: {
    rideId: Id<"rides">;
    system: string;
    tools: Anthropic.Beta.BetaTool[];
    messages: Anthropic.Beta.BetaMessageParam[];
    maxTokens?: number;
  },
): Promise<Anthropic.Beta.BetaMessage> {
  await checkBudget(ctx, opts.rideId);
  const response = await getClient().beta.messages.create({
    model: BRAIN_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    tools: opts.tools,
    messages: opts.messages,
  });
  await logUsage(ctx, opts.rideId, "brain", response.model, response.usage);
  return response;
}

/** Structured JSON from Haiku 5.5 (used by the call-outcome extractor). Returns null on refusal or parse failure. */
export async function extractJson(
  ctx: ActionCtx,
  opts: {
    rideId?: Id<"rides">;
    purpose: string;
    system: string;
    user: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  },
): Promise<unknown | null> {
  await checkBudget(ctx, opts.rideId);
  const response = await getClient().messages.create({
    model: FAST_MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });
  await logUsage(ctx, opts.rideId, opts.purpose, response.model, response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    // Structured outputs should return bare JSON; strip fences anyway, per docs/05 section 8.
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
