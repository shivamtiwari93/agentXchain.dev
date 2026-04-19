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

## Startup Path Coverage Matrix

The BUG-39 false closure exposed a separate dimension we were not tracking explicitly: startup paths that can dispatch turns or select intake work.

| Startup path | Shared migration helper required | Current proof |
| --- | --- | --- |
| `run` (new run initialization) | Yes | `bug-39-intent-migration-null-run-id.test.js` |
| `run --continue-from ... --continuous` | Yes, before queue scan | `bug-40-continuous-startup-legacy-intent-resume.test.js` |
| Schedule-owned continuous session startup | Yes, before queue scan | Covered indirectly through shared continuous startup reconciliation; add a dedicated schedule command proof if this surface changes |
| `resume` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper |
| `step --resume` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper |
| `restart` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper |

### Standing startup rule

Any new startup path that can dispatch turns or scan intake must add one row to this matrix and must call the shared legacy-intent migration helper before it touches the queue.

## Role × Authority × Runtime Matrix

BUG-46 exposed a separate blind spot: we were still reasoning from role names (`qa`, `pm`, `dev`) instead of the actual contract tuple that acceptance enforces.

The durable unit is:

- role charter
- `write_authority`
- runtime type

If the framework claims arbitrary roles are valid, the test matrix has to track that explicitly.

| Role shape | `write_authority` | Runtime | Current proof | Gap status |
| --- | --- | --- | --- | --- |
| Standard QA reviewer | `review_only` | `manual` | Legacy governed lifecycle + tutorial/E2E suites | Covered |
| Standard QA reviewer | `review_only` | `local_cli` | Invalid by config contract; rejected by shared normalized-config validation | Covered |
| Standard implementation role (`dev`) | `authoritative` | `local_cli` | Broadly covered across `run`, `resume`, retry, conflict, and checkpoint suites | Covered |
| Standard planning role (`pm`) | `review_only` | `manual` | Intake, phase, and restart/resume suites | Covered |
| Non-standard retained-turn resolver (`pm` / product-marketing) | `authoritative` | `manual` | `bug-45-retained-turn-stale-intent-coverage.test.js` | Covered |
| **QA with code-writing authority** | **`authoritative`** | **`local_cli`** | **`bug-46-post-acceptance-deadlock.test.js`** | **Covered after BUG-46** |
| Arbitrary role with code-writing authority (for example `eng_director`, `product_marketing`) | `authoritative` | `local_cli` | `bug-46-post-acceptance-deadlock.test.js` arbitrary-role replay-cleanup scenario | Covered after BUG-46 follow-up proof |
| Proposed patch author | `proposed` | `local_cli` | `bug-46-post-acceptance-deadlock.test.js` — workspace artifact rejected (validator requires authoritative), patch artifact accepts/checkpoints/resumes, dirty-tree parity rejects undeclared files | Covered after BUG-46 proposed-tuple proof |

### Standing role-contract rule

When a beta bug depends on an unusual but valid contract tuple, the tester-sequence suite must name that tuple directly. "QA is usually review-only" is not a defense once the config schema permits `qa + authoritative + local_cli`.

## Dispatch Path × Lifecycle Matrix

The beta-tester reopen pattern is broader than BUG-31..33. The durable gap is that dispatch-path coverage has been uneven across lifecycle stages. We now track the matrix explicitly:

| Dispatch path | Initial dispatch | Retry dispatch | Cross-run / restart / resume migration | Acceptance guard | Phase-boundary behavior | Retained-turn reconciliation |
| --- | --- | --- | --- | --- | --- | --- |
| `resume` CLI | Covered: `cli/test/intake-manual-resume.test.js` | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`restart` seed path uses `resume` to produce the retained retry bundle) | Covered: `cli/test/intake-manual-resume.test.js` (stale prior-run intent archived on active-run resume) | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`resume` -> bad staged result -> `accept-turn` gate rejection) | Covered: `cli/test/beta-tester-scenarios/bug-44-phase-scoped-intent-retirement.test.js` (`resume` must not bind a retired implementation intent after QA entry) | Indirect via shared `accept-turn` path; retained-turn proof is command-level on `accept-turn`, not `resume` |
| `step` CLI | Covered indirectly via shared intake consumption tests | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (`step` -> reject -> `step --resume`) | Covered indirectly via `consumeNextApprovedIntent()` shared contract | Indirect via `bug-36-gate-semantic-coverage.test.js` | Indirect via `cli/test/intent-phase-scope.test.js`; add a dedicated `step` command proof if `step` grows distinct phase-boundary behavior | Indirect via shared `accept-turn` reconciliation; add a `step --resume` retained-turn proof if step gains distinct retained-state semantics |
| `restart` CLI | Covered: `cli/test/beta-tester-scenarios/bug-21-intent-id-restart.test.js` | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (retained retry bundle survives `restart`) | Covered indirectly via `cli/test/beta-tester-scenarios/bug-34-cross-run-intent-leakage.test.js` shared consume path | Indirect via governed acceptance suites | Not yet direct; relies on shared retirement + acceptance logic. Add a restart-specific proof if restart begins preserving queued phase-bound intents across transitions | Not yet direct; current BUG-45 proof is accept-turn-only, so add a restart-specific retained-turn reconciliation test if restart starts mutating embedded intake state |
| Continuous loop | Covered: `bug-16-unified-intake-consumption.test.js`, `continuous-run*.test.js` | N/A | Covered: `bug-34-cross-run-intent-leakage.test.js` | Indirect via acceptance/governed-state suites | Partially covered by shared retirement/coverage logic; BUG-44 still requires the tester’s live `run --continue-from ... --continuous` proof for closure | Indirect only; BUG-45 has no continuous retained-turn reconciliation proof yet because the tester’s retained-turn path is `accept-turn` on an already-dispatched turn |
| Dispatch bundle writer | Covered: `bug-13-prompt-intent-foregrounding.test.js` | Covered: `bug-35-retry-intent-rebinding.test.js` | N/A | N/A | N/A | N/A |
| Acceptance / validator | N/A | N/A | N/A | Covered: `bug-14-intent-coverage-validation.test.js`, `bug-36-gate-semantic-coverage.test.js` | Covered: `cli/test/intent-phase-scope.test.js` (already-exited phase items and gate-satisfied items are skipped during QA acceptance) | Covered: `cli/test/beta-tester-scenarios/bug-45-retained-turn-stale-intent-coverage.test.js` (updated live contract, completed-on-disk intent, missing-intent fail-closed, `intake resolve --outcome completed`, `HUMAN_TASKS.md` exclusion) |

### Remaining uncovered combinations

- **No currently-known dispatch-path × lifecycle gaps remain in this matrix.** `dispatch-path-lifecycle-matrix.test.js` closes the three operator-visible gaps that were still open when Turn 192 updated this postmortem.
- **Phase-boundary behavior is now tracked explicitly.** BUG-44 exposed a seam that startup-path and dispatch-path coverage did not capture: queue retirement and coverage semantics at the moment of phase exit.
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
