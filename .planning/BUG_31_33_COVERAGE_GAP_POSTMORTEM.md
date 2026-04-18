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

4. We repeated the same abstraction mistake on BUG-36.
   - The shipped test covered only `Required file missing: <path>`.
   - The beta tester hit the semantic emission `.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.`
   - We treated “one file-shaped reason passed” as proof that all file-shaped reasons were covered. That was indefensible.

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

- `human_merge` on turns that were already stuck in persisted `human_merging` state from older repos.
- Dashboard/API exposure for `conflict_resolved` timeline events.
- Recovery/report/audit surfaces that summarize forward-revision acceptance without surfacing false conflict severity.
- Release preflight still does not prove beta fixes against the shipped binary.

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
| `resume` CLI | Covered: `cli/test/intake-manual-resume.test.js` | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`restart` seed path uses `resume` to produce the retained retry bundle) | Covered: `cli/test/intake-manual-resume.test.js` (stale prior-run intent archived on active-run resume) | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`resume` -> bad staged result -> `accept-turn` gate rejection) |
| `step` CLI | Covered indirectly via shared intake consumption tests | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`step` -> reject -> `step --resume`) | Covered indirectly via `consumeNextApprovedIntent()` shared contract | Indirect via `bug-36-gate-semantic-coverage.test.js` |
| `restart` CLI | Covered: `cli/test/beta-tester-scenarios/bug-21-intent-id-restart.test.js` | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (retained retry bundle survives `restart`) | Covered indirectly via `cli/test/beta-tester-scenarios/bug-34-cross-run-intent-leakage.test.js` shared consume path | Indirect via governed acceptance suites |
| Continuous loop | Covered: `bug-16-unified-intake-consumption.test.js`, `continuous-run*.test.js` | N/A | Covered: `bug-34-cross-run-intent-leakage.test.js` | Indirect via acceptance/governed-state suites |
| Dispatch bundle writer | Covered: `bug-13-prompt-intent-foregrounding.test.js` | Covered: `bug-35-retry-intent-rebinding.test.js` | N/A | N/A |
| Acceptance / validator | N/A | N/A | N/A | Covered: `bug-14-intent-coverage-validation.test.js`, `bug-36-gate-semantic-coverage.test.js` |

### Remaining uncovered combinations

- **No currently-known dispatch-path × lifecycle gaps remain in this matrix.** `dispatch-path-lifecycle-matrix.test.js` closes the three operator-visible gaps that were still open when Turn 192 updated this postmortem.
- **The standing rule still applies.** New dispatch paths or recovery commands must add an explicit row and command-level proof before they can be called “covered.”

### Standing rule

Every newly documented dispatch path or retry path must add one matrix row here and one executable proof per lifecycle stage it claims to support. Shared-library tests are useful, but they do not replace at least one real command-level proof for each operator-visible path.

## Fourth False Closure Entry

### BUG-36 reopened as BUG-37 on `v2.135.0`

- **Shipped claim:** gate-semantic coverage rejection handled file-based gate failures.
- **Actual shipped behavior:** only the `Required file missing:` reason shape was covered. Semantic gate reasons with `<path> must define ...` bypassed the regex extractor and were silently accepted.
- **Beta evidence:** repeated accepted `dev` turns left `.planning/IMPLEMENTATION_NOTES.md` semantically unchanged while still proposing `qa`.
- **Turn 198 correction:** gate evaluation now returns structured `failing_files`; acceptance consumes that field directly; beta tests cover all three real file-emission shapes.

## Structural Discipline Rules Added After BUG-37

1. **Real emitter rule.** Any beta-tester scenario asserting on gate reasons, event payloads, or operator-facing error text must call the production emitter and assert its real output. Synthetic strings do not count as coverage.
2. **Claim-reality preflight rule.** A bug marked fixed is not releasable until its beta-tester scenario passes against the packaged CLI artifact that would actually ship, not just the source-tree test harness.

## Acceptance Tests

- [x] `bug-31-human-merge-completion.test.js` proves single-invocation terminal acceptance.
- [x] `iterative-planning-repair.test.js` proves repeated PM repair turns on durable planning files accept cleanly.
- [x] governed-state regression proves stale same-role PM planning overlap is classified as forward revision.
- [x] `mixed-forward-revision-conflict-guidance.test.js` proves the real `reject-turn --reassign` retry path keeps destructive conflict files distinct from safe forward revisions.
- [x] `dispatch-path-lifecycle-matrix.test.js` proves `step --resume` retry rebinding, `restart` retained retry-bundle preservation, and manual `resume` -> `accept-turn` gate-semantic rejection.
- [x] `bug-37-gate-semantic-real-emissions.test.js` proves all real gate file-emission formats reject turns that did not touch the gated artifact.

## Closed Questions

- **Forward-revision visibility boundary (DEC-FORWARD-REVISION-VISIBILITY-001):** `forward_revision_accepted` stays decision-ledger-only. No status/report/dashboard surface. Rationale: forward revision is a success-path signal (same-role edits correctly classified as non-destructive). Surfacing it in operator-facing UX adds noise without actionable value. The two paths where it IS visible — retry guidance (dispatch bundle) and decision ledger (audit) — cover the only scenarios where an operator or auditor needs the information. Revisit only if operators report confusion about why same-role file edits don't appear as conflicts.
