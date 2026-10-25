# 01 - Product Requirements

## 1. Summary

Curb is a phone-based agent for Medi-Cal non-emergency medical transportation (NEMT and NMT). A rider (or caregiver) calls one number and asks for a ride in English or Spanish. The agent books it with the rider's plan broker and texts a confirmation with a link to a trips website. If the driver is late, either the rider or the broker can report the delay. Deterministic policy code decides whether the plan's urgent-replacement obligation applies; if it does, the agent obtains a replacement ride, and the rider is kept informed either way.

## 2. Named community and problem

**Community (draft, edit to match your real conversations):** Spanish- and English-speaking Medi-Cal dialysis patients in Los Angeles, and the clinic schedulers who book their rides.

**Problem:** Each health plan uses its own broker, phone line, and rules. Paperwork expires after 12 months and rides stop without warning. When a driver is late or no-shows, the rider waits on hold while missing a time-critical appointment.

**Evidence to collect (do not invent):** one real conversation with someone who has booked or needed these rides, or a cited source. Put it in the pitch. See `08-PRIZES-AND-SUBMISSION.md`.

## 3. Regulatory facts the product encodes

Sourced from the DHCS guidance discussed earlier (APL 22-008 and the DHCS transportation FAQ). **Verify each before the pitch.**

| Fact | Used for |
|---|---|
| NEMT (wheelchair van, gurney, ambulance) needs a physician-signed PCS form; one PCS can cover recurring appointments up to 12 months | Eligibility check, expiration alerts |
| NMT (car, rideshare, transit) needs no doctor form, but needs approval before the first ride and renewal every 12 months | Eligibility check, expiration alerts |
| Brokers schedule rides; the plan approves or denies paperwork | Agent calls the broker, never claims to approve anything |
| Rider should be ready within 15 minutes of the scheduled time | Rider-side rule. **Not verified as the trigger for driver lateness**; the demo's delay threshold is a separate assumption (see `03-DATA-MODEL.md`) |
| If the driver is late or no-shows, the plan must authorize an urgent ride | The delay recovery script |
| Hospital discharge to a facility must get a ride within 3 hours | Not built; pitch point only |

## 4. Users

| User | Needs |
|---|---|
| Rider (primary) | Book by voice in their language, not repeat their details, get a text confirmation, see their past, current, and upcoming trips on a simple website, report a late driver by phone or website, and get rescued when the ride fails |
| Caregiver or clinic scheduler | Same, on behalf of a rider they are authorized for |
| Broker staff | Be able to tell the system a driver is delayed and be asked clearly for what is needed |
| Judge or demo viewer (hackathon) | See the whole flow live in about 2 minutes and understand what the agent decided |

## 5. Goals and non-goals

**Goals (in priority order)**
1. One complete flow works live: inbound Spanish call, outbound broker call, booking, SMS, a delay reported by the rider or the broker, replacement, rider callback.
2. Ops dashboard shows live transcripts, ride status, who reported each delay, and an agent decision log.
3. Rider trips website shows upcoming, current, and past trips, updates live, and lets the rider report a late driver.
4. Voice quality and responsiveness are good enough that Cartesia is clearly core to the product.
5. Convex is visibly central: live queries for both web apps, HTTP actions, scheduled functions, crons.

**Non-goals**
- Real broker integration, real patient data, HIPAA compliance, eligibility verification against real systems.
- Booking or cancelling rides from the website (voice is the booking channel). Revisit in `10-OPEN-DECISIONS.md`.
- Production-grade authentication. The demo website uses a texted link.
- Native mobile app.

## 6. Functional requirements

IDs are used in the build plan and tests. **P0** must work for the demo. **P1** is stretch. **P2** is pitch only.

| ID | Priority | Requirement |
|---|---|---|
| F1 | P0 | Inbound call to one number is answered by the rider assistant in English or Spanish, matching the caller |
| F2 | P0 | Caller is identified by phone number against the members table; agent greets by name and does not ask for known details |
| F3 | P0 | Agent collects appointment time and destination, confirms pickup address and mobility need, and asks the rider to confirm before booking |
| F4 | P0 | Agent checks paperwork validity (PCS or NMT approval) through a deterministic policy function before booking; refuses and explains if invalid or expired |
| F5 | P0 | After the rider confirms, the system places an outbound call to the plan's broker number (mock), states the request, and records the confirmation number and pickup window |
| F6 | P0 | Rider receives an SMS confirmation in their language with the pickup window and a link to the trips website |
| F7 | P0 | Every delay report, from any source, goes through one policy evaluation. When the policy says the plan's urgent-ride obligation applies, the system obtains an urgent replacement ride from the broker and records the outcome |
| F8 | P0 | Rider receives an SMS and a callback (voice) in their language with the outcome of any delay: replacement ride details, or the driver's new estimated arrival |
| F9 | P0 | Ops dashboard shows ride status, per-call live transcripts, delay reports with who reported them, and the agent decision log, updating without refresh |
| F10 | P0 | All outbound calls and SMS are restricted to an allowlist of demo numbers. Inbound callers from unknown numbers are not served |
| F11 | P1 | Will-call return ride: agent calls the broker for the return trip when the appointment ends |
| F12 | P1 | Daily cron flags paperwork expiring within 30 days and sends an alert (SMS) |
| F13 | P1 | Ops dashboard shows per-ride LLM cost |
| F14 | P1 | Caregiver authorization flow (caller is not the member) |
| F15 | P2 | Third language, facility portal integration, discharge-ride handling |
| F16 | P0 | The rider can report a delay by voice (calling the number) or on the website ("My driver is late") |
| F17 | P0 | The broker can report a delay by calling the system number from a registered broker line, identifying the ride by confirmation number, or while on a call the agent placed. Broker callers receive minimal ride information |
| F18 | P0 | The ops dashboard can simulate a delay as either the rider or the broker |
| F19 | P0 | Rider trips website, opened from the texted link, shows Upcoming, Current, and Past trips for that rider only |
| F20 | P0 | The current trip updates live (status, pickup window or ETA, delay, replacement ride) without refresh |
| F21 | P0 | The website uses the rider's preferred language (English or Spanish), large text, and a mobile-first layout, and shows no transcripts or internal decision data |
| F22 | P1 | Language toggle on the website |
| F23 | P1 | Website banner when paperwork expires within 30 days |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Rider assistant first audio response under about 1.5 s after the caller stops speaking; Vapi tool handlers under 1 s |
| Reliability | Main flow works 3 times in a row in rehearsal; a recorded backup video exists |
| Cost | Total Anthropic spend for build, test, and demo stays within the $50 credit; hard monthly limit set in the Console |
| Safety | Allowlist enforced in code; no real data; no secrets in repo |
| Privacy | Website access is scoped to one member by token; broker callers get minimal information; no transcripts on the website |
| Transparency | Every agent decision, tool call, and delay report (with who reported it) is logged and visible to ops |
| Accessibility | Voice-first, Spanish supported, plain short sentences, repeat-back confirmation of time and address; website with large text and plain wording |

## 8. Success criteria for the demo

- A judge can play broker with only a one-page cue card and the flow still completes.
- A delay can be reported by the rider or by the broker, and either path ends with the rider informed.
- The audience can see, on the dashboard, the agent's policy result and its choice to request the replacement, and on the website, the trip moving from Upcoming to Current.
- The agent never states something false about coverage or booking in the demo.

## 9. Out-of-scope claims to avoid in the pitch

Do not claim real broker integration, HIPAA compliance, or that the agent approves rides. Do not present the texted-link website login as production authentication. Say: "mock broker, fake data, and here is the path to production."
