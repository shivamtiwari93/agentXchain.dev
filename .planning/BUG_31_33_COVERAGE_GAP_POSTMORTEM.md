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
| `resume` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper; also calls `reconcileStaleTurns()` (BUG-47) before acting |
| `step --resume` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper; also calls `reconcileStaleTurns()` (BUG-47) before acting |
| `restart` | Yes | Covered indirectly through `reactivateGovernedRun()` + shared startup helper |

### BUG-47 stale-turn reconciliation dimension (added 2026-04-19)

BUG-47 added a lazy stale-turn watchdog that fires on operator-facing CLI commands. The reconciliation call sites are:

| Command | Call site | Behavior on stale turn |
| --- | --- | --- |
| `status` | `cli/src/commands/status.js` → `reconcileStaleTurns()` | Transitions stale `running`/`retrying` turns to `stalled`, emits `turn_stalled`, surfaces recovery guidance |
| `resume` | `cli/src/commands/resume.js` → `reconcileStaleTurns()` | Same reconciliation + fails closed with stale-turn guidance instead of redispatching |
| `step --resume` | `cli/src/commands/step.js` → `reconcileStaleTurns()` | Same reconciliation + fails closed with stale-turn guidance instead of redispatching |

These are **not startup paths** in the dispatch sense (they do not dispatch new turns or scan intake). They are **reconciliation checkpoints** that catch stale turns before an operator acts on them. The distinction matters: `run`, `restart`, and continuous loop are startup paths; `status`, `resume`, and `step --resume` are operator-facing recovery surfaces that now also participate in state reconciliation.

The startup-path matrix above does not need new rows for these because `resume` and `step --resume` already have rows. What changed is that those rows now also carry stale-turn reconciliation responsibility. The "Shared migration helper required" column should be read as: "must call both legacy-intent migration AND stale-turn reconciliation before acting."

Proof: `cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js` (7 tests, 0 failures).

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
| `restart` CLI | Covered: `cli/test/beta-tester-scenarios/bug-21-intent-id-restart.test.js` | Covered: `cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js` (retained retry bundle survives `restart`) | Covered indirectly via `cli/test/beta-tester-scenarios/bug-34-cross-run-intent-leakage.test.js` shared consume path | Indirect via governed acceptance suites | Covered directly: `cli/test/beta-tester-scenarios/bug-44-phase-scoped-intent-retirement.test.js` and restart startup path reuse shared retirement logic | Covered directly: `cli/test/beta-tester-scenarios/bug-45-retained-turn-stale-intent-coverage.test.js` proves restart preserves retained-turn intent binding and acceptance still reconciles against the live intent contract |
| Continuous loop | Covered: `bug-16-unified-intake-consumption.test.js`, `continuous-run*.test.js` | N/A | Covered: `bug-34-cross-run-intent-leakage.test.js` | Indirect via acceptance/governed-state suites | Partially covered by shared retirement/coverage logic; BUG-44 still requires the tester’s live `run --continue-from ... --continuous` proof for closure | Indirect only; BUG-45 has no continuous retained-turn reconciliation proof yet because the tester’s retained-turn path is `accept-turn` on an already-dispatched turn |
| Dispatch bundle writer | Covered: `bug-13-prompt-intent-foregrounding.test.js` | Covered: `bug-35-retry-intent-rebinding.test.js` | N/A | N/A | N/A | N/A |
| Acceptance / validator | N/A | N/A | N/A | Covered: `bug-14-intent-coverage-validation.test.js`, `bug-36-gate-semantic-coverage.test.js` | Covered: `cli/test/intent-phase-scope.test.js` (already-exited phase items and gate-satisfied items are skipped during QA acceptance) | Covered: `cli/test/beta-tester-scenarios/bug-45-retained-turn-stale-intent-coverage.test.js` (updated live contract, completed-on-disk intent, missing-intent fail-closed, `intake resolve --outcome completed`, `HUMAN_TASKS.md` exclusion) |

### Remaining uncovered combinations

