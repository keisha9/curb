# 04 - API Spec

> **Superseded in part (2026-10-24):** voice moved from Vapi to **Cartesia Managed Agents**, and SMS is off for now. Mapping: `/vapi/server` became `POST /voice/tools/<name>` (webhook tools, bearer secret) and `POST /voice/events` (call events, `X-Webhook-Secret`); `assistant-request` routing became the `identify_caller` tool, the first thing the single `inbound-assistant` calls; the rider and broker-inbound assistants are one agent on the one free number; `report_delay` is split into `report_delay_rider` and `report_delay_broker`; rider updates go by callback instead of SMS. See `10-OPEN-DECISIONS.md` and `convex/lib/voiceAgents.ts`.

Payload shapes for Vapi are **sketches from memory. Verify field names against current Vapi docs before coding** (server messages, tool call format, assistant-request, outbound call API).

## 1. HTTP routes (Convex HTTP actions, `convex/http.ts`)

All Vapi routes require header `x-vapi-secret: $VAPI_WEBHOOK_SECRET` (configure the same value in Vapi). Reject with 401 otherwise. Respond within 1 second.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Returns 200 |
| POST | `/vapi/server` | Single Vapi server URL: handles `assistant-request`, `tool-calls`, `status-update`, `transcript`, `end-of-call-report` by `message.type` |

The rider website and ops dashboard talk to Convex directly through its client (queries, mutations), not through HTTP routes.

### 1.1 `assistant-request` (inbound call)

In: caller phone number from the call object.
Behavior: create a `calls` row, then route by caller:

