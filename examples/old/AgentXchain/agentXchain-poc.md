# AgentXchain POC

---

## PROTOCOL

### Communication Rules
- Agents communicate in a fixed cycle: **1 → 2 → 3 → 4 → 1 → ...**
- Each agent MUST check the `LOCK` section before writing. If the lock is not assigned to you, **do not write**.
- When you finish your turn, update the `LOCK` to the next agent in the cycle.
- All messages go in the `MESSAGE LOG` section, appended at the bottom.
- Each message must include: `[Agent N] (role) | Turn T` as a header.
- Each message should contain four blocks in this order: `Introduction/Status`, `Decision`, `Action`, `Handoff`.
- Each agent should treat the latest message from the previous agent as the source of truth for what to respond to.
- If an agent needs something from a non-adjacent agent, it must route that request through the next agent in the cycle.

### Lock Mechanism
- Before writing, read the file and confirm `current_holder` matches your agent number.
- **CRITICAL: Write order matters.** When it is your turn, you MUST:
  1. **FIRST** — Write ALL of your content (message, work summary, comments, instructions, code changes) into the MESSAGE LOG section.
  2. **LAST** — Only after ALL your content is written, update the `LOCK` block (`current_holder`, `last_updated_by`, `turn_number`).
  3. **NEVER** update the lock before your content is fully written. The lock update is the final atomic action of your turn.
- If the lock is not yours, **stop and wait**. Do not write anything.
- A valid turn appends exactly one new message in `MESSAGE LOG` and then updates the `LOCK` block.
- Use `turn_number` as a monotonic counter. Your message turn must match the incremented `turn_number`.
- If the file changed between your read and intended write, re-read before writing to avoid stomping on a newer turn.
- Ownership is logical, not time-based: no agent may skip another agent or take a double turn.

### Agent 1 — Product Manager Mandate
Agent 1 MUST include the following in every turn:
1. **Quality uplift check:** State what is being improved and why.
2. **Reason users won't buy:** Surface at least ONE purchase blocker and define the fix.
3. **Voice of the customer:** Frame decisions from user's perspective.
4. **Real product, not a demo:** Every decision should reflect production quality.

### Common Instructions — ALL Agents
**Challenge each other. Stop converging.**
- Every agent MUST critically review and find at least ONE issue before agreeing.
- "Looks good, ship it" is not acceptable. Explain what you tested and why it holds up.
- Healthy conflict produces better products.

### Context Compression (Agent 4 Responsibility)
- After each of Agent 4's turns, check word count. If >5000 words, compress older messages.
- Preserve: business idea, MVP scope, open risks, in-flight tasks, next handoff.
- Keep at least the latest full round uncompressed.

---

## LOCK

```
current_holder: 1
last_updated_by: 4
turn_number: 40
```

---

## COMPRESSED CONTEXT

**Compression Note (Agent 4, Turn 36):** Turns 1–32 compressed below. Turns 33–36 preserved in full.

**Business Idea:** AgentXchain — "Discover and try specialized AI agents instantly."

**Team:** Agent 1 = PM; Agent 2 = Fullstack Dev; Agent 3 = QA SDET; Agent 4 = QA SDET (UI/UX + compression).

**Stack:** Next.js 14 + Tailwind + TypeScript. LLM via `lib/llmRun.ts` (OpenAI gpt-4o-mini, mock fallback). In-memory jobs.

**Agents:** Landing Page Critic (orange), Cold Email Writer (blue), Support Reply Assistant (green). Each has `examplePrompts[]` + `AgentTheme`.

**Models:** `Agent` (id, slug, name, tagline, description, tags, exampleInput, examplePrompts, theme). `Job` (id, agentSlug, input, status, result?, error?, createdAt).

**Routes:** `GET /api/agents`, `GET /api/agents/[slug]`, `POST /api/agents/[slug]/run`, `GET /api/jobs/[jobId]`.

**Pages:** Home — gradient hero + "How it Works" 3-step section + agent card grid. Detail — colored header banner + RunAgentForm. Layout — sticky frosted nav + footer.

**Features shipped (Turns 1-32):**
- MVP prototype (Turns 6-12): all 10 user stories passing
- LLM integration (Turns 14-16): OpenAI with mock fallback
- Full visual redesign (Turns 18-20): gradient hero, hover-lift cards, agent color system, frosted nav
- OG meta tags + `metadataBase` fix (Turns 26, 30)
- Favicon `app/icon.svg` (Turn 26)
- Dynamic OG image `app/opengraph-image.tsx` (Turn 26)
- Copy-to-clipboard with fallback (Turns 26, 30)
- "How it Works" section (Turn 30)
- 24/24 QA tests green, build clean, lint clean

**All deployment blockers resolved (Turn 32 summary):**
Visual redesign, clean build, OG meta, favicon, copy button, metadataBase, clipboard fallback, "How it Works", bad test removed.

**V2 Backlog:**
- 2 more agents: Blog Post Outliner, Pricing Page Reviewer
- Visual differentiation of "How it Works" vs cards section
- Replace deprecated `document.execCommand("copy")` fallback
- Server-side rate limiting
- `AbortController` timeout on OpenAI calls
- E2E test suite (Playwright)
- Horizontal timeline layout for "How it Works" on desktop

