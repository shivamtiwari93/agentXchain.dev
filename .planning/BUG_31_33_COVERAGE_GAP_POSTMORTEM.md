# BUG 31-33 Coverage Gap Postmortem

## Purpose

Document why the iterative planning conflict loop shipped through `v2.130.1`, what was missing from the tester-sequence suite, and what coverage still needs to be audited.

## What Failed

- `accept-turn --resolution human_merge` did not resolve anything. It only flipped `conflict_state.status` to `human_merging` and then reran the same overlap detector.
- Acceptance conflict detection did not explicitly distinguish durable same-role planning revisions from destructive overlap. Some flows were green only because `assigned_sequence` happened to advance, not because the policy was encoded.
- The beta suite had no scenario for iterative PM repair on durable `.planning/` artifacts and no scenario asserting that the advertised `human_merge` operator path ended in terminal acceptance.

## Root Causes

1. The suite covered conflict detection and conflict-loop messaging, but not the operator completion path.
   - We had tests for `turn_conflicted`, `reject-turn --reassign`, and status messaging.
   - We did not have a beta-tester scenario that executed `accept-turn --resolution human_merge` and asserted accepted terminal state.

2. Forward revision behavior was accidental, not explicit.
   - Fresh sequential PM turns could accept because `assigned_sequence` advanced.
   - That hid the policy gap: same-role PM-owned planning rewrites were not classified as forward revision anywhere in the conflict detector.

3. We trusted indirect green paths instead of testing the exact beta report.
   - The bug report was about durable planning repair across turns and a broken documented escape hatch.
   - The suite did not include either exact operator flow.

## What Shipped In The Fix

- `accept-turn --resolution human_merge` now accepts the active staged result in one invocation, records `conflict_resolution_selected` and `conflict_resolved`, and emits `conflict_resolved` to `.agentxchain/events.jsonl`.
- Acceptance overlap classification now distinguishes:
  - `forward_revision`: same role, PM-owned planning artifact rewrite
  - `file_conflict`: destructive overlap that still requires operator resolution
- New regression coverage:
  - `cli/test/beta-tester-scenarios/bug-31-human-merge-completion.test.js`
  - `cli/test/beta-tester-scenarios/iterative-planning-repair.test.js`
  - governed-state regression asserting stale same-role PM planning edits are treated as forward revision

## Why The Old Coverage Missed It

- We over-indexed on state transitions inside `governed-state.test.js` and under-indexed on beta-tester scenario files that mirror real operator commands.
- We validated that conflict banners existed but not that every documented recovery command had a terminal outcome.
- We treated “fresh turn accepts” as evidence that iterative planning was handled, even though the durable policy was not encoded.

## Remaining Coverage Gaps To Audit

- Conflict resolution after mixed forward-revision plus cross-role destructive overlap in the same acceptance attempt.
- `human_merge` on turns that were already stuck in persisted `human_merging` state from older repos.
- Dashboard/API exposure for `conflict_resolved` timeline events.
- Recovery/report/audit surfaces that summarize forward-revision acceptance without surfacing false conflict severity.

## Coverage Audit Plan

1. Audit every documented recovery command and confirm there is a beta-tester scenario for its terminal success path.
2. Audit every durable event listed in `VALID_RUN_EVENTS` and confirm at least one contract test reads and asserts it.
3. Audit every durable decision-ledger conflict transition:
   - `conflict_detected`
   - `conflict_rejected`
   - `conflict_resolution_selected`
   - `conflict_resolved`
   - `forward_revision_accepted`
4. Add a dashboard/API contract test for `conflict_resolved`.

## Dispatch Path × Lifecycle Matrix

The beta-tester reopen pattern is broader than BUG-31..33. The durable gap is that dispatch-path coverage has been uneven across lifecycle stages. We now track the matrix explicitly:

| Dispatch path | Initial dispatch | Retry dispatch | Cross-run / restart / resume migration | Acceptance guard |
| --- | --- | --- | --- | --- |
| `resume` CLI | Covered: `cli/test/intake-manual-resume.test.js` | Indirect only via shared bundle tests | Covered: `cli/test/intake-manual-resume.test.js` (stale prior-run intent archived on active-run resume) | Indirect via governed acceptance suites |
| `step` CLI | Covered indirectly via shared intake consumption tests | Indirect only | Covered indirectly via `consumeNextApprovedIntent()` shared contract | Indirect via `bug-36-gate-semantic-coverage.test.js` |
| `restart` CLI | Covered: `cli/test/beta-tester-scenarios/bug-21-intent-id-restart.test.js` | N/A | Covered indirectly via `cli/test/beta-tester-scenarios/bug-34-cross-run-intent-leakage.test.js` shared consume path | Indirect via governed acceptance suites |
| Continuous loop | Covered: `bug-16-unified-intake-consumption.test.js`, `continuous-run*.test.js` | N/A | Covered: `bug-34-cross-run-intent-leakage.test.js` | Indirect via acceptance/governed-state suites |
| Dispatch bundle writer | Covered: `bug-13-prompt-intent-foregrounding.test.js` | Covered: `bug-35-retry-intent-rebinding.test.js` | N/A | N/A |
| Acceptance / validator | N/A | N/A | N/A | Covered: `bug-14-intent-coverage-validation.test.js`, `bug-36-gate-semantic-coverage.test.js` |

### Remaining uncovered combinations

- **Direct CLI `step` retry proof is still missing.** We rely on shared dispatch-bundle coverage plus the shared `consumeNextApprovedIntent()` contract, but we do not yet have a beta-tester scenario that executes `step` end-to-end through rejection and retry rebinding.
- **Direct CLI `restart` retry-bundle proof is still missing.** `bug-21` proves restart binds intent provenance, but it does not assert the retried `PROMPT.md` surfaces the gate failure and injected intent together after a restart path.
- **Acceptance guard coverage is still library-heavy for manual command surfaces.** `bug-36` proves the validator rejects the bad transition, but there is no end-to-end beta-tester command sequence that goes `resume`/`step` → bad staged result → `accept-turn` rejection with the exact gate/file error.

### Standing rule

Every newly documented dispatch path or retry path must add one matrix row here and one executable proof per lifecycle stage it claims to support. Shared-library tests are useful, but they do not replace at least one real command-level proof for each operator-visible path.

## Acceptance Tests

- [x] `bug-31-human-merge-completion.test.js` proves single-invocation terminal acceptance.
- [x] `iterative-planning-repair.test.js` proves repeated PM repair turns on durable planning files accept cleanly.
- [x] governed-state regression proves stale same-role PM planning overlap is classified as forward revision.

## Open Questions

- Should `forward_revision_accepted` be surfaced in dashboard/report UX, or stay decision-ledger-only for now?
- Do we want a dedicated CLI report view for forward revisions, or is decision/event evidence sufficient?
