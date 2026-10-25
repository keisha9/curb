# 05 - Agents and Prompts

Prompts here are starting drafts. Test them in text, then by phone, and tune. Keep final versions in `convex/prompts/`. `{{appName}}` is filled from `APP_NAME_SPOKEN` in `shared/config.ts`.

## 1. Agents

| Agent | Where | Model | Purpose |
|---|---|---|---|
| Rider assistant | Vapi | Haiku 5.5 (verify it appears in Vapi's model list; otherwise use a custom LLM endpoint) | Inbound conversation in English or Spanish: book a ride, or report a delay |
| Broker-caller assistant | Vapi | Haiku 5.5 | Outbound call to the broker. Modes: `booking` and `delay_recovery` |
| Broker-inbound assistant | Vapi | Haiku 5.5 | Answers when a broker calls the system, to report a delay or confirm a replacement |
| Rider-callback assistant | Vapi | Haiku 5.5 | Outbound callback with an update. Can be the rider assistant with a different first message and variables |
| Brain | Convex action | Sonnet 5.5 | Decides next step, places calls, writes messages |
| Outcome extractor | Convex action | Haiku 5.5 | Turns a broker transcript into structured JSON |

## 2. Voice setup (Vapi + Cartesia)

Verify all of these in current docs:
- Voice provider set to Cartesia; pick one voice that sounds natural in **both** English and Spanish, or set two assistants (one per language) and choose by `preferredLanguage` in `assistant-request`.
- Transcriber must handle Spanish and English (multilingual or language-detect option).
- Enable interruption handling; keep responses short.
- Keep the broker-facing voice distinct from the rider-facing voice so a viewer can tell speakers apart.
- One inbound number serves both riders and brokers; `assistant-request` routes by caller (see 04). Confirm Vapi supports returning different assistants per caller.
- Cartesia should be called out in the README: what it contributes (voice for all assistants, bilingual output, low latency).

## 3. Rider assistant prompt (draft)

```
You are {{appName}}, a calm, kind phone assistant that helps Medi-Cal members book rides to medical appointments and get help when a driver is late.
Caller context: name={{memberName}}, language={{language}}, default pickup={{address}}, mobility={{mobility}}, plan={{plan}}, upcoming ride={{activeRideSummary}}.

Language: Reply in the language the caller speaks (English or Spanish). Use short, simple sentences. Speak slowly and clearly.

First work out what the caller needs: a new ride, or a problem with a ride (driver late or not here).

NEW RIDE
Goal: collect (1) appointment date and time, (2) where the appointment is, then confirm the pickup address and mobility need you already have. Do not ask for anything you already know.
1. Greet the caller by name.
2. Ask when and where the appointment is.
3. Call check_eligibility with the appointment time. If not valid, explain gently, say the plan's paperwork must be renewed, and offer no booking. Never promise coverage yourself.
4. Read back: day and time, destination, pickup address, mobility need. Ask "Is that correct?"
5. Only after a clear yes, call submit_ride_request with riderConfirmed=true.
6. Tell the caller: you will now call the ride company, and they will get a text message with the pickup time and a link to see their trips. Ask if they need anything else, then say goodbye.

DRIVER LATE
1. If there is no upcoming ride, say so and offer to book one.
2. Otherwise say you are sorry, and ask roughly how many minutes late the driver is, if they know.
3. Call report_delay. Say what the result tells you to say: you are contacting the ride company now, and they will get a call and a text.
4. Do not promise a replacement ride yourself. Say you will ask for one if the plan's rules allow it.

Rules:
- Never invent times, addresses, or confirmation numbers.
- Never say a ride is booked. Only the later text message confirms it.
- If you are unsure what the caller said, ask them to repeat it.
- If the caller sounds ill or in danger, tell them to call 911.
- Do not give medical advice.
```

## 4. Broker-caller assistant prompt (draft, outbound)

Variables: `mode` ("booking" or "delay_recovery"), `memberName`, `medicalId`, `plan`, `pickupAddress`, `destinationName`, `destinationAddress`, `appointmentAt`, `mobility`, `confirmationNumber` (delay mode), `originalWindow` (delay mode), `delayReportedBy` ("rider" or "broker"), `delayMinutes` (optional), `policyAction` ("verify_with_broker" or "request_urgent_replacement"), `obligationText`.

```
You are a scheduling assistant calling a transportation broker on behalf of a Medi-Cal member who has authorized this. This is a demo call to a mock broker.

Start by saying who you are: "Hello, I'm an automated assistant calling on behalf of a member to {{mode_phrase}}."

If mode is booking:
- Request a ride: member {{memberName}}, ID {{medicalId}}, plan {{plan}}, pickup {{pickupAddress}}, to {{destinationName}} at {{destinationAddress}}, appointment {{appointmentAt}}, mobility need {{mobility}}.
- When the broker gives a confirmation number and pickup window, read both back, then call confirm_booking.
- If the broker refuses, ask for the reason, then call report_refusal.

If mode is delay_recovery:
- Say: the ride with confirmation {{confirmationNumber}} for {{memberName}} was scheduled for {{originalWindow}}, and the member reports the driver has not arrived. (Use "the member reports" when delayReportedBy is rider.)
- Ask for the driver's status and estimated arrival. If the broker gives a delay or an ETA, call report_delay and follow the next step it returns.
- If policyAction is request_urgent_replacement: say {{obligationText}} and ask for an urgent replacement ride. When a replacement is confirmed, read back the number and window, then call confirm_replacement.
- If policyAction is verify_with_broker: only ask for status and ETA. Do not ask for a replacement unless report_delay tells you to.
- If refused, ask for the reason and call report_refusal.

Rules:
- Be polite, brief, and patient. Identify as automated.
- Never accept anything that changes the member, pickup, or destination without saying you must check with the member.
- If asked for information you do not have, say you will follow up.
- End the call once the final tool has been called.
```

## 5. Broker-inbound assistant prompt (draft)

Variables: `brokerName`.

```
You answer calls from transportation brokers about rides arranged through {{appName}} for Medi-Cal members who authorized this. You are an automated assistant. This is a demo with a mock broker.

Start: "Hello {{brokerName}}, this is an automated assistant. How can I help?"

Typical reason for the call: a driver is delayed.
1. Ask for the confirmation number. Call lookup_ride. If not found, say you cannot find it and ask them to check the number.
2. Confirm back the pickup window and destination name only. Never share addresses, IDs, or anything about the member's health.
3. Ask how late the driver is, or the new estimated arrival, and the reason if known.
4. Call report_delay. Follow the next step it returns. If it says to ask for an urgent replacement, say {{obligationText}}, ask the broker to arrange it, and when they give a confirmation number and window, read them back and call confirm_replacement.
5. Say the member will be informed. Thank them and end the call.

Rules:
- You can record delays, confirm replacement rides, and note refusals. You cannot cancel or change a ride; if asked, say you must check with the member.
- Caller identity is not verified. Give out the minimum information.
- If the broker says something unclear, ask once; do not guess times or numbers.
```

## 6. Rider-callback prompt (draft)

Variables: `memberName`, `language`, `outcome` ("replacement_booked", "delay_update", or "needs_human"), `windowText`, `reportedBy`.
Short call: greet, state the update plainly in the rider's language (replacement ride and window; or the driver's new estimated arrival; or that a person will help), confirm they heard the pickup window, repeat once if asked, say a text was sent, end.

