# 07 - Demo Script

Cartesia's format is a **2-minute, demo-first presentation**: one complete user flow first, then a brief problem and how it was built. This script fits that. The broker is a judge or teammate on a phone. Times below are demo timings, not build time.

## 1. Setup before judges arrive

- [ ] `demo:reset`, then `demo:seed`
- [ ] Ops dashboard open on a second screen, ride board visible
- [ ] Your phone ready to play "Maria" (number matches the seeded member), speaker on so the room hears the agent
- [ ] Broker phone number set in the dashboard, on the allowlist, and registered as the broker line (so the system recognizes it when it calls in); broker has the cue card
- [ ] Rider website ready to open from the text message on your phone
- [ ] Delay option chosen (see section 3) and the broker briefed on it
- [ ] A test call done beforehand to warm up everything
- [ ] Backup video loaded and ready to play
- [ ] Mute notifications; phone volume up

## 2. Timeline (about 2:00 demo plus 0:40 story)

| Time | What happens | What the audience sees |
|---|---|---|
| 0:00 | You, as Maria, call in Spanish: ride to dialysis tomorrow at 9, wheelchair | Ops dashboard: live Spanish transcript, ride `collecting` |
| 0:25 | Agent confirms details and eligibility; you say yes | Decision log: eligibility check passed; status `requested` |
| 0:35 | Agent: "Estoy llamando a la empresa de transporte." Broker phone rings | Status `calling_broker`; second transcript pane starts |
| 0:40 | Broker answers, agent states the request, broker gives a confirmation number and pickup window | Broker transcript, `booked` |
| 1:05 | Text arrives on your phone in Spanish; open its link | Trips website: the ride appears under Upcoming |
| 1:10 | **A delay is reported** (option A, B, or C below) | Delay report logged with who reported it; decision log shows the policy result; the ride moves to Current on the website |
| 1:15 | The agent gets an urgent replacement, either on the broker's call-in or on a call it places, citing the plan's obligation | Transcript pane, `replacement_booked` |
| 1:45 | Agent calls Maria back in Spanish with the new pickup window; SMS arrives | Callback transcript; website shows the replacement ride live |
| 2:00 | Stop. "That is the whole flow." | Ops dashboard and website side by side |
| 2:00-2:40 | Problem, community, how it was built, what is mocked, path to production | Architecture slide (one only) |

If the live broker is slow, narrate the dashboard instead of waiting. Never fill silence with claims you cannot show.

## 3. Delay options (pick one for the live demo; rehearse the others)

| Option | Who reports | How |
|---|---|---|
| A. Broker reports | Judge or teammate | Calls the system number and says: "Confirmation TR-4821, the driver is running about 20 minutes late." The assistant records it, asks for an urgent replacement on the same call, and the broker gives a new confirmation |
| B. Rider reports | You, as Maria | Tap **My driver is late** on the trips website, or call the number and say the driver is about 20 minutes late. The agent then calls the broker and requests the replacement |
| C. Ops backup | You | Click **Simulate delay** in the dashboard, as rider or as broker |

Option A shows the "both sides can report" story most clearly. Option B shows the rider website. Option C is the safety net if phones or the network misbehave.

## 4. Broker cue card (hand to the judge or teammate)

```
You work at a transportation broker ("Call the Car", demo).
An automated assistant will call you, and may ask you to call it.

CALL 1 (booking) - the assistant calls you
- Answer: "Thank you for calling, how can I help?"
- Listen to the request. Ask for the member's ID or name if you like.
- Say: "Ride booked. Confirmation number TR-4821. Pickup window tomorrow 7:30 to 7:45 AM."
- Say goodbye.

CALL 2, option A (you report a delay) - you call the assistant
- Say: "This is Call the Car. Confirmation TR-4821, the driver is running about 20 minutes late."
- If the assistant asks you to arrange an urgent replacement, say:
  "Understood. Urgent ride arranged. Confirmation TR-4822. Pickup in 20 minutes."
- Say goodbye.

CALL 2, option B (the rider reported it) - the assistant calls you
- Answer the same way. Listen. Say: "I'm sorry, let me check."
- When the assistant asks for an urgent replacement, say:
  "Understood. Urgent ride arranged. Confirmation TR-4822. Pickup in 20 minutes."
- Say goodbye.

You may sound confused or ask a question once. The assistant should handle it.
Do not use real information.
```

Optional hard-mode lines for rehearsal: ask the assistant to repeat the address; interrupt it once; give a delay shorter than the threshold and see that no replacement is requested.

## 5. Backup plan

| Failure | Response |
|---|---|
| Phone call fails to connect | Switch to the pre-recorded video immediately; say "here is the same flow recorded earlier" |
| Broker's call-in is not recognized | Use option B or C |
| Agent mis-hears the broker | Let it clarify once; if it flags `needs_human`, point to the dashboard and say that is the designed behavior |
| Wi-Fi or venue network issues | Phone on hotspot; backup video is local on the laptop |
| Judge does not follow the cue card | Prompt gently from the card; if still stuck, switch to the video |
| Trips website link fails | Open the site from the dashboard with a fresh token, or skip it and keep the call flow |

## 6. Pitch outline (post-demo, 40 seconds)

1. Who: Spanish- and English-speaking Medi-Cal dialysis patients and the schedulers who book for them (edit to match your real conversation).
2. The problem: separate brokers per plan, silent paperwork expiry, late rides with no recourse.
3. Why voice: the phone line is the one channel every broker already accepts.
4. How it works: Vapi plus Cartesia for the voice, Convex for state and the live dashboard and rider website, Claude for decisions, with policy checks in code. Rider or broker can report a delay.
5. What is mocked: broker is a person, data is fake. Path to production: plan partnership, member authorization, HIPAA, facility portals, real authentication for the website.
6. Where it could go wrong and how we guard against it: read-back confirmation, deterministic eligibility and delay rules, allowlist, full decision log.

## 7. Recording the backup video

- Record the full flow twice in one take each; keep the better one.
- Open with the moment judges care about (agent catching the delay and getting the replacement), then run the flow.
- Include the screen with the dashboard and the website, and audio of both phones.
