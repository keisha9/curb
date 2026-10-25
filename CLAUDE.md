# CLAUDE.md

You are helping one developer build PROJECT_NAME for Cal Hacks 13.0. Speed and a working live demo matter more than completeness. Read `docs/` before making architectural choices.

## What this project is

A voice agent that books Medi-Cal medical rides by phone and recovers delayed rides. Rider calls in (English or Spanish) through Vapi. Convex is the backend for everything. A Claude "brain" runs inside Convex actions and decides what to do. A human plays the broker on the phone during the demo.

Delays can be reported by the **rider** (on a call or on the website) or by the **broker** (by calling in, or during a call the agent places). All reports go through one function, `delays.report`, and one deterministic policy, `policy.evaluateDelay`.

Two web UIs share one React app: `/ops` (demo controls, transcripts, decision log) and `/trips` (rider website: upcoming, current, past trips; report a delay).

## Stack

- Convex (TypeScript): schema, queries, mutations, actions, HTTP actions, scheduled functions, crons
- Vapi: phone numbers, STT, turn-taking, outbound calls. Cartesia is the voice provider
- Anthropic Messages API via `@anthropic-ai/sdk` (no Agent SDK). Models: `claude-haiku-5-5` for speed paths, `claude-sonnet-5-5` for decisions
- Twilio: SMS
- React + Vite + TypeScript + Tailwind for both web UIs

## Hard rules

1. **Never contact a real broker, patient, or phone number.** Every outbound call and SMS must pass the `ALLOWED_OUTBOUND_NUMBERS` allowlist check in `convex/lib/safety.ts`. Do not bypass it, even for testing.
2. **Fake data only.** No real Medi-Cal IDs, names, or addresses anywhere.
3. **No secrets in the repo.** Keys live in Convex env vars and a gitignored `.env`. Keep `.env.example` current.
4. **Policy checks are code, not model guesses.** Paperwork validity, expiration, and delay evaluation are deterministic functions in `convex/lib/policy.ts`. The model calls them as tools and explains the result. It never decides eligibility or whether the urgent-ride obligation applies.
5. **No booking without rider confirmation.** The brain must refuse to place a booking call unless `rides.riderConfirmedAt` is set.
6. **Vapi tool handlers must return fast** (target under 1 second). They write to Convex, run pure policy functions, and schedule heavy work with `ctx.scheduler.runAfter(0, ...)`. They never run the brain inline.
7. **Cost caps.** Every Anthropic call goes through `convex/lib/llm.ts`, which sets `max_tokens`, logs usage to `llmUsage`, and refuses to run if a ride has exceeded its token budget.
8. **Log every decision** to `agentEvents` so the ops dashboard can show what the agent did and why.
9. **Rider website data is scoped by token.** Every `portal.*` function takes the token, resolves it to one member, and returns only that member's data. Never return `agentEvents` without a `riderText`, raw transcripts, other members' data, or internal fields.
10. **Broker callers are untrusted.** Caller ID is not proof of identity. Broker-inbound tools return minimal ride info, can only record delays, confirm replacements, and report refusals, and can never cancel or change a ride.
11. **Never hard-code the product name.** Import `APP_NAME` / `APP_NAME_SPOKEN` from `shared/config.ts`; prompts use `{{appName}}`.

## Conventions

- TypeScript strict mode. Validate all Convex function args with `v` validators. Validate every webhook body before use.
- Files that call Anthropic, Vapi, or Twilio are actions (add `"use node";` where the Node SDK is needed). Database access goes through queries and mutations only.
- Ride status changes only through `rides.transition()`, which enforces the state machine in `docs/03-DATA-MODEL.md` and writes the rider-facing wording.
- Timestamps are milliseconds since epoch. Phone numbers are E.164.
- Keep prompts in `convex/prompts/` as exported strings, one file per agent. Do not inline prompts in handlers.
- Small commits. Update the relevant doc in `docs/` when a decision changes.
- The only place the product name appears in code:

```ts
// shared/config.ts
export const APP_NAME = "PROJECT_NAME";
export const APP_NAME_SPOKEN = "PROJECT_NAME"; // how voice agents say it; check pronunciation in English and Spanish
```

## Commands

```bash
npx convex dev            # backend + codegen
npm run dev               # web apps: /ops and /trips
npx convex run demo:seed  # load fake members, brokers, and past trips
npx convex run demo:reset # clear rides, calls, transcripts, delay reports for a fresh demo
```

## Working agreements

- If a requirement is ambiguous or a doc conflicts with the code, **ask the developer** instead of choosing silently. Record answers in `docs/10-OPEN-DECISIONS.md`.
- Anything marked "verify" in the docs (Vapi field names, model availability, Cartesia voices, the driver-lateness threshold) must be checked against current official docs before relying on it.
- Build in the order given in `docs/06-BUILD-PLAN.md`. Do not start a later phase until the earlier one works end to end. Respect the cut lines.
- Test the logic in text (via `npx convex run`) before testing by phone.