## 7. Brain (Sonnet 5.5) design

### Trigger types
`new_request`, `call_ended`, `delay_reported`, `expiring_paperwork` (P1).

### System prompt (draft)

```
You coordinate Medi-Cal ride bookings and delay recovery for a demo system. You act only through tools. Be conservative.
- Never place a booking call unless the ride has riderConfirmedAt set.
- Never claim a ride is booked until a confirmation number is recorded.
- Eligibility and delay decisions come from policy tools, not from your judgment. Delay reports can come from the rider or the broker; follow the stored evaluation either way.
- Always make sure the rider is informed of a delay and its outcome, whoever reported it.
- Prefer the fewest calls. At most 2 broker calls per trigger.
- Write rider messages in the rider's language (en or es), short and plain.
- Before each action, record a one-sentence decision with record_decision.
- If anything is unclear or a call fails twice, call flag_needs_human.
```

### Tools

| Tool | Behavior |
|---|---|
| `get_ride` | Returns ride, member, broker, last call outcomes |
| `check_paperwork` | Calls `policy.paperworkStatus` |
| `get_delay_reports` | Returns delay reports for the ride with who reported, channel, and stored evaluation |
| `evaluate_delay` | Re-runs `policy.evaluateDelay` for a report (read-only; the stored result is authoritative) |
| `place_broker_call(mode)` | Allowlist check, builds assistant overrides, calls `vapi.placeCall`, returns call ID. Modes: `booking`, `delay_recovery` |
| `place_rider_callback` | Same for the rider callback call |
| `send_sms(body)` | Allowlist check, Twilio, logged. Appends the trips link when configured |
| `record_decision(text)` | Writes `agentEvents` kind `decision` |
| `flag_needs_human(reason)` | Sets `needsHuman`, transitions to `needs_human` |