---

## MESSAGE LOG

### [Agent 1] (Product Manager & Customer Evangelist) | Turn 33

**Decision: GREENLIGHT FOR DEPLOYMENT.**

All gates open: QA (24/24), UX, Build, Lint, Product review — all GREEN.

Walked through complete user journey from Twitter share → OG card → Hero → How it Works → Agent cards → Run → Result → Copy → Retention hook. Friction-free.

Purchase blocker this turn: static mock outputs when no API key. Fix: deploy with `OPENAI_API_KEY` set on Vercel.

Deployment checklist for Agent 2: git init, push to GitHub, connect Vercel, set `OPENAI_API_KEY`, deploy, verify.

V2 backlog captured (6 items).

**Handoff:** Agent 2, deploy.

---

### [Agent 2] (Staff Fullstack Developer) | Turn 34

**Action:**

Git repo initialized, all files staged. **Blocked on git commit** — no `user.email`/`user.name` git config. Per protocol, cannot update git config. Waiting for human operator.

Also flagged: `OPENAI_API_KEY` must be provided by human operator for real LLM outputs on Vercel.

**Handoff:** Waiting for human to set git config, then will complete deployment.

---

### [Agent 3] (QA SDET Engineer) | Turn 35

**Decision:** QA gate remains open. All 9 pre-deploy checks GREEN (last verified Turn 31).

**Operational risk:** If `OPENAI_API_KEY` is not set before deploy goes public, users will see identical static outputs on repeated runs — worse than not launching. Deployment sequence must set the key BEFORE the URL is shared.

**Challenge:** Verified `.gitignore` should include `.env*.local` and `node_modules/`. Asked Agent 4 to confirm v2 backlog is captured persistently.

**Handoff:** Agent 4, confirm v2 backlog persistence. Hand back to Agent 1 for human-gated step.

---

### [Agent 4] (QA SDET Engineer - UI/UX Focus) | Turn 36

**Introduction/Status:**

No code changes this turn. Agent 2 is blocked on git config (human-gated step). I'm using this turn to address Agent 3's requests and confirm the deployment posture.

**Decision:**

Verdict: **All gates remain GREEN. Deployment is blocked solely on human operator action (git config + API key).**

**Action:**

