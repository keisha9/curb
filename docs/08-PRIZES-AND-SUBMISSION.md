# 08 - Prizes and Submission

Based on the Cal Hacks 13.0 prize page (updated Oct 24, 6:13 PM). Re-check it for changes before submitting. Several sponsors list "coming soon" details.

## 1. Primary targets

| Prize | Why it fits | What judges look for | What to show and write |
|---|---|---|---|
| **Best Use of Cartesia** | Voice is the product, not a feature | Problem and originality, use of Cartesia, execution, impact and responsibility (25% each). Favors a working prototype | Demo-first 2-minute flow; README with setup, Cartesia features used, known limitations; no secrets in repo; accessibility and privacy notes |
| **Best use of Convex** | Ops dashboard and rider website both run on live queries; webhooks, schedulers, crons all on Convex | Real Convex features such as live queries and components | README section listing each Convex feature and where it is used; show both web apps updating live |
| **Anthropic** | Claude is the decision layer with deterministic guardrails | A named community, a real problem you have lived or heard about, it works, thoughtful use of Claude and where it could go wrong | Named community; one real conversation or source; the guardrails table from `05`; decision log on screen |
| **Microsoft: Built for the Real World** | Production-minded healthcare agent | Customer understanding, measurable usefulness, path to production, responsible design, end-to-end functionality | A short "path to production" section: plan partnership, member authorization, real website authentication, HIPAA, facility portals; measurable claim you can defend (see section 3) |

## 2. Secondary targets (add only if the work is already done)

| Prize | Condition |
|---|---|
| Cal Hacks Best Solo Hack | You are submitting alone |
| Cal Hacks Best People-First Hack | Strong social-impact framing, no extra build |
| Cal Hacks Hacker's Choice | None |
| MLH Best Use of Gen AI | Anthropic API use already qualifies; opt in at submission |
| Best Use of Auth0 | Only if you add Auth0 for AI Agents to model the rider-authorizes-agent story. **Extra build time; decide in `10-OPEN-DECISIONS.md`** |

## 3. Measurable usefulness (do not invent numbers)

Safe, defensible measures you can state from your own demo:
- Time for the rider to book: seconds on the call versus unknown hold time (do not claim a specific hold time without a source).
- Details the rider had to repeat: zero.
- Paperwork expiry caught: days of notice (if the cron is built).
If you cite external numbers (hold times, no-show rates), cite the source in the README.

## 4. README checklist (shared across prizes)

- [ ] One-paragraph problem and named community
- [ ] Demo GIF or screenshots of the ops dashboard and the rider trips website
- [ ] Setup steps and required environment variables (no values)
- [ ] **Cartesia:** what it does in the product, which features were used, known limitations
- [ ] **Convex:** table of features used and where
- [ ] **Claude:** where it runs, which models, what the guardrails are, where it could go wrong
- [ ] What is real versus simulated (explicit: human-played broker, fake data, texted-link website login)
- [ ] Responsible use: authorization, privacy, allowlist, no real PHI
- [ ] Path to production
- [ ] Known limitations
- [ ] Source access for judges per event rules; no API keys in the repo

## 5. Devpost and submission checklist

- [ ] Project title, tagline, description (reuse the README paragraphs)
- [ ] Video: opens with the delay catch and the replacement, then the full flow
- [ ] Repo link public or shared per event rules
- [ ] Opt in to each target prize in the submission form
- [ ] Describe in the description how each sponsor tool is used (several prizes require this)
- [ ] Team size and solo status correct
- [x] Product name set to Curb everywhere (README, Naming)
- [ ] Final check: run through the checklist in `06-BUILD-PLAN.md` section "Phase 6"

## 6. The Anthropic named-community paragraph (fill in with your facts)

> Draft: "Curb is for [specific community]. [One sentence on how you learned about the problem: a conversation, a family experience, or a cited source.] It books Medi-Cal medical rides by phone and rescues late ones, whether the rider or the broker reports the delay. Claude decides what to do next, but eligibility and delay rules are decided by code. The agent confirms every ride with the rider and logs every decision."

Do not claim an interview or personal experience that did not happen.
