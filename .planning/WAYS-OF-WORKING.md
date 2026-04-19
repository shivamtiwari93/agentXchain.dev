# Ways Of Working — AgentXchain

> Durable execution guidance for agents collaborating on AgentXchain.dev.

This file exists so the project's working model is not trapped inside a shell prompt or scattered across ad hoc notes. `VISION.md` explains the north star. This file explains how work should be done.

---

## 1. Core Model

AgentXchain should be built using four stacked disciplines:

1. **GSD-inspired planning and execution**
2. **Spec-first development**
3. **Repo-native documentation**
4. **Vitest-style fast tests + E2E proof gates**

AgentXchain itself sits above those as the governance/orchestration layer.

Compressed framing:

- **GSD** defines what should ship next
- **Specs** define how it should behave
- **Repo docs** explain it clearly
- **fast tests + E2E** prove it works
- **AgentXchain** governs how agents converge on the result

---

## 2. GSD-Inspired Planning

This repo should bias toward practical shipping discipline, not process theater.

### Rules

- Prefer small, meaningful delivery slices over sprawling roadmap prose.
- Aggressively cut scope when a smaller slice can prove the same idea.
- Move from ambiguity to executable work quickly.
- If a slice is already specified tightly enough, implement it instead of re-planning it.
- When a problem is blocked, identify the exact blocker and its owner. Do not use vague language like "needs more thought" when the real issue is specific.

### Anti-Patterns

- writing specs with no delivery intent
- reopening settled decisions without concrete contradictory evidence
- doing large abstract "strategy" work when there is a release blocker in front of the repo
- inventing process language that hides ownership or progress

---

## 3. Spec-First Development

Every meaningful subsystem should have a written spec before implementation.

### Required spec structure

Each standalone spec should cover:

- Purpose
- Interface
- Behavior
- Error Cases
- Acceptance Tests
- Open Questions

### Rules

- Specs live in `.planning/`
- Specs should be narrow enough to implement without hand-waving
- A spec should define proof surfaces, not just ideas
- If implementation diverges from the spec, fix the drift immediately: either update code or update the spec
- If the behavior is stable and important, make the spec durable and explicit rather than burying it in `AGENT-TALK.md`

### What specs are for

- freezing behavior
- preventing relitigation
- making test targets explicit
- allowing different agents to continue work without context loss

---

## 4. Repo-Native Documentation

Documentation should live with the repo and be treated as part of the product surface.

### Rules

- Public docs, internal docs, release docs, and README surfaces should agree with the implementation
- Docs should explain real behavior, not aspirational behavior
- Marketing pages may frame the product strongly, but they should not contradict the CLI, specs, or protocol
- Prefer crisp operational documentation over vague conceptual prose
- Docs must remain navigable to a new operator reading the repo cold

### Required documentation surfaces

- `VISION.md`
  - why the product exists
- `WAYS-OF-WORKING.md`
  - how work gets done here
- `AGENT-TALK.md`
  - current collaboration log
- `HUMAN_TASKS.md`
  - true operator-required work only
- `README.md`
  - front door and practical getting-started path

---

## 5. Testing And Proof

The target proof stack is:

- **Vitest-style fast tests** for unit and integration behavior where appropriate
- **E2E tests** for workflow, protocol, CLI, and release-path proof

### Current baseline

- The repo still relies heavily on `node --test` today
- Agents should treat the current test runner baseline as valid
- The direction is to bias toward a clearer Vitest-style fast-feedback model where appropriate, without pretending the migration is already complete

### Rules

- Do not treat “some tests exist” as sufficient proof
- Acceptance criteria should be mapped to executable tests whenever practical
- Workflow-heavy behavior needs E2E coverage, not only unit coverage
- Fast test loops should be preserved where possible
- Release-blocking tests are real blockers, not optional cleanup
- When a fix hardens validation, reconciliation, or state repair, rerun the impacted legacy/fixture suites before calling it shipped; if the changed seam spans multiple startup or recovery paths, run the full suite rather than assuming the new regression tests are enough

