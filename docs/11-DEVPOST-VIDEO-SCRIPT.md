# 11 - Devpost Video Script

About 2:45. Follows `08-PRIZES-AND-SUBMISSION.md`: open with the delay being caught and the replacement, then the full flow, then problem, build, and honesty about what is mocked. Everything shown is the real system on real phones; the broker is a person reading a cue card, and all data is fake.

The problem section uses only what is true: the DHCS guidance read for this project, and a demo rider who is labeled fictional (`12-DEVPOST-SUBMISSION.md`, Inspiration).

---

## Before you record

- [ ] `demo:reset`, then `demo:seed` (dashboard **Seed** button or `npx convex run demo:seed '{"opsKey":"..."}'`)
- [ ] Ops dashboard open at `http://localhost:5173/ops`, full screen, zoom so text reads on video
- [ ] Rider phone (+1 408-690-5309) and broker phone (+1 217-200-5154) charged, on speaker, notifications off
- [ ] Phone screen mirrored to the laptop (QuickTime → New Movie Recording → choose the iPhone) so the trips page is visible
- [ ] Broker has the cue card at the bottom of this file
- [ ] Do one full dry run first, then `demo:reset` and `demo:seed` again
- [ ] Screen recorder captures the laptop screen **and** system/mic audio so both phone calls are heard
- [ ] Record the full flow in one take; keep the best of two. Cut the cold open from that take afterward

**Layout on screen:** ops dashboard on the left two-thirds, mirrored phone on the right third. Call audio plays over it.

---

## 0:00 – 0:20 · Cold open: the rescue (cut from the main take)

| Screen | Audio |
|---|---|
| Dashboard: the ride card turns orange, `late` → `recovery_calling`. Decision log line: *"evaluateDelay: request_urgent_replacement (projected_past_threshold, 20 min past window start, threshold 15)"* | Broker (on speaker): *"Confirmation TR-4821, the driver is running about 20 minutes late."* |
| Transcript pane shows the agent's reply | Agent: *"Under the member's Medi-Cal plan rules… the plan must authorize an urgent replacement ride."* |
| Status flips to `replacement_booked`; the phone's trips page updates on its own to *"A replacement ride is on the way"* | Rider's phone rings: *"Hi Maria… a replacement ride is on the way…"* |
| Title card: **Curb** · *Books Medi-Cal rides by phone, and rescues them when the driver is late.* | VO: *"That was a late driver caught, and a replacement booked, without anyone waiting on hold. Here's the whole thing, from the start."* |

---

## 0:20 – 1:05 · Booking a ride by phone

| Screen | Audio |
|---|---|
| Dial **+1 (662) 780-2148** on the rider phone. Dashboard: *"Latest calls"* pane, transcript filling live | Agent: *"Hello, this is Curb."* … *"Hi Maria…"* |
| Transcript continues. Point at the dashboard: no ride exists until she asks for one | You (as Maria): *"I need a ride to dialysis tomorrow at 9. I use a wheelchair."* |
| Decision log: *"paperworkStatus: PCS valid"* | Agent checks paperwork, then reads back day, time, destination, pickup address, wheelchair. *"Is that correct?"* You: *"Yes."* |
| Ride card appears: `requested` → `calling_broker` | Agent: *"I'm calling the ride company now. We'll call you back with the pickup time."* |
| Broker phone rings. Second transcript pane (broker lines in amber) | Agent (different voice): *"Hello, I'm an automated assistant calling on behalf of a Medi-Cal member to book a ride."* Broker: *"Ride booked. Confirmation TR-4821. Pickup tomorrow 7:30 to 7:45 AM."* |
| Status `booked`; confirmation `TR4821` on the card | Agent reads both back, thanks the broker |

VO over the broker call (keep it short): *"Maria never repeated her address or her plan. The agent already knew her from her number, and it checked her paperwork in code before booking anything."*

---

## 1:05 – 1:25 · The rider hears back, and sees her trips

| Screen | Audio |
|---|---|
| Rider phone rings: callback transcript | Agent: *"Hi Maria… your ride is booked. Pickup Sunday between 7:30 and 7:45 AM. Confirmation T R 4 8 2 1."* |
| Dashboard: **Rider trips page → Show QR**. Scan with the rider phone | VO: *"She can also see every trip on a simple page, large text, no password. The link is scoped to her alone and expires."* |
| Mirrored phone: trips page, *Upcoming*: the dialysis ride with pickup window and confirmation; *Past trips* below | — |

