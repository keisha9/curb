# 10 - Open Decisions

Keep this file current. Claude Code should add to it instead of deciding silently.

## 1. Confirmed by you

| Decision | Answer |
|---|---|
| Voice and telephony | ~~Vapi with Cartesia voice~~ **Cartesia Managed Agents** for voice, numbers, and calls (2026-10-24) |
| Builder | Solo |
| Doc format | Markdown files in the repo for Claude Code |
| Mock broker | A judge or teammate plays the broker live |
| Convex | Not sure it is the right fit, but it must be used substantially |
| Languages | English and Spanish |
| Delay reporting | Both the rider and the broker can report a delay |
| Web surfaces | Ops dashboard for controls, plus a website where riders see past, current, and upcoming trips |
| Time allocations in docs | Removed |
| Product name | **Curb** (2026-10-25) |
| Section 2 defaults | All accepted as-is (2026-10-24) |
| Repo | `project-name`, public on GitHub |
| SMS | Off for now (2026-10-24): the trips website shows updates, and the rider gets a callback. Texts are still recorded and will send if Twilio is set |
| Seed phone numbers | Placeholders via Convex env vars (`DEMO_MARIA_PHONE`, `DEMO_JAMES_PHONE`, `DEMO_ROSA_PHONE`, `DEMO_BROKER_PHONE`); fictional 555-01xx numbers until set |

## 2. Defaults I set because the docs needed them (change any you disagree with)

| Default | Why | Alternative |
|---|---|---|
| Convex is the only backend (no separate server) | You want substantial Convex use; HTTP actions, scheduler, and live queries cover everything | Small separate webhook server if Vapi latency demands it |
| One React + Vite + TypeScript + Tailwind app with `/ops` and `/trips` | Shared components and one deploy | Two apps; Next.js |
| Haiku 5.5 for voice turns, Sonnet 5.5 for the brain | Carried over from our earlier cost discussion | Haiku everywhere to save credit |
| One Vapi server URL (`/vapi/server`) switching on message type | Simplest configuration | Separate routes |
| Seed members: Maria (es, wheelchair), James (en), Rosa (es, expired) plus past trips | Shows booking, English, the ineligible path, and a populated website | Fewer members |
| Brain triggered by webhooks and the scheduler, not run as a long loop | Keeps actions short and robust | Convex workflow component |
| SMS in the rider's language using templates the brain may adapt | Predictable text | Fully model-written SMS |
| Broker reports a delay by calling the system's number from a registered broker line, or during a call the agent places | Works with a human-played broker on one phone | Only during agent-placed calls; or a broker web form |
| Broker callers are untrusted: minimal info, can only record delays and replacements | Caller ID can be spoofed | Require a PIN or reference code |
| Delay threshold of 15 minutes past the pickup window start | Reused from the 15-minute figure in the DHCS summary, **which is about rider readiness, not driver lateness** | Verify the real trigger; make the threshold a config value |
| A rider report with no minutes before the threshold only triggers a status check with the broker | Avoids invoking the obligation on an early complaint | Always request a replacement |
| The agent requests the urgent replacement automatically when policy says the obligation applies | Matches the original demo idea | Ask the rider first |
| A delay after a replacement is booked escalates to a human | Prevents call loops | Allow another recovery attempt |
| Rider website login is a texted magic link (random token, hashed, expires after `PORTAL_TOKEN_TTL_DAYS`, default 14) | No passwords, easy for elderly riders, no extra service | Phone code, Auth0 for AI Agents, demo member picker |
| Rider website is view plus "report delay" only; no booking or cancelling | Voice is the booking channel | Add cancel or request-callback buttons |
| Website shows plain-language status and timeline only, never transcripts or the decision log | Privacy and clarity | Show call summaries or transcripts |
| Trip grouping: Current includes any delayed or recovering trip and any booked trip starting within 2 hours | Makes the trip visibly move during the demo | Different rule |
| Ops dashboard has no login (demo only) | Speed | Basic auth or Auth0 |
| Product name lives in `shared/config.ts` as `APP_NAME` and `APP_NAME_SPOKEN`, prompts use `{{appName}}` | One-place rename | |

## 3. Questions still open

1. What are the exact phone numbers for the demo rider and the broker, and who plays the broker on demo day?
2. Which one P1 feature do you want in Phase 5: will-call return, expiration cron, language toggle on the website, or cost display? (Expiration cron helps the Convex story most.)
3. How should riders log in to the website: texted link (default), phone code, Auth0, or a demo picker? Do you want Auth0 for AI Agents (extra build) to model rider authorization?
4. How should the broker report a delay: calling in from a registered number (default), only during calls the agent places, or both?
5. Should the agent ask the rider before requesting an urgent replacement, or do it automatically as now?
6. Should the website allow anything beyond viewing trips and reporting a delay (booking, cancelling, requesting a callback)?
7. Which delay option (A broker call-in, B rider, C ops button) is the primary live demo trigger?
8. Do you have a real conversation or source for the Anthropic named-community requirement? If not, who could you talk to before submission?
9. Should there be a backup automated broker (a second Vapi assistant) in case no human broker is available on demo day? You chose human-only, so none is planned.
10. Which screens will judges see: the ops dashboard, the rider website, or both?

