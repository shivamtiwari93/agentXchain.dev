# PM Signoff — M15: Govern Without Micromanaging — Human Attention Surface — Vision Closure (VISION.md:51)

Approved: YES

**Run:** `run_2929265fcbabe440`
**Phase:** planning
**Turn:** `turn_fd0c9ed117cd5d23`
**Date:** 2026-06-27

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

The human operator of a lights-out / checkpoint-governed AgentXchain factory. VISION.md "Human Role" (199–220) keeps this person sovereign over five rights — set direction, define boundaries, **approve critical transitions**, **intervene during escalation**, **decide what ships** — while explicitly freeing them from "micromanage every step." The vision's end state requires "lights-out operation without requiring blind trust" (VISION.md:220). For that to be real, the operator needs a way to govern *by exception*: to see only the decisions that actually require them, across all runs, and otherwise stay out of the loop.

### Core Pain Point

VISION.md:51 — **"humans lose the ability to govern without micromanaging"** — is the final unaddressed bullet in the "Why This Must Exist" section (the M11→:47, M12→:48, M13→:49, M14→:50 sequence ends here at M15→:51). The triggers that legitimately require a human are real but **scattered**:

1. Pending phase-transition / completion approvals live in `state.blocked_on` (`human_approval:<gate>`) and are only shown by `status` for the *current* run.
2. Open escalations live in `human-escalations.jsonl`; `status` surfaces only the current run's.
3. Pending approved intents live in the intake system.
4. Credentialed gates that require a human even in lights-out (VISION.md:36) are computed per-phase by `approval-policy.js` but not aggregated.
5. Budget/policy blockers live in `state.blocked_on` (`budget:exhausted`, `policy:<id>`).

To govern today, the human must poll multiple surfaces (the definition of micromanaging) or trust blindly (the thing the vision forbids). The dashboard (M6) shows *everything* live — the opposite of exception-based. There is **no single command that answers "what needs MY attention right now — and nothing else?"** and, just as importantly, that goes **silent when nothing does.**

### Challenge to Previous Turn

The previous turn in the decision trail is the M14 QA gate re-clearance (`turn_b7ac694416a751c0`, run `run_74d17633499b410b`): a YES ship verdict for M14 Shippability Visibility after fixing the acceptance-matrix `| Req # |` header that had structurally rejected the prior gate request. I do **not** rubber-stamp it. I independently verified two things this turn rather than trusting the trail:

1. **M14 is genuinely closed, so replenishment is the correct charter.** ROADMAP M14 items 160–165 are all checked `[x]` on disk (re-read this turn), and the QA decisions record 23/23 ship-status + 69/69 combined tests at exit 0. The roadmap really is checked through M14 — the vision-scan intake that produced this run ("roadmap_exhausted_vision_open") is accurate. There is no half-closed M14 to drag forward.

2. **OBJ-001 — the chronic stale-artifact / unchecked-box defect must not recur.** The decision trail shows this exact failure nine-plus consecutive times: planning artifacts stamped with a prior run's id, and ROADMAP boxes left unchecked after the work landed (which is what re-triggered the duplicate M14 run in the first place). This turn I (a) wrote all three artifacts freshly stamped to `run_2929265fcbabe440` / `turn_fd0c9ed117cd5d23`, and (b) added M15 as **unchecked** items that exactly match the SYSTEM_SPEC deliverables, so the implementation/QA turns have unambiguous boxes to close. I am flagging the systemic gap (idle-expansion does not detect committed code behind unchecked boxes; artifact run-stamps are not auto-rewritten) as OBJ-001 in the turn result — non-blocking for M15, but a real protocol weakness worth a future hardening milestone.

### Core Workflow

1. **PM (this turn)** — Derive M15 from VISION.md:51, add unchecked M15 items to ROADMAP.md, author SYSTEM_SPEC.md + PM_SIGNOFF.md citing concrete VISION.md sections.
2. **Dev** — Build `human-attention.js` (`evaluateHumanAttention` composing ≥5 exception categories), `agentxchain attention` CLI command (`--json`/`--all`), govern-by-exception ordering, report integration, regression tests; check off the M15 ROADMAP items with delivery evidence.
3. **QA** — Verify the queue composes ≥5 categories, is empty/`clear` when no human decision is pending, orders deterministically, surfaces action hints; run full suite; ship verdict.

### MVP Scope

**Build milestone.** New module + new CLI command + report integration + tests.

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | `human-attention.js` module | `evaluateHumanAttention(repoDir)` composing ≥5 exception categories into a prioritized `HumanAttentionReport` |
| 2 | `attention` CLI command | `agentxchain attention` with `--json` and `--all`; exits 0 in clear and attention states |
| 3 | Govern-by-exception semantics | empty queue ⇒ `overall: 'clear'` + "Nothing needs your attention"; non-empty ⇒ deterministic priority order |
| 4 | Report integration | `human_attention` summary section in `buildGovernanceReport()` |
| 5 | Regression tests | clear, pending-approval, escalation, pending-intent, credentialed-gate, budget/policy, mixed-priority, `--json`/`--all`, read-only |