---

## 1:25 – 1:55 · The driver is late (the full rescue)

| Screen | Audio |
|---|---|
| Broker phone calls **+1 (662) 780-2148** | Agent: *"Hello, this is Curb."* Broker: *"This is Call the Car. Confirmation TR-4821, the driver is running about 20 minutes late."* |
| Dashboard: delay report *"Broker via broker call · 20 min late"*, then policy result *request_urgent_replacement*. Phone: trip moves to **Current**, turns orange | Agent cites the plan obligation and asks for an urgent replacement. Broker: *"Urgent ride arranged. Confirmation TR-4822. Pickup in 20 minutes."* |
| Status `replacement_booked`; replacement row on the card; phone updates on its own | Agent reads back, thanks the broker |
| Rider phone rings | Agent: *"…a replacement ride is on the way. Pickup … Confirmation T R 4 8 2 2."* |

VO: *"Either side can report a delay: the broker by calling in, or the rider by phone or with the 'My driver is late' button. Every report goes through the same rule, written in code, not decided by the model."*

**Stop the live flow here.** *"That's the whole flow."*

---

## 1:55 – 2:15 · Problem and who it's for

Slide or face-to-camera.

> *"Curb is for Medi-Cal members who depend on rides to recurring care, like dialysis, and the caregivers who book for them. I started from the state's own guidance to Medi-Cal plans on medical transportation. Every plan has its own broker and phone line, ride paperwork quietly expires after 12 months, and when a driver is late, the rider is the one who has to call and wait on hold, while missing something like dialysis. Maria is fictional; the steps she has to take are not."*

---

## 2:15 – 2:35 · How it's built (one architecture slide)

Show the diagram from `02-ARCHITECTURE.md`. Say what each sponsor tool does in the product:

- *"**Cartesia** runs every call: the phone number, speech recognition, turn-taking, and the Sonic voices. A distinct voice for the broker line, so you can tell who is who."*
- *"**Convex** is the whole backend: the webhooks the voice agents call, the ride state machine, scheduled retries when someone misses a call, and live queries, which is why the dashboard and Maria's phone updated without a refresh."*
- *"**Claude**: Haiku 5.5 handles the live conversations; Sonnet 5.5 is the brain that decides what to do next, and Haiku reads the broker call transcripts."*

---

## 2:35 – 2:50 · Guardrails and what's mocked

On screen, the decision log scrolled up, then a short text card:

> *"Eligibility and delay rules are code; the model explains them, it doesn't decide them. Nothing is booked without the rider's yes. The system can only dial an allowlist of demo numbers. Broker callers get the minimum: no addresses, no IDs. Every decision is logged, and a missed call gets one retry, then a person."*

> *"What's mocked: the broker is a person reading a cue card, and every record is fake. To run this for real you'd need a plan partnership, member consent, HIPAA agreements with every vendor, and real authentication for the trips page."*

End card: **Curb** · github.com/keisha9/curb · *Built solo at Cal Hacks 13.0 with Cartesia, Convex, and Claude.*

---

## Broker cue card (for the recording)

```
You work at a transportation broker ("Call the Car", demo). Speak normally.

CALL 1 - an automated assistant calls you (booking)
- Answer: "Thank you for calling, how can I help?"
- Listen. Then say: "Ride booked. Confirmation number T-R-4-8-2-1.
  Pickup window tomorrow 7:30 to 7:45 AM."
- When it reads it back, say "Yes." Then goodbye.

CALL 2 - you call the assistant at +1 (662) 780-2148 (delay)
- Say: "This is Call the Car. Confirmation T-R-4-8-2-1.
  The driver is running about 20 minutes late."
- When it asks for an urgent replacement, say:
  "Understood. Urgent ride arranged. Confirmation T-R-4-8-2-2.
  Pickup in 20 minutes."
- When it reads it back, say "Yes." Then goodbye.

Say the confirmation numbers slowly, letter by letter. Don't use real information.
```

## Claims to avoid in the video

- No real broker integration, no HIPAA compliance, no "the agent approves rides" (`01-PRD.md` section 9).
- No hold-time or no-show statistics unless the source is cited in the README (`08` section 3).
- Don't call the trips link "secure login"; it's a demo link scoped to one rider.
- Don't show texts arriving: SMS is off; the rider hears updates by callback.