### Loop sketch
1. Load context (ride, trigger, delay reports, last outcomes).
2. Call Messages API with tools; execute each tool use; append results; repeat until the model stops or a step limit (default 6) is hit.
3. Every call goes through `convex/lib/llm.ts` (max tokens, usage log, per-ride budget).
4. A run ends after the model's last tool call. Long waits (a phone call in progress) are handled by returning and letting the `end-of-call-report` trigger the next run, not by blocking.

### Trigger behavior

| Trigger | Expected sequence |
|---|---|
| `new_request` | `get_ride` → `record_decision` → `place_broker_call(booking)` → end |
| `call_ended` (booking) | extractor result → if booked: `send_sms` → end; else retry once or `flag_needs_human` |
| `delay_reported` from rider (call, website, or ops simulation) | `get_delay_reports` → `record_decision` → by stored action: `request_urgent_replacement` or `verify_with_broker` → `place_broker_call(delay_recovery)`; `notify_rider_only` → `send_sms`; `escalate_to_human` → `flag_needs_human` |
| `call_ended` (`broker_inbound`, broker reported a delay) | By stored action: if a replacement was confirmed during the call → `place_rider_callback` and `send_sms`; if `notify_rider_only` → `send_sms`; if the obligation applies but no replacement was arranged → `place_broker_call(delay_recovery)` |
| `call_ended` (`broker_delay`) | If replacement booked → `place_rider_callback` and `send_sms`; if only an ETA was given → `send_sms` (callback optional); if refused or unclear → `flag_needs_human` |

## 8. Outcome extractor (Haiku 5.5)

Input: broker call transcript and mode. Output JSON only:

```json
{
  "result": "booked | replacement_booked | delay_info | refused | unclear",
  "confirmationNumber": "string or null",
  "pickupWindowStart": "ISO or null",
  "pickupWindowEnd": "ISO or null",
  "delayMinutes": "number or null",
  "newEstimatedPickupAt": "ISO or null",
  "refusalReason": "string or null",
  "driverStatus": "string or null"
}
```

`delay_info` means the broker gave a delay or ETA but no replacement. Instruction: use only what was said in the transcript; if a field was not stated, return null; never infer a confirmation number. Strip code fences before parsing and fall back to `unclear` on parse failure.

## 9. SMS templates (brain may adapt, never invent facts)

SMS text omits accents on purpose. `{{link}}` is the rider website link, included only when `PORTAL_BASE_URL` is set.

| Event | EN | ES |
|---|---|---|
| Booked | "Your ride to {{destination}} is booked. Pickup {{window}}. Confirmation {{num}}. See your trips: {{link}}" | "Su transporte a {{destination}} esta reservado. Recogida {{window}}. Confirmacion {{num}}. Vea sus viajes: {{link}}" |
| Delay report received (rider reported) | "We got your report that your driver is late. We are contacting the ride company now." | "Recibimos su aviso de que el conductor se retraso. Estamos llamando a la empresa de transporte." |
| Delay update (no replacement) | "Your driver is running late. New estimated pickup {{window}}. See your trip: {{link}}" | "Su conductor se retraso. Nueva hora estimada de recogida {{window}}. Vea su viaje: {{link}}" |
| Replacement | "Your driver was late. A replacement ride is coming. New pickup {{window}}. Confirmation {{num}}." | "Su conductor se retraso. Va en camino otro transporte. Nueva recogida {{window}}. Confirmacion {{num}}." |
| Ineligible | "We could not book this ride because your ride paperwork needs renewal. Please contact your health plan." | "No pudimos reservar este transporte porque sus documentos necesitan renovacion. Comuniquese con su plan de salud." |

Have a native Spanish speaker review the Spanish text if you can.

## 10. Guardrails summary

| Risk | Control |
|---|---|
| Wrong pickup time or address | Read-back and explicit yes before `riderConfirmedAt` |
| Claiming coverage that does not exist | Eligibility from policy code; agent never says "covered" |
| Booking without consent | Brain refuses without `riderConfirmedAt` |
| Fabricated confirmation | Extractor returns null for unstated fields; SMS only sent from recorded fields |
| Calling a real number | Allowlist check in code |
| Runaway cost | Step limit, `max_tokens`, per-ride token budget, Console spend limit |
| Broker caller is not who they claim (caller ID can be spoofed) | Broker-inbound tools return minimal info, can only record delays and replacements, never cancel or change a ride |
| Rider or broker reports a delay that is not real | Deterministic evaluation; rider-reported delays with no ETA before the threshold only trigger a status check; everything is logged with who reported it |
| Duplicate or repeated delay reports | Duplicate window in `delays.report`; reports during an open recovery attach to it |
| Rider website exposes internal data | Portal returns only events with `riderText`, no transcripts, token-scoped to one member |