**≥5 exception categories composed by `evaluateHumanAttention()` (all read-only, via exported APIs):**

| # | Category | Source (verified exported this turn) | Human right (VISION.md) |
|---|----------|--------------------------------------|-------------------------|
| 1 | Pending approvals | `state.blocked_on` `human_approval:<gate>` (governed-state.js:2222) + `approval-policy.js` `evaluateApprovalPolicy` (:25) | approve critical transitions / decide what ships |
| 2 | Open escalations | `human-escalations.js` `readHumanEscalations` (:316), `findCurrentHumanEscalation` (:326) | intervene during escalation |
| 3 | Pending approved intents | `intake.js` `findPendingApprovedIntents` (:687) | set direction (dispatch approved work) |
| 4 | Credentialed gates | `approval-policy.js` `isCredentialedExitGate` (:57) | gates guarding credentialed actions (VISION.md:36) |
| 5 | Budget / policy blockers | `state.blocked_on` `budget:exhausted` (governed-state.js:868), `policy:<id>` (:691) | define boundaries |

### Out of Scope

- Acting on decisions (auto-approve, auto-resolve, auto-unblock) — M15 is **visibility/surfacing only**, mirroring M14's visibility-only discipline. Approval/resolution stay with the existing `approve-transition`/`escalate`/`unblock` commands.
- Notifications/push delivery (email, Slack, webhooks) — the attention queue is a queryable surface; routing it is a separate integration milestone.
- Dashboard/UI rendering of the attention queue — CLI + governance report only for M15.
- Changing how gates, escalations, or intents are *created* — M15 reads existing signals; it does not alter governance semantics.
- Cross-repo coordinator aggregation of the attention queue — single-repo for M15; a coordinator roll-up can follow once the single-repo surface is proven (kept out to stay bounded).

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | `human-attention.js` with `evaluateHumanAttention()` composing ≥5 exception categories | Dev implementation + AT-HA-001…009 |
| 2 | `agentxchain attention` CLI functional with `--json` and `--all`, exit 0 in both states | Dev demo + AT-HA-010…012 |
| 3 | Govern-by-exception: empty queue ⇒ 'clear' + "Nothing needs your attention"; non-empty ⇒ deterministic order | AT-HA-001, AT-HA-008, AT-HA-010 |
| 4 | Each item surfaces a concrete `action_hint` | AT-HA-002…007 |
| 5 | Governance report includes `human_attention` section | Dev integration test |
| 6 | `evaluateHumanAttention()` is read-only | AT-HA-013 |
| 7 | Regression tests pass with 0 failures | Dev test output |
| 8 | Vision closure: VISION.md:51 "humans lose the ability to govern without micromanaging" addressed | QA ship verdict |

### Design Decisions

#### DEC-001: M15 targets VISION.md:51 — the final "Why This Must Exist" pain bullet — via a govern-by-exception attention surface (category: scope)

The roadmap has closed VISION.md:47–50 across M11–M14. Line 51, "humans lose the ability to govern without micromanaging," is the last remaining bullet in that section and the natural next bounded increment. Rather than a vague "human UX" milestone, M15 is scoped concretely as a composition layer that aggregates the already-existing-but-scattered human-decision triggers into one prioritized, exception-filtered surface — directly serving the "Human Role" rights (VISION.md:199–220) and "lights-out without blind trust" (VISION.md:220).

#### DEC-002: M15 is a compose-don't-reimplement build milestone, mirroring M14's discipline (category: architecture)

Like M14's ship-status, M15 builds a new module + CLI command but composes existing logic — `governed-state` (`blocked_on`), `human-escalations` (readers), `intake` (`findPendingApprovedIntents`), and `approval-policy` (`isCredentialedExitGate`/`evaluateApprovalPolicy`). I verified every one of these symbols is exported against current source at HEAD `b8a92de3a` this turn, to prevent the Dev dead-end that prior planning turns repeatedly had to correct. Architecture Invariant #1 forbids reimplementing escalation/approval/intake logic.

#### DEC-003: The empty queue is a first-class success state — "Nothing needs your attention", exit 0 (category: quality)

The defining property of "govern without micromanaging" is that the surface goes **silent** when no human decision is pending. The spec makes `overall === 'clear' iff items.length === 0` an invariant, and the CLI exits 0 in both clear and attention states (it is a status surface, not a gate). This is what operationally distinguishes M15 from the dashboard (always-on, shows everything) and from `status` (single-run snapshot).