### Preferred testing layers

1. unit/integration tests for local logic
2. contract tests for protocol boundaries
3. E2E tests for governed flows, release paths, hooks, and CLI behavior

### Anti-Patterns

- relying on one manual run instead of adding repeatable proof
- shipping protocol changes without updating the proof surface
- treating flaky tests as acceptable release behavior

---

## 6. OSS-First Principle

Use open-source pre-existing solutions as far as possible.

### Rules

- Before building custom infrastructure, check whether a mature OSS option already covers the need
- Prefer reuse if an OSS option solves at least 80 percent of the problem with acceptable tradeoffs
- Only build custom when there is a clear reason:
  - protocol differentiation
  - product-specific constraints
  - integration limitations
  - unacceptable control/security/maintenance tradeoffs

### Priority areas for OSS reuse

- docs systems
- dashboard scaffolding
- packaging/distribution surfaces
- plugin packaging/distribution patterns
- commodity infrastructure that is not core product differentiation

### Docs-specific note

The current custom `/docs/` surface was an acceptable early choice, but it should not be treated as permanently correct by default.

Agents should evaluate established OSS solutions before extending the custom docs stack much further. `Docmost` is one candidate worth examining, along with other credible docs platforms and lightweight docs stacks.

---

## 7. Human Escalation Standard

Human tasks are the last resort.

### Add a human task only when it is truly operator-required

Examples:

- payment or billing account action
- legal approval or signature
- credentials not available anywhere in repo/environment/access path
- physical device testing that cannot be emulated
- package registry or SaaS account settings that only the owner can change

### Do not escalate to humans for:

- decisions agents can argue out and resolve
- release steps agents can run themselves
- repo/docs/spec/test work
- debugging work
- operational steps that are merely annoying

If a human task is necessary:

- state the blocker precisely
- state why agents cannot resolve it
- state the exact next action the human must take

---

## 8. Social Posting (X/Twitter, LinkedIn, and Reddit)

**IMPORTANT: `DEC-TWITTER-AUTH-001` and `DEC-MARKETING-HUMAN-001` are SUPERSEDED.** Social posting is fully agent-available across all three channels. The human set up browser-automation tools (x-browser, li-browser, and r-browser) with active login sessions. Agents MUST actually run the marketing scripts below — do not defer to humans, do not skip posting, do not just claim "posted" without running the command. If the script returns an error, log it in AGENT-TALK.md.

Agents are responsible for keeping the community informed. Posts go to:
- **X/Twitter** (`@agentxchaindev` via `x-browser` with `--system-profile`)
- **LinkedIn** (company page via `li-browser`, company ID `112883208`, isolated tool profile by default)
- **Reddit** (`r/agentXchain_dev` via `r-browser`)

### When to post

1. **After every release** — use `bash marketing/post-release.sh "vX.Y.Z" "one-line summary"`. This posts to all three channels (X, LinkedIn, Reddit).
2. **After critical product or architectural decisions** — when a `DEC-*` entry meaningfully changes the product direction, protocol shape, or governance model, post a concise summary to all channels using `bash marketing/post-twitter.sh "text"`, `bash marketing/post-linkedin.sh "text"`, and `bash marketing/post-reddit.sh "title" "body"`.
3. **Community updates ("good to know")** — post frequently about interesting progress, new examples, new comparison pages, new docs, proof evidence, or anything the community would find valuable. **Post at least once every 3-5 turns.** If you shipped something, wrote a comparison page, added a new example, improved docs, or made any user-facing progress — post about it. Err on the side of posting too much rather than too little.

### Rules

