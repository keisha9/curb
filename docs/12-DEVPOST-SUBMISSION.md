# 12 - Devpost Submission

Paste-ready text for each Devpost field. Items marked **[YOU]** need facts only you have; do not fill them with guesses (`08-PRIZES-AND-SUBMISSION.md` section 6).

## Project name

Curb

## Elevator pitch

Curb books Medi-Cal rides to medical appointments by phone, and rescues the ride when the driver is late. One call, no hold music, policy rules in code.

## About the project (Markdown)

```markdown
## Inspiration

Curb is for Medi-Cal members who depend on rides to recurring care, like dialysis, and for the caregivers and clinic schedulers who book those rides for them. I started by reading how the system actually works: the California Department of Health Care Services' guidance to Medi-Cal health plans on non-emergency transportation (APL 22-008) and its transportation FAQ. What stood out was how much of the work lands on the rider. My demo rider, Maria, is fictional, but the steps she has to take are the ones that guidance describes.

Medi-Cal covers rides to medical appointments, but booking one means calling the broker for your health plan, and every plan has its own. Ride paperwork quietly expires after 12 months. And when a driver is late, the rider is the one who has to call and wait on hold, while missing something like dialysis. The phone is the one channel every rider and every broker already uses, so I built an agent that works the phone for them.

## What it does

- **Book by phone.** A rider calls one number. Curb recognizes them by caller ID, so they never repeat their address, plan, or mobility needs. It checks their ride paperwork, reads the details back, and only books after a clear yes.
- **Call the broker.** Curb calls the plan's transportation broker, requests the ride, and records the confirmation number and pickup window. Then it calls the rider back with the pickup time.
- **Rescue late rides.** Either side can report a delay: the broker by calling in, or the rider by phone or with a "My driver is late" button. A deterministic rule decides whether the plan's urgent-replacement obligation applies. If it does, Curb asks the broker for an urgent replacement, on the same call when the broker is the one calling, and calls the rider with the new pickup.
- **Trips page.** The rider scans a QR code to open a simple, large-text page with their current, upcoming, and past trips. It updates live as the agent works.
- **Ops dashboard.** Live call transcripts, the ride board, every delay report with the policy result, and a decision log of everything the agent did and why.

## How I built it

- **Cartesia Managed Agents** runs every call: the phone number, speech recognition, turn-taking, and Sonic voices. Four agents: one inbound line that identifies the caller first and serves both riders and brokers, a broker-caller with its own distinct voice, and rider callbacks. Their tools are webhooks into my backend.
- **Convex** is the entire backend. HTTP actions receive the agents' tool calls and call events; mutations enforce the ride state machine; the scheduler runs the agent's "brain" asynchronously and retries missed calls; live queries power the dashboard and the rider's page with no polling.
- **Claude** has three jobs. Claude Haiku 5.5 runs the live conversations (through Cartesia). Claude Sonnet 5.5 is the brain that decides the next step after each event: place a call, call the rider back, or escalate to a person. Claude Haiku 5.5 also reads broker call transcripts into structured outcomes.
- **React + Vite + Tailwind** for the dashboard and trips page; the trips page is hosted on GitHub Pages.

**Guardrails are code, not prompts.** Paperwork validity and the late-driver rule are pure functions with unit tests; the model explains their result but never decides it. Nothing is booked without the rider's confirmation. The system can only dial an allowlist of demo numbers. Broker callers get minimal information and can't cancel or change rides. Every Claude call has a token cap and a per-ride budget, and every decision is logged.

## Challenges I ran into

- **My first telephony plan didn't work.** Free numbers on my first voice platform could only receive calls, and Curb has to call brokers and riders. I moved everything to Cartesia Managed Agents, which gives a free US number that can call out.
- **The first live call failed.** Every tool shared a hidden variable that only outbound calls set, so on inbound calls the platform rejected the agent's first tool before it reached me, and the transcript events used a shape I had guessed wrong. I now log raw provider payloads and have a regression test that replays the real ones.
- **Speech recognition and confirmation numbers.** The broker said "TR-4821" and it was heard as "TR482-1", so the broker's later call-in couldn't find the ride. Confirmation numbers are now compared as letters and digits only.
- **An agent said something false.** Asked to move a pickup, the callback agent told the rider to use the trips page, which can't change rides. Both agents now say plainly what they can't do and where to go instead.
- **One number for two kinds of callers.** The free plan has one number and a number routes to one agent, so a single agent identifies the caller first, and the server enforces which tools each kind of caller may use.
- **Missed calls.** A broker or rider may not pick up. Curb retries once after a short wait, then hands off to a person (broker) or notes that the rider wasn't reached (their page still shows the update).

## Accomplishments that I'm proud of

- A full booking works live on real phones: rider call, automated broker call, confirmation, and a callback to the rider.
- The rules that matter most for safety are deterministic and tested, separate from the model.
- Both web pages update live as the calls happen.

## What I learned

- Put the decisions that must be right (eligibility, whether a delay triggers an obligation) in code, and let the model handle conversation and explanation.
- Log raw webhook payloads from day one; real payloads differed from my guesses.
- Every agent needs a sentence about what it *cannot* do, or it will improvise one.

## What's real and what's simulated

The broker is a person reading a cue card, and every member, ID, and address is fake. The system can only call two allowlisted demo numbers. Text messages are turned off; riders hear updates by callback. The trips page link is a demo link scoped to one rider, not production authentication. Spanish support exists in the code and tests, but the live demo is English only.

## What's next for Curb

- A partnership with a health plan, recorded member consent, and HIPAA agreements with every vendor in the call path.
- Real authentication for the trips page, and SMS updates.
- A daily check that warns riders 30 days before their ride paperwork expires.
- Spanish and other languages on the live line; return rides when an appointment ends; hospital discharge rides.
```