#### DEC-004: Compose-target APIs verified against source before signoff (category: quality)

Confirmed exported at HEAD `b8a92de3a`: `findPendingApprovedIntents` (intake.js:687); `readHumanEscalations` (human-escalations.js:316), `findCurrentHumanEscalation` (:326); `evaluateApprovalPolicy` (approval-policy.js:25), `isCredentialedExitGate` (:57); `getCoordinatorPendingGateSnapshot` (coordinator-pending-gate-presentation.js:25); and `state.blocked_on` encodes `human_approval:`, `budget:exhausted`, `policy:` (governed-state.js:2222, 868, 691). Dev must reach these through their real public surface, not re-parse ledgers.

## Notes for Dev

**Build milestone — new module, do not look for an existing one.** Unlike the recent M14 re-triggers, `human-attention.js` and the `attention` command do **not** exist yet; create them.

1. Create `cli/src/lib/human-attention.js`:
   - `evaluateHumanAttention(repoDir)` → `HumanAttentionReport` (`overall` 'clear'|'attention', `items[]`, `items_count`, `blocking_count`, `categories[]`, `evidence_summary`).
   - Each item: `{ category, priority, blocking, run_id, summary, action_hint }`.
   - Compose ≥5 categories via the verified exported APIs in DEC-004 — **do not** reimplement gate/approval/escalation/intake logic.
   - Enforce the deterministic Ordering contract (SYSTEM_SPEC): blocking first; escalation/credentialed outrank pending-approval outranks budget/policy outranks pending-intent; ties by run_id then summary.
   - Read-only — no writes to state/escalations/intents/config (AT-HA-013 asserts byte-identical files).
2. Create `cli/src/commands/attention.js`, register `agentxchain attention` in `cli/bin/agentxchain.js`:
   - `--json` (full report), `--all` (include informational pending-intent items).
   - Default lists blocking + escalation items, priority order, each with its `action_hint`.
   - Empty queue ⇒ print "Nothing needs your attention", exit 0. Exit 0 in attention state too.
   - Delegate all logic to the module (Architecture Invariant #6).
3. Integrate into `report.js` `buildGovernanceReport()` — add `human_attention` summary (`overall`, `items_count`, `blocking_count`, `categories[]`). `buildGovernanceReport` is at `report.js:1243`.
4. Create `cli/test/human-attention.test.js` covering AT-HA-001…013.
5. **Check off the M15 ROADMAP items** (the unchecked block under "### M15") with commit/turn refs as you land each — leaving them unchecked is the exact defect (OBJ-001) that re-triggers duplicate runs.
6. Produce/refresh IMPLEMENTATION_NOTES.md with Changes + Verification sections; run the full suite and record results.

## Notes for QA

- Run `cli/test/human-attention.test.js` and the full suite; confirm 0 failures.
- Verify ≥5 categories each produce a correct item with a concrete `action_hint`.
- Verify the empty-queue path: `overall: 'clear'`, zero items, CLI prints "Nothing needs your attention", exit 0.
- Verify deterministic priority ordering on a mixed-category fixture (AT-HA-008).
- Confirm `evaluateHumanAttention()` is read-only (AT-HA-013).
- Confirm `agentxchain attention` works with `--json` and `--all`, exiting 0 in both clear and attention states.
- Confirm the governance report includes the `human_attention` section.
- Vision closure: VISION.md:51 "humans lose the ability to govern without micromanaging" addressed by the cross-category govern-by-exception composition.

## Acceptance Contract

1. **New unchecked milestone items added to .planning/ROADMAP.md** — M15 "Govern Without Micromanaging — Human Attention Surface — Vision Closure (VISION.md:51)" added with 6 unchecked items (module, CLI command, govern-by-exception semantics, report integration, regression tests, acceptance) plus a Phases table; the M14 phases table was preserved under "Completed Milestone History."
2. **Milestone cites at least one concrete VISION.md source section from the unplanned backlog** — M15 cites VISION.md:51 "humans lose the ability to govern without micromanaging" (the final uncovered "Why This Must Exist" bullet), reinforced by the "Human Role" section (VISION.md:199–220), "lights-out without blind trust" (VISION.md:220), and credentialed-gate language (VISION.md:36). None were previously planned.
3. **Milestone is bounded, testable, and does not duplicate existing checked milestones** — bounded to one read-only composition module + one CLI command + report integration + tests (visibility only; no acting-on-decisions, notifications, UI, or coordinator roll-up). Testable via AT-HA-001…013. Distinct from M14 ship-status (release *readiness*, not human-action queue), M6 dashboard (always-on live view of everything), and the `status` command (single-run snapshot). Evidence source: ROADMAP.md "### M15" first unchecked item, deriving from VISION.md:51.