- Keep posts concise and factual. No hype, no vague claims.
- Always include a link to the relevant page (release notes, docs, comparison page, etc.).
- For X/Twitter: include `#AgentXchain` and relevant hashtags. Stay under 280 characters when possible, but longer posts are fine.
- For LinkedIn: include `#AgentXchain` and relevant hashtags. Write in a professional but approachable tone. Can be longer-form.
- For Reddit: use a clear descriptive title. Body should explain what changed and why it matters.
- Do not post about trivial fixes, test-only changes, or spec-only work unless it represents a significant product direction.
- Do not post duplicate content — if you posted about v2.25.0, do not re-post the same content for v2.25.1 unless the patch has its own noteworthy story.
- Posts should be written from the project's voice, not from an individual agent's voice.

### Scripts

- `bash marketing/post-twitter.sh "tweet text"` — post to X/Twitter (@agentxchaindev)
- `bash marketing/post-linkedin.sh "post text"` — post to LinkedIn company page
- `bash marketing/post-reddit.sh "title" "body"` — post to r/agentXchain_dev
- `bash marketing/post-release.sh "vX.Y.Z" "summary"` — post to all three channels

These scripts use browser automation (x-browser, li-browser, and r-browser). They require a Chrome instance with active login sessions. If a post fails, log the error in AGENT-TALK.md and move on — do not block release work on social posting failures. The `post-release.sh` script is resilient — if one channel fails, the others still post.

### X/Twitter posting (updated 2026-04-11)

The new account is `@agentxchaindev` (note: no underscore). `x-browser` uses `--system-profile` to access the logged-in Chrome profile. The command is: `x-browser --system-profile --min-delay 2 --max-delay 5 tweet post "text"`.

### LinkedIn posting (added 2026-04-10)

`li-browser` posts to the AgentXchain company page (ID `112883208`) using its own persisted browser profile by default. `post-linkedin.sh` only opts into `--system-profile` when `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1` is set. The wrapper now verifies the ambiguous `composer remained open after clicking the submit control` failure against the company admin feed before declaring failure, and it only profile-fallbacks on non-ambiguous errors. The `--company-id` flag is passed automatically by `post-linkedin.sh`.

### Wrapper retry boundary (updated 2026-04-15)

Repo-owned social wrappers may retry once with the opposite browser profile on non-ambiguous failures. They must not blindly retry ambiguous post-submit states that can already have published the content.

### Reddit posting (updated 2026-04-10)

`r-browser` uses **new Reddit** (www.reddit.com) instead of old.reddit.com. Old Reddit forced visible CAPTCHAs on the low-karma `u/agentXchain_dev` account; new Reddit uses invisible reCAPTCHA that auto-passes. Reddit posting is now **working reliably**.

---

## 9. Release Behavior

Agents should treat release execution as part of the job, not as something to hand off by default.

### Agents should do directly when possible

- git add / commit / push
- version bumps
- tags
- GitHub releases
- workflow reruns
- Homebrew formula updates
- docs/release announcement updates

### Release principle

- do not force inconsistent state
- if a tagged release is no longer recoverable cleanly, explicitly recommend the next corrective version instead of pretending the broken release is fine

---

## 10. Decision Discipline

Important decisions should be recorded and then respected.

### Rules

- Use durable `DEC-*` entries for significant decisions
- Once a decision is settled, do not relitigate it without concrete contradictory evidence
- If a prior decision no longer fits reality, replace it explicitly rather than quietly ignoring it

---

## 11. Priority Order

When choosing what to do next, prefer:

1. active release blockers
2. failing tests / broken workflows
3. implementation of already-frozen specs
4. documentation drift correction
5. new scope/spec work
6. optional polish

This order can be overridden only when there is a strong product reason.

---

## 12. Summary

AgentXchain should be built as:

- a governed software-delivery protocol
- shaped by GSD-like execution discipline
- clarified through spec-first design
- explained through repo-native documentation
- proven through the current fast-test baseline plus E2E workflow evidence, with a bias toward a clearer Vitest-style model over time
- biased toward OSS reuse where custom work is not the differentiator

That is the operating model.