## 4. Verify before relying (do these in Phase 0 and Phase 2)

- [ ] Vapi: Cartesia is available as a voice provider; the Spanish voice sounds natural
- [ ] Vapi: Haiku 5.5 appears in the model list (else custom LLM or another model)
- [ ] Vapi: multilingual or language-detect transcriber setting for Spanish and English
- [ ] Vapi: payload shapes for `assistant-request`, `tool-calls`, `end-of-call-report`, and the outbound call API
- [ ] Vapi: `assistant-request` can return a different assistant per caller on one inbound number (riders vs brokers)
- [ ] Vapi: free credits and per-minute cost; outbound call limits for trial accounts
- [ ] Twilio: can send SMS with links to your test numbers from a trial account (verified numbers only)
- [ ] Anthropic: current per-token prices and prompt caching behavior; spend limit set
- [ ] Convex: HTTP action and scheduler limits; whether any component (retrier, rate limiter, workflow) is worth the time
- [ ] DHCS facts in `01-PRD.md` (PCS 12-month validity, NMT renewal, 15-minute rule, urgent ride obligation, 3-hour discharge rule)
- [ ] The real trigger for treating a driver as late (the demo uses 15 minutes past the window start as an assumption)
- [ ] Broker names for each plan (e.g., "Call the Car" for L.A. Care, ModivCare for CalOptima) before saying them in the pitch
- [ ] Prize page changes for Cartesia, Convex, Anthropic, and Microsoft before submitting

## 5. Decision log (append as you go)

| Date and time | Decision | Reason |
|---|---|---|
| 2026-10-24 | Pinned Vite 6, Vitest 3, `@vitejs/plugin-react` 4 | Local Node is 20.12; Vite 8 needs 20.19+, Vitest 5 needs 22.12+. Upgrading Node to 22 LTS would allow the newer versions |
| 2026-10-24 | Phase 1 runs on an anonymous local Convex deployment (`CONVEX_AGENT_MODE=anonymous`) | No Convex login needed to build and test; link to a cloud project with `npx convex login` before Phase 2 (Vapi needs a public URL) |
| 2026-10-24 | Brain has two modes: Claude (Sonnet 5.5) when `ANTHROPIC_API_KEY` is set, or a deterministic scripted brain that follows the trigger table in `05` section 7. `BRAIN_MODE=scripted` forces it | Tests and text runs need no API key or credit; the scripted brain is also the fallback when a Claude run fails before taking any action (`02` section 9) |
| 2026-10-24 | The brain picks an SMS template; it cannot write SMS text. Text is rendered only from recorded fields, and a template missing a fact refuses to send | Stricter form of "brain may adapt templates, never invent facts" |
| 2026-10-24 | Sonnet brain calls use the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) and effort `medium` | A safety decline is retried on Anthropic's recommended fallback model instead of failing the turn |
| 2026-10-24 | `needs_human` is reachable from any non-terminal state, and `needs_human -> completed/cancelled` is allowed | The brain or a broker refusal can need a person at any point; ops needs a way to close the ride |
| 2026-10-24 | When a broker reports a past-threshold delay on a live call, the ride moves `late -> recovery_calling` during that call | The agent asks for the replacement on the same call (cue card option A) |
| 2026-10-24 | Ride detail fields (appointment, destination, pickup) are optional in the schema | A `collecting` ride exists before the rider has given them |
| 2026-10-24 | Schema additions: call role `unknown_inbound`; `calls.policyAction`, `calls.delayReportId`, `calls.error`; `delayReports.ignoredReason` (`duplicate` / `attached_to_open_recovery`); `messages.template`; `rides.by_replacement_confirmation` index; `agentEvents.by_created` index | Needed for routing, the decision log, idempotent SMS, and broker lookups by either confirmation number |
| 2026-10-24 | Rider website timeline shows a plain label per call ("We called the ride company"), not Vapi call summaries | Summaries are model-written and could contain internal detail |
| 2026-10-24 | Times without an offset from voice tools are read as America/Los_Angeles (`TIME_ZONE` in `shared/config.ts`) | Assistants speak in the rider's local time |
| 2026-10-24 | Seed brokers: "Call the Car (mock)" for L.A. Care, "Orange County Rides (mock)" for CalOptima | Avoid naming a real broker before verifying it (section 4) |