| Caller | Result |
|---|---|
| Matches `members.by_phone` | Rider assistant, with variables: member name, language, default address, mobility, plan, paperwork summary, `activeRideSummary` (the member's booked or delayed ride, if any, so the assistant can handle delay reports) |
| Matches `brokers.by_phone` | Broker-inbound assistant, with variable: broker name |
| Unknown | Assistant that says it cannot help and ends politely |

**A ride row is not created at call start.** It is created lazily by the first booking tool call (`check_eligibility` or `submit_ride_request`), so a delay-report call does not create a stray `collecting` ride.

### 1.2 `tool-calls`

In (sketch): `message.toolCallList[]` with `id`, `name`, `arguments`.
Out (sketch): `{ "results": [ { "toolCallId": "...", "result": "<string>" } ] }`

**Rider assistant tools**

| Tool | Arguments | Behavior |
|---|---|---|
| `check_eligibility` | `appointmentAt` (ISO string) | Creates a `collecting` ride for this call if none exists. Runs `policy.paperworkStatus`. Returns `{valid, reason}`. Logs `policy_check`. Moves ride to `ineligible` if invalid |
| `submit_ride_request` | `appointmentAt`, `appointmentType`, `destinationName`, `destinationAddress`, `pickupAddress`, `mobility`, `riderConfirmed` (must be true), `language` | Validates, sets `riderConfirmedAt`, transitions to `requested`, schedules `brain.run(new_request)`. Returns short confirmation string |
| `report_delay` | `minutesLate` (optional), `note` (optional) | Finds the member's active ride. If none, returns "no upcoming ride found". Otherwise calls `delays.report` (reportedBy `rider`, channel `rider_call`). Returns a short string the assistant can speak, based on the evaluated action |
| `get_ride_status` | none | Returns current ride status in plain words (P1) |

**Broker tools** (shared by the broker-caller and broker-inbound assistants unless noted)

| Tool | Arguments | Behavior |
|---|---|---|
| `lookup_ride` (inbound only) | `confirmationNumber` | Looks up by `rides.by_confirmation`. Returns only: member first name, appointment time, pickup window, destination name. No address, no ID. Returns "not found" otherwise |
| `confirm_booking` | `confirmationNumber`, `pickupWindowStart`, `pickupWindowEnd` | Writes to ride; transitions to `booked` |
| `report_delay` | `confirmationNumber` (inbound) or none (outbound, uses the call's ride), `delayMinutes` and/or `newEstimatedPickupAt`, `reason` | Calls `delays.report` (reportedBy `broker`, channel `broker_call`). **Returns the next step as text**, e.g. "Delay exceeds the plan threshold. Ask the broker to arrange an urgent replacement ride and give you a confirmation number and pickup window." or "Thank the broker. The rider will be informed." |
| `confirm_replacement` | `confirmationNumber`, `pickupWindowStart`, `pickupWindowEnd` | Writes replacement fields; transitions to `replacement_booked` |
| `report_refusal` | `reason` | Marks `needs_human`, logs reason |

Tool handlers never call the brain inline. They write, run pure policy, and schedule.

### 1.3 `status-update` and `transcript`

Update `calls.status`. For each final transcript message, insert a `transcriptLines` row (map speaker roles from call role). Skip partial transcripts unless you want a live typing effect (P1).

### 1.4 `end-of-call-report`

Store `summary`, `endedAt`, and recording URL if provided. Schedule `brain.run(call_ended, callId)` for `broker_booking`, `broker_delay`, `broker_inbound`, and `rider_callback` calls. For a `rider_inbound` call that produced a delay report, the brain run was already scheduled by `delays.report`.

## 2. Convex functions

### Queries (ops dashboard)
| Function | Returns |
|---|---|
| `rides.listLive` | Active rides with member name and status |
| `rides.get(rideId)` | Single ride with member and broker |
| `transcripts.byRide(rideId)` | Lines ordered by time, grouped by call |
| `events.byRide(rideId)` | Decision log |
| `delays.byRide(rideId)` | Delay reports with who reported, channel, and the policy evaluation |
| `members.expiringSoon(days)` | P1 |
| `usage.byRide(rideId)` | Token and cost estimate (P1) |

### Mutations
| Function | Visibility | Purpose |
|---|---|---|
| `rides.transition` | internal | Only way to change status; writes the `riderText` event |
| `rides.submitRequest` | internal | Backing for `submit_ride_request` |
| `rides.recordBooking`, `rides.recordReplacement` | internal | Backing for broker tools |
| `delays.report` | internal | **Single entry point for every delay report.** Inserts a `delayReports` row, ignores duplicates from the same channel within 2 minutes, sets `firstDelayReportedAt`, runs `policy.evaluateDelay` synchronously, stores the evaluation, transitions the ride (`delayed`, `late`, or `needs_human`), logs `delay_report` and `policy_check` events, and schedules `brain.run(delay_reported)`. Exception: for a live broker call (`channel: broker_call`), the brain run waits for the call's end-of-call-report. Returns the evaluation so the caller can respond immediately |
| `calls.upsert`, `transcripts.append`, `events.log` | internal | |
| `demo.simulateDelay(rideId, { as, delayMinutes })` | public | Ops dashboard button. `as` is `"rider"` or `"broker"`. Calls `delays.report` with channel `ops_dashboard` |
| `demo.seed`, `demo.reset` | public | Demo setup |
| `demo.setBrokerLine(phone)` | public | Change the human broker's number; must be allowlisted |

### Actions
| Function | Purpose |
|---|---|
| `brain.run({ rideId, trigger, callId?, delayReportId? })` | The Claude tool loop (see 05) |
| `vapi.placeCall({ rideId, role, assistantOverrides })` | POST to Vapi outbound call API after allowlist check |
| `twilio.sendSms({ rideId, to, body })` | After allowlist check. Booking and update texts include the rider website link when `PORTAL_BASE_URL` is set |
| `extract.callOutcome({ callId })` | Haiku structured extraction from the transcript |

### Crons (P1)
| Cron | Schedule | Purpose |
|---|---|---|
| `expirationScan` | Daily (demo: also runnable manually) | Find members with paperwork expiring in 30 days; schedule alerts |

## 3. Rider trips website (`/trips`)

Mobile-first, large text, opened from the link in the booking text. Default language is the member's `preferredLanguage`. A language toggle is P1.

### Access
- `portal.issueToken(memberId)` (internal) creates a random token, stores its hash with an expiry, and returns the raw token for the SMS link. Link format: `{PORTAL_BASE_URL}/trips?t=<token>`.
- The client keeps the token in sessionStorage and passes it to every call.
- Every `portal.*` function hashes the token, looks it up, rejects expired or revoked tokens, and scopes all reads to that one member.
- Default login is the texted link. Alternatives (phone code, Auth0, demo member picker) are open decisions in `10-OPEN-DECISIONS.md`.

### Functions
| Function | Type | Returns or does |
|---|---|---|
| `portal.me(token)` | query | Member first name, language, paperwork expiry notice (if within 30 days). Null if the token is invalid |
| `portal.trips(token)` | query | `{ current, upcoming, past }`, each trip with appointment, destination, status wording (EN and ES), pickup window or ETA, confirmation number |
| `portal.tripDetail(token, rideId)` | query | Trip fields plus a timeline of events that have `riderText`, and a short summary per call (no raw transcripts, no decision log). Fails if the ride is not this member's |
| `portal.reportDelay(token, rideId, { minutesLate?, note? })` | mutation | Calls `delays.report` (reportedBy `rider`, channel `rider_web`). Returns the status wording so the page can show it immediately |

All queries are live, so the current trip updates on screen as the agent works.

### Trip grouping rules (defaults, adjust if needed)
| Group | Rule |
|---|---|
| Current | Status is `delayed`, `late`, `recovery_calling`, `replacement_booked`, or `needs_human`; or status is `booked` and the pickup window starts within the next 2 hours or has already started and the trip is not completed |
| Upcoming | Status is `requested`, `calling_broker`, or `booked` and not Current |
| Past | Status is `completed`, `cancelled`, or `ineligible` |

### Views
| View | Content |
|---|---|
| Trips list | Current trip card on top (status, pickup window, "My driver is late" button), then Upcoming, then Past |
| Trip detail | Status wording, pickup window and ETA, confirmation number, replacement info if any, plain-language timeline |
| Paperwork notice | Banner if PCS or NMT approval expires within 30 days (P1) |

Not in scope by default: booking or cancelling from the website. Voice is the booking channel.

## 4. Outbound call request (sketch)

POST Vapi create-call with: `assistantId` (broker-caller or rider-callback assistant), `phoneNumberId` (`VAPI_PHONE_NUMBER_ID`), `customer.number` (allowlisted), and `assistantOverrides` carrying `variableValues` (ride details, member name, language, `appName`) and optionally a `firstMessage`. Store the returned call ID in `calls.vapiCallId` before the call connects so webhooks can match.

## 5. Error handling conventions

- Webhook handlers catch all errors, log to `agentEvents` (`kind: error`), and still return a valid response so a call is never dropped on a bug.
- Brain failures fall back to templated SMS or a `needs_human` flag.
- Idempotency: Vapi may retry; key on `toolCallId` and `vapiCallId`. Delay reports also have the duplicate window in `delays.report`.
- Portal errors for invalid or expired tokens show a plain message and never reveal whether a member exists.