- **No currently-known dispatch-path × lifecycle gaps remain in this matrix.** `dispatch-path-lifecycle-matrix.test.js` closes the three operator-visible gaps that were still open when Turn 192 updated this postmortem.
- **Phase-boundary behavior is now tracked explicitly.** BUG-44 exposed a seam that startup-path and dispatch-path coverage did not capture: queue retirement and coverage semantics at the moment of phase exit.
- **The standing rule still applies.** New dispatch paths or recovery commands must add an explicit row and command-level proof before they can be called “covered.”

### Standing retained-turn reconciliation rule

Every acceptance path that claims retained-turn support must prove all three intent-state-drift scenarios explicitly:

1. intent completed between dispatch and acceptance
2. intent contract changed between dispatch and acceptance
3. intent retired by phase advance between dispatch and acceptance

The retained-turn reconciliation column is not satisfied by generic acceptance coverage. At least one command-level proof has to name the actual retained-turn path that reconciles the live intent state.

### Standing rule

Every newly documented dispatch path or retry path must add one matrix row here and one executable proof per lifecycle stage it claims to support. Shared-library tests are useful, but they do not replace at least one real command-level proof for each operator-visible path.

### Standing lifecycle-event rule

Tests that assert on lifecycle events such as `turn_dispatched` must drive the real lifecycle transition that emits the event. Raw prerequisites are not enough:

- `consumeNextApprovedIntent()` with `writeDispatchBundle: false` is queue preparation, not dispatch
- `writeDispatchBundle()` alone is artifact materialization, not dispatch
- the proof surface must include either the real command (`restart`, `step`, `resume`, `run`, `intake start`) or the full library sequence (`writeDispatchBundle` + `finalizeDispatchManifest` + `transitionActiveTurnLifecycle('dispatched')`)

Otherwise the suite is only proving that the test forgot to dispatch, not that the product regressed.

### Standing unreachable-branch rule

Coverage matrices may mark a branch as **unreachable under the current schema** when both of these are true:

1. the state shape needed to enter the branch is rejected by the shared schema/normalizer contract
2. the matrix cites the exact schema gate or guard that makes it unreachable

Dead-code branches may still be patched defensively, but they must not be counted as uncovered operator behavior until the schema admits them.

### Standing dead-branch removal rule (Turn 25, `DEC-DEAD-BRANCH-REMOVAL-001`)

Once a branch is confirmed unreachable under the schema **and** every legacy on-disk shape that could have entered it has a documented migration path to a different (reachable) branch, the dead branch is **removed**, not patched defensively. Removal requires:

1. A code comment at the deletion site citing the schema gate AND the migration site that redirects legacy shapes.
2. A regression test that locks both invariants — schema rejection + legacy migration — so future schema or migration regressions surface as test failures rather than silently re-animating the dead branch.
3. An entry in this matrix (below) naming the removed branch, the schema citation, and the migration citation.

Defensive patching of a dead branch is the wrong durability strategy: it leaves the branch in the codebase where the next agent has to re-derive its unreachability and may add tests that exercise no production behavior. Delete + lock invariants is cheaper to maintain.

### Removed dead branches (`DEC-DEAD-BRANCH-REMOVAL-001`)

| Removed branch | Schema citation | Migration citation | Invariant test |
| --- | --- | --- | --- |
| `cli/src/commands/resume.js` `state.status === 'paused' && activeCount > 0` (paused+retained re-dispatch failed/retrying) | `cli/src/lib/schema.js:184` rejects paused without `pending_phase_transition` / `pending_run_completion` | `cli/src/lib/governed-state.js:2191-2204` migrates legacy paused + `blocked_on:'human:...'` / `blocked_on:'escalation:...'` to `status: 'blocked'` on read | `cli/test/governed-state.test.js` "schema rejects fresh paused writes that lack pending approval" + "legacy paused + blocked_on:human:... is migrated to blocked" + "legacy paused + blocked_on:escalation:... is migrated to blocked" |
| `cli/src/commands/step.js` `state.status === 'paused' && activeCount > 0` (paused+failed/retrying re-dispatch) | same as above | same as above | same as above |

## Config Surface Validation Matrix

BUG-51 exposed a separate failure mode outside dispatch itself: a config field can
be published in schema/docs, consumed by runtime defaults, and still lie to the
operator if the governed front doors do not reject bad values explicitly.

