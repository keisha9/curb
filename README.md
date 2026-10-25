# PROJECT_NAME

> `PROJECT_NAME` is a placeholder. See [Naming](#naming) to change it in one pass.

A voice agent that books and rescues Medi-Cal medical rides by phone, plus a website where riders can see their trips.

Built solo for Cal Hacks 13.0. **All data is fake. The "broker" is a person on a phone. No real broker, patient, or phone number is ever contacted.**

## The problem

Medi-Cal covers rides to medical appointments (NEMT and NMT), but booking runs through phone lines and brokers that differ by health plan. Riders are often elderly, disabled, or Spanish-speaking. Paperwork (PCS forms, NMT approvals) silently expires after 12 months, and when a driver is late the rider has to call a broker and wait on hold.

## What it does

1. **Rider calls one number** (English or Spanish). The agent already knows who they are, and takes the appointment details.
2. **Agent calls the broker** for the rider's plan, books the ride, and texts the rider the confirmed pickup window with a link to their trips.
3. **Delay recovery.** The rider (by phone or on the website) or the broker (by calling in) can report a delay. A deterministic policy check decides whether the plan's urgent-replacement obligation applies. If it does, the agent gets an urgent replacement ride from the broker. Either way, the rider is told what is happening.
4. **Rider trips website.** Opened from the link in the text message. Shows upcoming, current, and past trips, updates live, and has a "my driver is late" button.
5. **Ops dashboard.** Demo controls, live call transcripts, ride status, and the agent's decision log.

## Stack

| Layer | Choice |
|---|---|
| Voice and telephony | Cartesia Managed Agents (Sonic voices, Claude Haiku 5.5 for turns, Cartesia phone number) |
| Backend, database, webhooks, schedulers, live data for both web apps | Convex |
| Reasoning | Anthropic Messages API (Haiku 5.5 fast paths, Sonnet 5.5 decisions) |
| SMS | Twilio, **off for now**: riders get a callback and see updates on the trips website; texts are recorded and will send once Twilio is configured |
| Web apps | One React + Vite + TypeScript app with two route trees: `/ops` (dashboard) and `/trips` (rider website). Default, see 10-OPEN-DECISIONS |
| Rider website login | Texted magic link. Default, see 10-OPEN-DECISIONS |

## Documents

| File | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code while building |
| [docs/01-PRD.md](docs/01-PRD.md) | Users, goals, scope, requirements |
| [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | Components, flows, delay-report channels, Convex usage, cost controls |
| [docs/03-DATA-MODEL.md](docs/03-DATA-MODEL.md) | Convex schema, ride state machine, delay policy |
| [docs/04-API-SPEC.md](docs/04-API-SPEC.md) | HTTP routes, Convex functions, Vapi tool contracts, rider website API |
| [docs/05-AGENTS-AND-PROMPTS.md](docs/05-AGENTS-AND-PROMPTS.md) | Vapi assistants, brain loop, prompts, guardrails |
| [docs/06-BUILD-PLAN.md](docs/06-BUILD-PLAN.md) | Phases, cut lines, test checklist |
| [docs/07-DEMO-SCRIPT.md](docs/07-DEMO-SCRIPT.md) | 2-minute demo, broker cue card, backup plan |
| [docs/08-PRIZES-AND-SUBMISSION.md](docs/08-PRIZES-AND-SUBMISSION.md) | Prize fit, judging criteria, README and Devpost checklist |
| [docs/09-RISKS-AND-RESPONSIBLE-USE.md](docs/09-RISKS-AND-RESPONSIBLE-USE.md) | Failure modes, privacy, authorization |
| [docs/10-OPEN-DECISIONS.md](docs/10-OPEN-DECISIONS.md) | Defaults chosen, items to verify, questions still open |

## Naming

The product name is a placeholder, written as `PROJECT_NAME` in every doc. To keep renaming cheap:

- **Docs:** the literal token `PROJECT_NAME` is the only form of the name.
- **Code:** the name lives in one file, `shared/config.ts`, as `APP_NAME` (UI, SMS) and `APP_NAME_SPOKEN` (how voice agents say it). Prompts use the `{{appName}}` variable, filled from `APP_NAME_SPOKEN`. Never hard-code the name anywhere else.
- **Infrastructure:** use generic names where you can (repo folder `project-name`, assistants `rider-assistant`, `broker-caller`, `broker-inbound`) so nothing outside the doc token and the config file needs to change.

To rename:

```bash
grep -rl PROJECT_NAME . | xargs sed -i 's/PROJECT_NAME/YourName/g'   # macOS: sed -i ''
```

Then confirm `shared/config.ts` updated, and listen to how Cartesia says the new name in English and Spanish. If it sounds wrong, change only `APP_NAME_SPOKEN`.

## Setup

Requires Node 20.12+ (Node 22 LTS recommended).

```bash
npm install
npx convex dev                       # starts Convex and writes .env.local (or CONVEX_AGENT_MODE=anonymous for a local deployment, no login)
npx convex env set ALLOWED_OUTBOUND_NUMBERS "+1...,+1..."   # the only numbers ever dialed or texted
npx convex run demo:reset && npx convex run demo:seed
npm test                             # policy unit tests + end-to-end scenarios (stubbed calls/SMS, scripted brain)
```

### Voice (Cartesia Managed Agents)

```bash
npx convex env set VOICE_WEBHOOK_SECRET "$(openssl rand -hex 32)"   # shared secret for tool and event webhooks
# set CARTESIA_API_KEY in the Convex dashboard
npx convex run cartesiaSetup:run '{"provisionNumber":true}'          # creates tools, event webhook, 4 agents; claims and assigns the number
```

`cartesiaSetup:run` is idempotent; run it again after changing prompts or tools (`convex/prompts/`, `convex/lib/voiceAgents.ts`). Agents: `inbound-assistant` (the one number, riders and brokers), `broker-caller`, `rider-callback-en`, `rider-callback-es`.

Without Cartesia set up (or the Twilio variables), calls and texts are **stubbed**: they are written to the database and shown in the decision log, but nothing is dialed or sent. Without `ANTHROPIC_API_KEY`, the brain runs in **scripted** mode (the trigger table from `docs/05` section 7, deterministic).

### Try the flow in text (Phase 1)

```bash
npx convex run sim:riderBooks '{"phone":"+13105550101","appointmentAt":"2026-10-26T09:00"}'
npx convex run rides:listLive                      # copy the ride id
npx convex run sim:brokerConfirmsBooking '{"rideId":"<id>","pickupWindowStart":"2026-10-26T07:30","pickupWindowEnd":"2026-10-26T07:45"}'
npx convex run sim:brokerCallsIn '{"brokerPhone":"+13105550199","confirmationNumber":"TR-4821","delayMinutes":25,"replacementConfirmationNumber":"TR-4822","replacementWindowStart":"2026-10-26T07:55","replacementWindowEnd":"2026-10-26T08:05"}'
npx convex run events:byRide '{"rideId":"<id>"}'  # the decision log
```

Other simulations: `sim:riderReportsDelay`, `sim:brokerAnswersDelayCall`, `demo:simulateDelay '{"as":"rider"}'`.

Convex environment variables (set with `npx convex env set`, never in the repo; full list with notes in `.env.example`):
`ANTHROPIC_API_KEY`, `BRAIN_MODE`, `LLM_RIDE_TOKEN_BUDGET`, `CARTESIA_API_KEY`, `VOICE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PORTAL_BASE_URL` (used in SMS links), `PORTAL_TOKEN_TTL_DAYS`, `ALLOWED_OUTBOUND_NUMBERS` (comma-separated E.164 list, the only numbers the system may ever dial or text), `DEMO_MARIA_PHONE`, `DEMO_JAMES_PHONE`, `DEMO_ROSA_PHONE`, `DEMO_BROKER_PHONE`.

## Known limitations

Fill in during build. Starting list: demo uses fake members and a human-played broker; real brokers verify identity and may not accept AI callers; the rider website uses a texted link, not production authentication; the ops dashboard has no login; no HIPAA compliance in the demo.