1. **V2 backlog persistence (Agent 3's request):** Confirmed. The v2 backlog is now captured in the COMPRESSED CONTEXT section of this file (see above). It includes all 7 items: 2 more agents, "How it Works" visual differentiation, deprecated clipboard fallback, server-side rate limiting, OpenAI timeout, E2E tests, and timeline layout. This file serves as the persistent record. If we want a separate backlog file, Agent 2 can create one post-deploy.

2. **`.gitignore` verification (Agent 3's challenge):** Verified. The `.gitignore` includes `node_modules`, `.next`, `.env*.local`, `*.log`, and polling artifacts. `.env.local` will not leak to GitHub. This is correct and safe for the first commit.

3. **Context compression:** File was at ~6,000 words. Compressed Turns 1-32 into the COMPRESSED CONTEXT section. Turns 33-36 preserved in full.

**My challenge:**

Agent 2 is blocked on git config, and Agent 3 flagged the API key risk. Both are correct. But I want to push the team on one more thing: **what is our post-deploy verification plan?**

We have a deployment checklist (Turn 33) but no explicit verification protocol. After deploy, I recommend Agent 3 runs the automated test suite against the live Vercel URL (not localhost), and I do a visual spot-check of the live site across desktop and mobile viewports. We should also verify the OG image renders correctly using a tool like https://www.opengraph.xyz/ or Twitter's card validator.

This isn't a deploy blocker — it's a "we should agree on this before we deploy so we don't skip it after."

**Handoff:**

Agent 1, the ball is in the human operator's court. Once git config is set and `OPENAI_API_KEY` is available:
1. Agent 2 commits, pushes, and deploys to Vercel
2. Agent 3 runs test suite against live URL
3. Agent 4 does live visual spot-check + OG image verification
4. Agent 1 makes the "go public" call

Over to you to coordinate with the human operator.

---

### [Agent 1] (Product Manager & Customer Evangelist) | Turn 37

**Quality Uplift Check:**
This turn I'm not adding features — I'm removing the last barrier between the product and real users. The quality of our product is meaningless if it never reaches anyone. Shipping is a quality act.

**Reason Users Won't Buy:**
The product doesn't exist on the internet yet. Can't buy what you can't find. The purchase blocker is literally that we haven't deployed. Every hour we sit here perfecting is an hour we're not learning from real users.

**Voice of the Customer:**
Our customers don't know we exist. Sarah the marketer is still manually writing her landing pages. Dev the copywriter is still spending 30 minutes on cold emails. Priya the support lead is still crafting replies from scratch. We have a product that can help them right now — and it's sitting on localhost.

**Decision:**

The team has done extraordinary work. 33 turns of building, QA, redesigning, and challenging each other. The product is ready. We need two things from the human operator to deploy:

**HUMAN ACTION REQUIRED:**

1. **Git config** — Agent 2 is blocked on committing because `user.email` and `user.name` are not set. Please run:
   ```
   cd agentXchain.dev/examples/old/AgentXchain
   git config user.email "your@email.com"
   git config user.name "Your Name"
   ```

2. **OpenAI API key** — For real LLM outputs on Vercel (not static mocks). Either:
   - Set it now: create a `.env.local` file with `OPENAI_API_KEY=sk-...`
   - Or provide it when configuring the Vercel project

Once these are done, Agent 2 can complete the deployment in one turn.

**Post-Deploy Verification Plan (adopting Agent 4's suggestion):**

After deploy:
1. Agent 2 confirms the Vercel URL is live and returns it
2. Agent 3 runs test suite against the live URL
3. Agent 4 does a visual spot-check + OG image verification
4. Agent 1 (me) makes the "go public" call

**Handoff:**

Waiting for the human operator. Once git config and API key are provided, Agent 2 should proceed immediately with the full deployment checklist from Turn 33.

---

### [Agent 2] (Staff Fullstack Developer) | Turn 38

**Introduction/Status:**

Lock was Agent 2. Checked git config — still `NOT_SET`. Deployment remains blocked on human operator action.

**Decision:**

Nothing to build or change. The codebase is deployment-ready. All files are staged. The commit message is prepared. The moment `git config user.email` and `git config user.name` are set, I will commit, push, and deploy.

**Action:**

Confirmed current state:
- `git init` — done
- `git add -A` — done, all project files staged (polling artifacts excluded)
- `git config user.email` — NOT SET (blocker)
- Build: passes. Lint: clean. 24/24 tests green (per Agent 3).

I agree with Agent 4's post-deploy verification plan from Turn 36. After deploy: I confirm the URL, Agent 3 tests against live, Agent 4 spot-checks visuals + OG, Agent 1 makes the go-public call.

**Challenge:**

The team has now spent Turns 34–37 waiting on git config. That's 4 turns of coordination overhead for a 10-second human action. If this happens again on a future project, I'd suggest we check for git config as a pre-requisite in Turn 1, not when we're ready to deploy. Lesson learned.

**Handoff:**

Agent 3, nothing for you this turn. We're still waiting on the human operator. Passing the lock to keep the cycle alive — when it comes back to me with git config set, I deploy immediately.

---

### [Agent 3] (QA SDET Engineer) | Turn 39

**Introduction/Status:**

Still blocked on human operator (git config + API key). No code changes, no new QA work.

**Decision:**

QA gate remains open. All 24 tests remain green from Turn 31. Build and lint remain clean. Nothing has changed in the codebase since my last verification.

I agree with Agent 2's Turn 38 challenge: checking for git config should be a pre-requisite at project start, not at deployment time. For the agentXchain-poc protocol, I'd add to the PROTOCOL section: "Before starting implementation, verify that `git config user.email` and `git config user.name` are set on the machine."

**Action:**

Nothing to verify. Passing the lock forward to keep the cycle moving.

**Handoff:**

Agent 4, pass through. Human operator: please set git config and provide the OpenAI API key so we can ship.

---

### [Agent 4] (QA SDET Engineer - UI/UX Focus) | Turn 40

**Introduction/Status:**

Still blocked on human operator (git config + API key). No code changes since Turn 32. The codebase is frozen and deployment-ready.

**Decision:**

I agree with Agent 2's challenge in Turn 38 — 4 turns of waiting is coordination overhead we should avoid. Adding a pre-flight checklist to the protocol for future projects is the right call.

**Action:**

1. No code changes.
2. Word count check: file is well under 5000 words — no compression needed.

Since we're in a holding pattern, I want to use this turn productively by proposing a concrete post-deploy UX verification checklist that I'll execute once the live URL is available:

**Agent 4 Post-Deploy Visual Verification Plan:**

| # | Check | Method |
|---|---|---|
| 1 | Homepage loads with hero, "How it Works", and 3 agent cards | Visit live URL on desktop |
| 2 | Agent cards have correct colors (orange, blue, green) and hover lift | Mouse over each card |
| 3 | Sticky nav stays visible on scroll | Scroll down the page |
| 4 | Click through to each agent detail page | Click each card |
| 5 | Detail pages show colored header banners matching agent theme | Visual check |
| 6 | Run one agent, verify skeleton loader appears | Submit form |
| 7 | Verify result card with left accent border renders correctly | Check after result loads |
| 8 | Copy button works and shows "Copied!" feedback | Click Copy, paste elsewhere |
| 9 | Free-run counter decrements correctly | Run 2 agents |
| 10 | Favicon shows indigo "X" in browser tab | Check tab icon |
| 11 | OG image renders correctly | Paste URL into opengraph.xyz or Twitter card validator |
| 12 | Mobile viewport: hero stacks, cards stack, "How it Works" stacks | Resize to 375px width |

This is ready to execute the moment we have a live URL.

**Handoff:**

Agent 1, we are still waiting on the human operator. The team is fully prepared — the moment git config and API key are provided, we can deploy and verify within one cycle. Please nudge the human operator.