| 2026-10-24 | Clock-based delay rules (03 rules 4-5) apply to rider **and broker** reports, but not to `ops_dashboard` reports; a dashboard report with no time gets `verify_with_broker` | Decided by you. Simulated reports should not depend on the real clock |
| 2026-10-24 | A repeat report from the same channel within 2 minutes is a duplicate only if it carries the same minutes and ETA | Lets the broker answer "how late?" on the same call after a no-time report |
| 2026-10-24 | When a broker call-in ends with only `verify_with_broker` (late, no time), the brain calls the broker back for driver status | Same pattern as the call-in with no replacement arranged |
| 2026-10-24 | Switched voice to Cartesia Managed Agents; dropped Vapi | Decided by you. Vapi's free numbers are inbound-only; Cartesia provides a free US number that can call out, hosts the agents, and is the sponsor's recommended route |
| 2026-10-24 | One inbound agent (`inbound-assistant`) serves riders and brokers; it calls `identify_caller` first | The free plan has one number slot, and a number routes to one agent. The server already limits each caller's tools by call role |
| 2026-10-24 | Voice agents run `claude-haiku-5.5` through Cartesia (listed at ~576 ms average latency) | Matches the planned model; billed by Cartesia, not our Anthropic key |
| 2026-10-24 | Inbound agent: Spanish primary with English as an additional language, voice Ximena (es-MX). Callbacks: one agent per language (Skylar en, Ximena es). Broker caller: English, voice Daniel | Spanish is the demo's strongest moment; a distinct broker voice helps the audience tell speakers apart. English callers on the inbound line hear a Spanish-native voice |
| 2026-10-24 | Rider updates by callback: booking confirmed, new ETA (unless the rider reported it on the call), replacement, needs a person. The same update is never called in twice | SMS is off; the rider still has to hear the outcome (F8) |
| 2026-10-24 | Shared secret `VOICE_WEBHOOK_SECRET` for both tool webhooks (bearer) and call events (`X-Webhook-Secret`); raw event payloads are kept in `webhookLog` | Cartesia supports both; payload field names still need checking against real calls |

| 2026-10-24 | Rider gets the trips website link from a QR code on the ops dashboard | Decided by you. Built with the ops dashboard (Phase 4) |
| 2026-10-24 | Demo numbers: rider (Maria) +14086905309, broker +12172005154; these two are the whole allowlist. System line +16627802148 (Cartesia) | Decided by you |
| 2026-10-24 | Missed calls: a call is missed if it failed or the other side never spoke. One retry after 2 min (booking), 1 min (delay), 3 min (rider callback). Broker missed twice: needs a person and the rider is called. Rider missed twice: logged "not reached"; the update stays on the trips page | Handled in code, not by the model. Voicemail detection is on: no message for brokers, a generic call-back message (no ride details) for riders |
| 2026-10-24 | `OUTBOUND_MODE=stub` keeps calls in the database even when Cartesia is set up | Lets the Claude brain be tested in text without ringing real phones |
| 2026-10-24 | Demo members are upserted by their fake member ID, not phone | Changing a demo phone number updates the member instead of adding a second one |

| 2026-10-24 | **English only for now**: inbound agent English (voice Skylar), all demo members English. The Spanish paths stay in code and tests (`voiceAgents.ts` notes how to re-enable) | Decided by you after the first test call ("too Spanish") |
| 2026-10-24 | Tool webhooks pass only Cartesia system variables (`system__conversation_id`, `system__caller_id`) | First test call: Cartesia rejects a tool whose custom variable is unset (`app_call_id` on inbound calls), so `identify_caller` never reached us |
| 2026-10-24 | Inbound calls are matched by provider id, else by a live inbound call from the same number in the last 10 minutes | The call-started event and `identify_caller` may carry different ids |
| 2026-10-24 | Verified event payloads: `call_turn` has one turn in `body`, `call_completed` the transcript array in `body`, numeric turn ids, `system` metric turns, summary in `analysis.summary` | First test call; regression test replays these shapes |

| 2026-10-25 | Confirmation numbers are stored and compared as letters and digits only (`TR-4821`, `TR482-1`, `T R 4 8 2 1` are all `TR4821`) | Second test call: speech recognition heard TR-4821 as TR482-1, so the broker's call-in could not find the ride |
| 2026-10-25 | Agents say rides cannot be changed on a call and point to the health plan's ride line | Second test call: the callback wrongly said changes are made on the trips page |
| 2026-10-25 | The QR code encodes the dashboard's own address + `/trips?t=<token>`; for now the app runs on the laptop (`vite --host`) and the phone must be on the same Wi-Fi | No hosting yet. For demo day, deploy the web app or keep both devices on one network |

| 2026-10-25 | Rider trips site hosted free on GitHub Pages (https://keisha9.github.io/project-name/trips/), built by `.github/workflows/pages.yml` with `VITE_TRIPS_ONLY=1`; the ops dashboard stays local | Decided by you: anyone can scan the QR code |
| 2026-10-25 | Ops dashboard queries and demo controls require `OPS_KEY` (local `VITE_OPS_KEY`) | The repo and Convex URL are public; without it anyone could read real demo phone numbers and transcripts, reset data, or trigger real calls |

## 6. New questions from the build

None open.
