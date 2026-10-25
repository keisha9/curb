# 06 - Build Plan

Solo build. Work phase by phase. If a checkpoint is not reached and you are running short on time, apply the cut lines below.

## Phase 0: before coding

- [ ] Create Vapi account, claim a phone number, confirm Cartesia is selectable as voice, confirm Haiku 5.5 is selectable (or note the custom-LLM fallback)
- [ ] Confirm Vapi can route inbound calls to different assistants by caller (riders vs brokers)
- [ ] Twilio: from number, fake test recipients only
- [ ] Anthropic Console: create key, **set a hard monthly spend limit**, check current prices
- [ ] Convex project created; env vars set (list in README)
- [ ] Decide the demo broker phone (a teammate or judge's phone, or your own second phone for rehearsal), add it to `ALLOWED_OUTBOUND_NUMBERS`, and register it as the broker line so inbound calls from it are recognized
- [ ] Repo with this `docs/` folder and `CLAUDE.md`; `.env` gitignored; `shared/config.ts` with `APP_NAME` and `APP_NAME_SPOKEN`

## Phase 1: Convex core, no voice

Goal: book, report a delay from either side, and recover a ride entirely in text.
- [ ] `schema.ts` from `03-DATA-MODEL.md`
- [ ] `lib/policy.ts` with unit tests, including every `evaluateDelay` rule
- [ ] `lib/safety.ts` allowlist, `lib/llm.ts` wrapper
- [ ] `rides.transition` state machine with rider-facing wording
- [ ] `delays.report` as the single entry point for delay reports
- [ ] `demo:seed` (members, brokers, past trips), `demo:reset`
- [ ] `demo.simulateDelay` as rider and as broker
- [ ] Brain tool loop with **stubbed** `place_broker_call` and `send_sms` that write to the DB
- [ ] `portal.*` functions with token issuing and scoping, tested with `npx convex run`
- [ ] `npx convex run` scenarios: new request, booked, rider-reported delay, broker-reported delay, ineligible

**Checkpoint:** a full booking, then a delay reported by each side, succeeds with stubs, and the decision log reads well.

## Phase 2: voice in

Goal: a real inbound call becomes a booked ride via your broker phone.
- [ ] HTTP action `/vapi/server` with secret check and `message.type` switch
- [ ] `assistant-request` routing: member, broker, unknown
- [ ] Rider assistant in Vapi with Cartesia voice and the draft prompt
- [ ] Tools `check_eligibility` and `submit_ride_request`
- [ ] `vapi.placeCall` to the broker number; broker-caller assistant with booking mode
- [ ] Transcript webhook writes `transcriptLines`
- [ ] Extractor and `call_ended` handling
- [ ] Real Twilio SMS, including the trips link

**Checkpoint:** call from your phone, a second phone plays broker, the ride becomes `booked`, and the SMS arrives with a working link.

## Phase 3: delay reporting and recovery

- [ ] Rider reports by voice: `report_delay` tool on the rider assistant
- [ ] Broker reports by calling in: broker-inbound assistant with `lookup_ride`, `report_delay`, `confirm_replacement`
- [ ] Brain `delay_reported` and `call_ended` paths for both reporters
- [ ] Broker-caller assistant `delay_recovery` mode with obligation text
- [ ] Rider callback call (Spanish) and SMS
- [ ] `needs_human` paths

**Checkpoint:** full flow in Spanish end to end, triggered by the rider and again by the broker, each twice in a row.

## Phase 4: ops dashboard and rider trips website

Ops dashboard (`/ops`)
- [ ] Ride board (live query), status chips
- [ ] Per-call live transcript panes (agent, rider, broker distinct)
- [ ] Decision log timeline and delay reports with who reported
- [ ] Demo controls: seed, reset, simulate delay as rider or broker, broker number
- [ ] Clean layout readable from a few feet away

Rider trips website (`/trips`)
- [ ] Token-gated entry from the SMS link; clear message for invalid or expired links
- [ ] Trips list: Current, Upcoming, Past
- [ ] Current trip updates live, with the "My driver is late" button
- [ ] Trip detail with plain-language timeline
- [ ] Spanish and English wording from the rider's profile
- [ ] Large text, mobile-first

## Phase 5: P1 pick one

Choose **one**: will-call return ride (F11), expiration cron with alert (F12, also strengthens the Convex story), language toggle on the website (F22), or cost display (F13). Decide at the start of this phase, not before.

## Phase 6: submission

- [ ] README per `08-PRIZES-AND-SUBMISSION.md`
- [ ] **Record a backup video as soon as the main flow works**, full flow, then re-record later if possible
- [ ] Devpost text, prize opt-ins, screenshots (ops dashboard and rider website)
- [ ] Rehearse the 2-minute demo at least 3 times with the human broker cue card
- [ ] Replace `PROJECT_NAME` everywhere (see README, Naming)
- [ ] Final checks: no secrets in repo, allowlist in place, fake data only

## Cut lines (in order)

1. Drop P1 items.
2. Drop live partial transcripts (show final lines only).
3. Simplify the ops dashboard to ride board plus transcripts.
4. Simplify the rider website to the trips list plus the current trip (drop trip detail).
5. Drop the rider callback call and use SMS only for delay updates (say so in the pitch).
6. Drop Spanish from the callback only. Keep Spanish on the inbound call; it is the strongest demo moment.
7. Last resort: limit broker-reported delays to what the broker says during a call the agent places, and drop the broker-inbound assistant. This weakens the "both sides can report" story, so say so in the pitch.
Never cut: allowlist, riderConfirmedAt gate, backup video.

## Test checklist

| Test | Pass condition |
|---|---|
| Policy unit tests | Valid, expired, missing paperwork, NEMT vs NMT; every `evaluateDelay` rule including duplicates and second delay after replacement |
| Text brain run, booking | Ride reaches `booked` with stubs |
| Text brain run, rider-reported delay | Reaches `replacement_booked` with stubs when the obligation applies |
| Text brain run, broker-reported delay | Same, and a below-threshold delay only notifies the rider |
| Webhook secret | Request without header gets 401 |
| Allowlist | Dialing or texting a non-listed number is refused and logged |
| Confirmation gate | Brain refuses to place a booking call without `riderConfirmedAt` |
| Inbound call English | Booked, SMS received |
| Inbound call Spanish | Booked, Spanish SMS received with working link |
| Expired paperwork (Rosa) | Agent declines gently, no broker call |
| Rider reports delay by call | Delay report logged as rider, broker called, rider informed |
| Rider reports delay on website | Same, and the page shows the new status without refresh |
| Broker reports delay by calling in | Recognized by number, ride looked up by confirmation number, replacement requested when the policy says so, rider called back |
| Unknown caller | Politely declined, nothing created |
| Delay below threshold | Rider told the new ETA; no replacement requested |
| Duplicate reports | Second report within the duplicate window is ignored and logged |
| Website scoping | Token for one member cannot read another member's trips; expired token is rejected |
| Website content | No transcripts or decision log visible; only `riderText` events |
| Broker goes off-script | Agent handles one follow-up or flags `needs_human` |
| Interruption | Rider interrupts agent mid-sentence; agent recovers |
| Cost | `llmUsage` for a full run is within your per-ride budget |