| Surface | Required behavior | Current proof |
| --- | --- | --- |
| `config --set` | Reject invalid watchdog values before writing config to disk | `cli/test/config-governed.test.js` (`AT-CFGG-RL-001`..`AT-CFGG-RL-005`) |
| `validate --json` | Fail closed on hand-edited invalid watchdog values already on disk | `cli/test/config-governed.test.js` (`AT-CFGG-RL-006`) |
| `doctor --json` | Surface the same invalid watchdog values as a failing `config_valid` check with non-zero exit | `cli/test/governed-doctor-e2e.test.js` (`AT-GD-014`) |

### Standing config-validation rule

Any published config field that also has a typed runtime default must prove
fail-closed validation on the operator-facing config surfaces:

1. write path (`config --set`, or equivalent)
2. validation path (`validate`)
3. diagnostic path (`doctor`, or equivalent operator health front door)

Runtime fallback is forward-compatibility behavior, not validation evidence.
If bad input only "works" because runtime silently ignores it and falls back to
defaults, the contract is still broken.

### Standing audit-scope rule

Silent-fallback audits must walk **every schema-published field with a runtime
consumer**, not just the fields adjacent to the triggering bug.

- If a field is included in schema and then normalized or consumed by runtime,
  it is in scope until proven otherwise.
- Named exclusions are allowed only when they state the exact field and the
  concrete reason it is exempt from the defect class.
- "We audited `run_loop.*` so the rest is probably fine" is not a valid close
  argument. That is the same blind spot BUG-51 exposed.

## Fourth False Closure Entry

### BUG-36 reopened as BUG-37 on `v2.135.0`

- **Shipped claim:** gate-semantic coverage rejection handled file-based gate failures.
- **Actual shipped behavior:** only the `Required file missing:` reason shape was covered. Semantic gate reasons with `<path> must define ...` bypassed the regex extractor and were silently accepted.
- **Beta evidence:** repeated accepted `dev` turns left `.planning/IMPLEMENTATION_NOTES.md` semantically unchanged while still proposing `qa`.
- **Turn 198 correction:** gate evaluation now returns structured `failing_files`; acceptance consumes that field directly; beta tests cover all three real file-emission shapes.

## Structural Discipline Rules Added After BUG-37

1. **Real emitter rule.** Any beta-tester scenario asserting on gate reasons, event payloads, or operator-facing error text must call the production emitter and assert its real output. Synthetic strings do not count as coverage.
2. **Claim-reality preflight rule.** A bug marked fixed is not releasable until its beta-tester scenario passes against the packaged CLI artifact that would actually ship, not just the source-tree test harness.
3. **Numbered-requirement coverage rule.** When a tester bug enumerates numbered fix requirements, every numbered requirement must map to at least one named regression test or an explicit rejected-as-out-of-scope note. “The main path is green” is not proof that fix #6 also landed.

## Acceptance Tests

- [x] `bug-31-human-merge-completion.test.js` proves single-invocation terminal acceptance.
- [x] `iterative-planning-repair.test.js` proves repeated PM repair turns on durable planning files accept cleanly.
- [x] governed-state regression proves stale same-role PM planning overlap is classified as forward revision.
- [x] `mixed-forward-revision-conflict-guidance.test.js` proves the real `reject-turn --reassign` retry path keeps destructive conflict files distinct from safe forward revisions.
- [x] `dispatch-path-lifecycle-matrix.test.js` proves `step --resume` retry rebinding, `restart` retained retry-bundle preservation, and manual `resume` -> `accept-turn` gate-semantic rejection.
- [x] `bug-37-gate-semantic-real-emissions.test.js` proves all real gate file-emission formats reject turns that did not touch the gated artifact.

## Closed Questions

- **Forward-revision visibility boundary (DEC-FORWARD-REVISION-VISIBILITY-001):** `forward_revision_accepted` stays decision-ledger-only. No status/report/dashboard surface. Rationale: forward revision is a success-path signal (same-role edits correctly classified as non-destructive). Surfacing it in operator-facing UX adds noise without actionable value. The two paths where it IS visible — retry guidance (dispatch bundle) and decision ledger (audit) — cover the only scenarios where an operator or auditor needs the information. Revisit only if operators report confusion about why same-role file edits don't appear as conflicts.
