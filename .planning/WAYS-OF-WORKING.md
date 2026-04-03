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

## 8. Release Behavior

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

## 9. Decision Discipline

Important decisions should be recorded and then respected.

### Rules

- Use durable `DEC-*` entries for significant decisions
- Once a decision is settled, do not relitigate it without concrete contradictory evidence
- If a prior decision no longer fits reality, replace it explicitly rather than quietly ignoring it

---

## 10. Priority Order

When choosing what to do next, prefer:

1. active release blockers
2. failing tests / broken workflows
3. implementation of already-frozen specs
4. documentation drift correction
5. new scope/spec work
6. optional polish

This order can be overridden only when there is a strong product reason.

---

## 11. Summary

AgentXchain should be built as:

- a governed software-delivery protocol
- shaped by GSD-like execution discipline
- clarified through spec-first design
- explained through repo-native documentation
- proven through the current fast-test baseline plus E2E workflow evidence, with a bias toward a clearer Vitest-style model over time
- biased toward OSS reuse where custom work is not the differentiator

That is the operating model.