## Built with

typescript, react, vite, tailwindcss, convex, cartesia, cartesia-sonic, cartesia-managed-agents, anthropic, claude, claude-sonnet, claude-haiku, node.js, github-pages, github-actions, vitest, qrcode

## "Try it out" links

- Code: https://github.com/keisha9/project-name

Not listed on purpose: the trips page needs a per-rider link (without one it only shows "link not valid"), and the phone number would let anyone place calls that spend agent credit.

## Project media (image gallery, 3:2)

Suggested screenshots:
1. Ops dashboard during the delay rescue: ride card, broker transcript, decision log with the policy result.
2. The rider's trips page on a phone showing "A replacement ride is on the way."
3. Booking call transcript (rider and broker panes).
4. Architecture diagram from `02-ARCHITECTURE.md`.

## Video demo link

**[YOU]** Upload per `11-DEVPOST-VIDEO-SCRIPT.md`.

---

## Additional info (for judges and organizers)

### Sponsor / special prizes

- [Cartesia] Best Use of Cartesia
- [Convex] Best use of Convex
- [Anthropic] Claude for Public Benefit
- [Microsoft] Built for the Real World (1st), Customer Impact Award (2nd)
- Cal Hacks Best People-First Social Impact Hack
- Cal Hacks Best Solo Hack

### Emails used to apply to Cal Hacks 13.0

**[YOU]** The email you log in to Hive with.

### Universities or schools

**[YOU]**

### GoDaddy Registry domains

None.

### Feedback about technology

```
Cartesia (Managed Agents): Haiku 5.5 through Cartesia was fast enough to feel natural on the phone, and getting a free number that can call out was what made my outbound broker calls possible. Strict request validation gave precise errors, which made the API easy to discover. Things that cost me time: a tool whose custom dynamic variable is unset on a call fails before it is sent, and the error only shows up inside the call transcript; event payload shapes (call_turn and call_completed carry turns in `body`, with numeric ids) weren't in the docs I could reach; some API reference pages require logging in; POST /agents and POST /v1/agents create different kinds of agent; and a PATCH merges the language list, so switching an agent's primary language needed an explicit empty `additional` list. One number routing to one agent also meant one agent had to serve both of my caller types.

Convex: the anonymous local deployment let me build and test with no account, and live queries meant zero polling code for two live UIs. HTTP actions, the scheduler (for missed-call retries), and convex-test for end-to-end tests covered everything I needed. The main friction was TypeScript's circular inference when a function calls its own module through `internal`, which needs explicit return types.

Anthropic (Claude API): prompt caching cut the brain's input cost noticeably across turns, and the server-side refusal fallback was a one-line safety net. Keeping the brain on Sonnet 5.5 and the fast paths on Haiku 5.5 kept a full ride well under budget.

GitHub Pages: free and easy to automate with Actions, but single-page app routes need a 404.html fallback or a copied route folder.
```

### AI tools used this weekend

Anthropic, and Other: Cartesia (if the form asks, also mention Claude Code, the coding assistant used to build it).

### Did you implement a generative AI model or API?

```
Yes. Claude through the Anthropic API is Curb's decision layer: Claude Sonnet 5.5 decides the next step after each event (place a broker call, call the rider back, or escalate to a person), using tools whose guardrails are enforced in code, and Claude Haiku 5.5 turns broker call transcripts into structured outcomes. Claude Haiku 5.5 also runs the live phone conversations through Cartesia Managed Agents, with Cartesia's Sonic voices. I used generative AI because phone calls with riders and human brokers are unpredictable conversations, but I kept every decision that must be right (paperwork eligibility, whether a late driver triggers the plan's urgent-ride obligation) in deterministic, tested code, and log every decision the model makes.
```

### Gemini project number

Not applicable.
