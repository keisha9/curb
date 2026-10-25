# 09 - Risks and Responsible Use

## 1. Product and safety risks

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| Agent mishears time or address | Rider misses a medical appointment | Read-back and explicit yes before booking; confirmation SMS repeats the details | Rider must still check the text |
| Agent implies coverage that does not exist | Rider relies on a ride that will not come | Eligibility from policy code; agent is instructed never to say "covered" or "booked" on the call; only the SMS confirms after a recorded confirmation number | Policy facts must be verified against DHCS |
| Fabricated confirmation number or window | Rider waits for a ride that does not exist | Extractor returns null for unstated fields; SMS built only from recorded fields | Transcription errors on the broker call |
| Booking without consent | Privacy and trust harm | `riderConfirmedAt` gate enforced in brain code | None for the demo |
| Rider speaks a language the agent handles poorly | Misunderstanding | Demo scope limited to English and Spanish; read-back in the same language; Spanish SMS and website text reviewed by a speaker if possible | Dialects and accents |
| Medical emergency mentioned on the call | Delay in care | Prompt rule: direct to 911; agent does not give medical advice | Not a triage tool |
| Delay logic fires wrongly | Unnecessary broker calls | `evaluateDelay` is deterministic and tested; early rider complaints only trigger a status check | The 15-minute driver-lateness threshold is an unverified assumption |
| False or mistaken delay report (rider or broker) | Wasted calls or a replacement that was not needed | Every report is logged with who reported it and the channel; duplicates ignored | A real system would need driver tracking |
| Caller claims to be a broker (caller ID spoofing) | Someone triggers actions or learns ride details | Broker-inbound tools give minimal info, can only record delays and replacements, never cancel or change a ride; the ride is found only by confirmation number | Demo relies on caller number plus confirmation number; production needs stronger verification |
| Rider website link is forwarded or leaked | Someone else sees a member's trips | Random hashed token, expiry, one member scope, no transcripts or health detail on the site | Anyone with the link can view until it expires |
| Website shows internal or sensitive data | Privacy harm | Only events with `riderText`; no decision log, transcripts, or other members' data | Review the page content before the demo |
| Ops dashboard has no login | Anyone with the URL could trigger controls | Demo only; fake data; do not leave it deployed with real numbers | Documented limitation |
| Runaway cost | Credit exhausted before demo | Step limit, `max_tokens`, per-ride token budget, Console hard limit, test in text first | Keep a $5 reserve for demo day |

## 2. Technical risks

| Risk | Mitigation |
|---|---|
| Vapi does not list Haiku 5.5 | Use another listed Claude model for voice turns, or a custom LLM endpoint; record the choice in `10-OPEN-DECISIONS.md` |
| Vapi cannot route riders and brokers to different assistants on one number | Use a separate inbound number for brokers, or a single assistant that branches on a variable; record the choice |
| Spanish transcription or voice quality is weak | Test early (Phase 2); try a Spanish-specific voice and transcriber setting; keep prompts short |
| Webhook latency makes the agent pause | Tool handlers only write, run pure policy, and schedule; no LLM calls inline |
| Outbound or inbound call to the human broker is flaky | Rehearse with the actual number and venue network; backup video; ops simulation as fallback |
| Vapi webhook payload differs from the sketches | Log raw payloads in Phase 2 and adapt |
| Convex action time limits on long runs | The brain returns after placing a call; the next run is triggered by the end-of-call event |
| SMS links blocked or filtered by the carrier or trial account | Test on the real test numbers; keep the ops path to open the site |
| Demo controls left in a real deployment | Document as demo-only; note in the README |

## 3. Authorization and privacy

**Real-world model (state this in the pitch):**
- Brokers already verify member identity, and caregivers can book on a member's behalf. A production version would have the member authorize the agent in the same way (recorded consent, revocable), tied to the member's Medi-Cal identity.
- Minimum data: the agent needs only the member's ID, plan, pickup, destination, appointment time, and mobility need.
- The agent identifies itself as automated at the start of every broker call.
- The rider website would use real authentication (for example a one-time code or an identity provider) instead of a texted link, with audit logging.

**Demo model:**
- All members, IDs, addresses, and phone numbers are fake or belong to you.
- `agentAuthorizedAt` on each seeded member represents consent for the demo.
- The rider website uses a texted link as a bearer token. It is scoped to one member and expires.
- Transcripts and recordings contain only fake data. Delete them after the event.
- No PHI is stored. No HIPAA compliance is claimed. Production would require a business associate agreement with each vendor in the call path (voice, telephony, SMS, LLM, database).

## 4. Vendor and policy considerations

- Brokers may not want automated callers. The phone line is the one channel every broker accepts today; the long-term path is facility portals or a plan partnership.
- Call recording and AI-voice disclosure rules vary by state and use case. For anything beyond a demo, get legal review (this document is not legal advice).
- Anthropic usage: keep within the acceptable-use policy; do not present the system as making medical or coverage determinations.

## 5. What to say honestly in the pitch

- "The broker is a person on a phone, and every record is fake."
- "The agent never decides eligibility or whether a delay triggers the plan's obligation; code does."
- "Either the rider or the broker can report a delay, and the rider always hears what happened."
- "The website login is a texted link for the demo. Production would use real authentication."
- "Here is what would have to be true to run this for real: member consent, plan partnership, HIPAA agreements, and broker acceptance."
- "Here is where it can fail, and what it does when it does."
