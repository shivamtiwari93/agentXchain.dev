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

Removal is preferred only after the schema gate, legacy migration, and production load path are all closed over the same conclusion. If any one of those proofs is missing, the branch stays under the weaker unreachable-branch discipline until the audit is complete. Deleting a branch before the compatibility or migration story is actually closed just moves uncertainty around.

### Removed dead branches (`DEC-DEAD-BRANCH-REMOVAL-001`)

| Removed branch | Schema citation | Migration citation | Invariant test |
| --- | --- | --- | --- |
| `cli/src/commands/resume.js` `state.status === 'paused' && activeCount > 0` (paused+retained re-dispatch failed/retrying) | `cli/src/lib/schema.js:184` rejects paused without `pending_phase_transition` / `pending_run_completion` | `cli/src/lib/governed-state.js:2191-2204` migrates legacy paused + `blocked_on:'human:...'` / `blocked_on:'escalation:...'` to `status: 'blocked'` on read | `cli/test/governed-state.test.js` "schema rejects fresh paused writes that lack pending approval" + "legacy paused + blocked_on:human:... is migrated to blocked" + "legacy paused + blocked_on:escalation:... is migrated to blocked" |
| `cli/src/commands/step.js` `state.status === 'paused' && activeCount > 0` (paused+failed/retrying re-dispatch) | same as above | same as above | same as above |

### Turn 26 audit note: branch-deletion candidates that are NOT dead code

The next-pass grep targeted three concrete candidate classes Claude suggested in Turn 25:

1. `current_turn` branches after normalization
2. `blocked_reason` null / absent branches on governed state
3. `schema_version !== '1.1'` branches outside the normalizer

Outcome:

- **`current_turn` is an intentional compatibility alias, not a dead branch trigger.**
  - `loadProjectState()` in `cli/src/lib/config.js` re-attaches `current_turn` as a non-enumerable getter after normalization on every governed load.
  - governed-state mutators also return the same alias (`attachLegacyCurrentTurnAlias()`), so downstream command/library references to `state.current_turn` remain live compatibility surface, not stale legacy code.
  - Locking proof: `cli/test/governed-state.test.js` now includes `loadProjectState re-attaches current_turn as a non-enumerable compatibility alias after migrating legacy state`.
  - Documentation rule: source comments/JSDoc must name `current_turn` as a runtime compatibility alias, not a persisted v1.1 field and not a "legacy format" fallback. Bare "must have current_turn" wording is banned (`DEC-CURRENT-TURN-COMPAT-ALIAS-DOC-001`).
- **`blocked_reason` branches were not eligible for deletion.**
  - Schema enforcement only guarantees `blocked_reason` is an object when `status === 'blocked'`.
  - The normalizer both infers missing `blocked_reason` for blocked states and clears it for non-blocked states; several runtime seams legitimately observe pre-reconciliation or transitional shapes before validation finishes.
  - Result: no delete-with-citations candidate from this class.
- **No downstream governed-state `schema_version !== '1.1'` branch exists outside normalization.**
  - The grep only found the normalizer itself plus non-governed config schema handling.
  - Result: no candidate.

Standing refinement: compatibility aliases and pre-validation transitional shapes are not dead-branch candidates unless the audit proves callers can no longer observe them through any supported load or return path.

## Standing staged-result proof rules

- `DEC-STAGED-RESULT-PROOF-SHARED-001`
  - The low-level "does this staged-result file count as execution proof?" check lives in exactly one helper: `cli/src/lib/staged-result-proof.js`'s `hasMeaningfulStagedResult()`. Adapter-side, watchdog-side, and any future recovery surface must call that helper instead of re-implementing placeholder filtering. This closes the BUG-51 false-proof class where `{}`, blank files, whitespace-only files, or `{}\n` could suppress ghost-turn recovery on one surface but not another.

- `DEC-MINIMUM-TURN-RESULT-SHAPE-001`
  - Adapter pre-stage validation is a separate contract from staged-file proof. Before any adapter writes JSON into the governed staging path, it must reject payloads that do not satisfy the minimum governed envelope: `schema_version` plus at least one identity field (`run_id` or `turn_id`) and one lifecycle field (`status`, `role`, or `runtime_id`). Rationale: once a payload is written into the staged-result path, it becomes durable execution evidence for BUG-51 surfaces. "Acceptance will reject it later" is not sufficient if the adapter itself was the layer that wrote obviously incomplete JSON into staging.

- `DEC-RUN-STAGED-READ-SHAPE-GUARD-001`
  - The `run.js` dispatch-callback staged-result read path (`cli/src/commands/run.js` after `JSON.parse(readFileSync(stagingFile))`) must also enforce `hasMinimumTurnResultShape()` before returning `{accept: true, turnResult}` to `runLoop`. Read-side validation is a peer defense to the adapter-side rule above, not a subordinate: it covers (a) operator tampering between adapter-stage and acceptance, (b) legacy or out-of-tree adapters that bypass the shared helper, (c) any internally-constructed `turnResult` path (e.g. `api-proxy-adapter.js:1077`) that still writes without pre-stage shape validation. On rejection the callback returns `{accept: false, reason: 'staged result missing minimum governed envelope (schema_version + identity + lifecycle fields)'}` so `runLoop` records a standard rejection. Locking proof: `AT-RUN-GUARD-016` in `cli/test/run-command.test.js`.

- `DEC-RUN-LOOP-MIN-SHAPE-SYMMETRY-001`
  - `cli/src/lib/run-loop.js`'s two `writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, ...))` sites (parallel post-processing branch and sequential `dispatchAndProcess`) must validate `hasMinimumTurnResultShape(dispatchResult.turnResult)` BEFORE persisting. Rationale: `runLoop` is the publicly-documented runner SDK boundary (`website-v2/docs/build-your-own-runner.mdx`); third-party `dispatch` callbacks have no obligation to call the in-repo shape helpers. In-repo adapters validate at write per `DEC-MINIMUM-TURN-RESULT-SHAPE-001`; `run.js` re-validates before returning per `DEC-RUN-STAGED-READ-SHAPE-GUARD-001`; `runLoop` is the final boundary that protects every other (third-party, in-tree future-runner, custom-callback) path. On shape failure, the loop converts `{accept: true}` into a standard rejection (`rejectTurn` + `turn_rejected` event + history entry) so the run state advances exactly the same way it would for any other dispatch rejection — no separate failure mode to operate. Locking proof: `AT-RUNLOOP-MIN-SHAPE-001` in `cli/test/run-loop.test.js` (asserts no staged file is written and a rejection event with the expected reason is emitted).

## BUG-51 Subprocess Lifecycle Matrix

The BUG-51 tester critique was not "the watchdog exists"; it was "the framework
still burns 11 minutes before admitting the turn never really started." The
coverage matrix therefore tracks the subprocess startup lifecycle explicitly
instead of hand-waving with one generic "ghost turn" label.

| Subprocess path | Required behavior | Current proof |
| --- | --- | --- |
| Spawn failure before attach | Runtime never spawns, no worker attach/output proof, turn retained as `failed_start` with `runtime_spawn_failed`, budget reservation released | `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` — `step marks a non-spawning runtime as failed_start/runtime_spawn_failed` |
| Spawn success + immediate exit + no output | Process exits before first byte or staged result, turn retained as `failed_start`, `turn_start_failed` emitted quickly | `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` — `step fails fast when the subprocess exits without output` |
| Spawn success + no stdout / no staged result | Process stays alive but silent, startup watchdog kills it within threshold, turn retained as `failed_start` with `stdout_attach_failed` | `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` — `step kills a silent subprocess within the startup watchdog window`; `run blocks fast on a silent local_cli ghost turn and retains failed_start recovery`; `schedule run-due --json surfaces ghost-turn recovery from the live blocked state`; `schedule daemon --json keeps ghost-turn recovery and category for continuous sessions` |
| Spawn success + slow stdout before threshold | First output arrives late but inside the startup window; watchdog must NOT misclassify a healthy slow start as ghosted | `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` — `step allows a slow-start subprocess when first output lands before the watchdog threshold` |
| Normal healthy spawn | Immediate output + staged result complete normally; no startup-failure events emitted | `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` — `step accepts a healthy local_cli subprocess with immediate output and staged result` |

### Standing BUG-51 lifecycle rule

Any future startup-path change that can affect subprocess liveness MUST prove
all five lifecycle rows above again. "Spawned once in manual testing" is not
startup coverage. A startup fix is incomplete until it names which row it
changed and which test locks that row.

### Standing BUG-51 claim-reality rule (`DEC-BUG51-CLAIM-REALITY-PACKAGED-001`)

Source-tree BUG-51 tests are necessary but not sufficient. The release lane
must also prove the fast-startup watchdog on the packed tarball before
`v2.146.0+` can ship. `cli/test/claim-reality-preflight.test.js` owns three
packaged-proof rows that run under `release-preflight.sh --publish-gate`:

1. `BUG-51 fast-startup watchdog proof exists and its production imports are
   packed` — fails the release if `bug-51-fast-startup-watchdog.test.js`, its
   production imports (`stale-turn-watchdog.js`, `dispatch-progress.js`,
   `run-events.js`, `run-loop.js`), or the tester-required content strings are
   missing from the tarball.
2. `BUG-51 packaged tarball ships the fast-startup watchdog implementation` —
   reads the packed `stale-turn-watchdog.js`, `run-events.js`, and `run-loop.js`
   directly and fails the release if `detectGhostTurns`, `failTurnStartup`,
   the `startup_watchdog_ms` honor, the `failed_start` transition, the budget
   release, the `reissue-turn --reason ghost` recommendation, the typed startup
   events (`turn_start_failed`, `runtime_spawn_failed`, `stdout_attach_failed`)
   in `VALID_RUN_EVENTS`, or the `hasMinimumTurnResultShape` guard drift.
3. `BUG-51 packaged CLI detects a ghost turn and transitions to failed_start
   within the startup window` — loads the packed watchdog by `pathToFileURL`,
   seeds a dispatched turn 60s in the past with no first-output proof, and
   asserts the packed `reconcileStaleTurns` returns the ghost, transitions
   status to `failed_start` with `runtime_spawn_failed`, releases the budget
   reservation, emits `turn_start_failed`/`runtime_spawn_failed`/`run_blocked`,
   and marks the run blocked — exactly the recovery-surface behavior the
   tester's 11-minute ghost would have needed.

This row of coverage exists because "works from source, broken when built"
(discipline rule #9) is the BUG-51 class of failure mode at the release
boundary: the fast-startup watchdog is worthless if the shipped binary does
not carry it. Any future change to the watchdog API (new event type, new
state transition, new config key, new recommendation string) must update row
2 or row 3 so the release lane re-locks the packaged contract.

### Standing BUG-47..50 claim-reality rule (`DEC-BUG4750-CLAIM-REALITY-001`)

The `v2.145.x` tester-gated state-consistency cluster also needs tarball proof
at the release boundary, not just source-tree regressions. `cli/test/claim-reality-preflight.test.js`
now locks four shipped-package contracts:

1. **BUG-47**: two rows. (a) the packed `stale-turn-watchdog.js` must still
   export `detectStaleTurns` and `detectAndEmitStaleTurns`, honor
   `run_loop.stale_turn_threshold_ms`, retain stale turns as `stalled`, and
   surface `reissue-turn --reason stale`. (b) packaged behavioral smoke:
   `reconcileStaleTurns` on the packed binary, given a turn with first-output
   proof and `started_at` past the configured stale threshold, transitions to
   `stalled` (NOT `failed_start`), emits `turn_stalled` + `run_blocked`
   (category `stale_turn`, never `ghost_turn`, never `turn_start_failed`),
   releases the budget reservation, and advertises
   `reissue-turn --reason stale` (NOT `--reason ghost`). This locks
   `DEC-BUG51-FIRST-OUTPUT-PROOF-001` at the packaged-binary boundary —
   without it, a refactor that collapsed the BUG-47/BUG-51 path-split would
   ship undetected.
2. **BUG-48**: the packed `intake.js` must still clear
   `.agentxchain/intake/injected-priority.json` when
   `validatePreemptionMarker()` sees a superseded intent. No extra path-split
   row is required here because the packaged seam is singular: the stale
   marker either gets cleared for the superseded intent or it does not.
3. **BUG-49**: the packed `checkpointAcceptedTurn()` path must still advance
   `accepted_integration_ref` to `git:<checkpoint_sha>` after checkpoint, not
   leave it pinned to the pre-checkpoint ref. No sibling recovery family
   exists here like BUG-47/51; the packaged terminal mutation is the contract.
4. **BUG-50**: the packed `recordRunHistory()` path must still isolate
   `total_turns` and `phases_completed` to the child run even when
   `.agentxchain/history.jsonl` contains parent-run turns. Again, this is a
   single packaged seam rather than a path-split bug class, so one behavioral
   row is the correct release-boundary proof.

This row family exists because BUG-47..50 are exactly the kind of
state-reconciliation fixes that can pass source tests while a published tarball
drops the repair seam or regresses the final packaged behavior.

## BUG-52 Gate Resolution × Phase-Advance Matrix

BUG-52 exposed a separate blind spot: we were proving gate truth at
`accept-turn`, but not proving what happened when that same gate became
satisfied later through recovery or redispatch surfaces. The durable unit is:

- gate family
- post-acceptance exit path
- whether phase advancement happens before another same-phase role is assigned

| Gate family | Exit path after artifacts become truthful | Required behavior | Current proof |
| --- | --- | --- | --- |
| `planning_signoff` -> `implementation` | `unblock <hesc_*>` after accepted + checkpointed PM turn | mark gate `passed`, clear `last_gate_failure`, advance phase before role selection, dispatch `dev` instead of another `pm` | `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` |
| `qa_ship_verdict` -> `launch` | `unblock <hesc_*>` after accepted + checkpointed QA turn | mark gate `passed`, clear `last_gate_failure`, advance phase before role selection, dispatch `launch` instead of another `qa` | `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` |
| Any previously failed phase-transition gate | `resume` / `step --resume` before dispatch | run `reconcilePhaseAdvanceBeforeDispatch()`, emit `phase_entered` with `trigger: "reconciled_before_dispatch"`, dispatch the next-phase role instead of redispatching the same-phase role | `cli/test/claim-reality-preflight.test.js` — `BUG-52 pre-dispatch reconciler is packed (governed-state + resume + step wiring)` and `BUG-52 packaged reconciler advances phase before dispatch when a failed phase-transition gate is now satisfied` |
| Any still-failing phase-transition gate | `resume` / `step --resume` pre-dispatch reconcile | do **not** fabricate a phase advance; stay in the current phase until the gate truly passes | `cli/test/claim-reality-preflight.test.js` — `BUG-52 packaged reconciler is a no-op when the gate is still failing (does not fabricate a phase advance)` |

### Standing BUG-52 rule

Any future gate-resolution or redispatch change must name:

1. which gate family it affects (`planning_signoff`, `implementation_complete`, `qa_ship_verdict`, or a custom gate)
2. which post-acceptance path proves it (`unblock`, `resume`, `step --resume`, `checkpoint-turn` follow-up reconcile, or equivalent)

"The gate passes on accept-turn" is not sufficient coverage. BUG-52 happened
because `unblock` and pre-dispatch reconciliation were not owned as separate
proof rows.

## BUG-53 Session Continuation × Completion Mode Matrix

BUG-53 exposed the matching blind spot one layer up: we were proving that a
run completed, but not what the surrounding continuous session did next. The
durable unit is:

- completion mode
- session owner
- post-completion continuation behavior

| Continuation mode | Completion boundary | Required behavior | Current proof |
| --- | --- | --- | --- |
| CLI-owned `run --continuous` with remaining vision candidates | clean run completion before `maxRuns` | keep session `running`, derive the next vision objective, seed the next run, emit `session_continuation` | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` — `chains 3 vision goals through maxRuns=3 and exits cleanly without passing through paused` |
| CLI-owned `run --continuous` with no remaining vision candidates | clean run completion after the final objective | terminate cleanly as `idle_exit`/clean completion, never `paused` | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` — `exits with idle_exit (not paused) when all vision goals are addressed after one run` |
| Schedule-owned continuous session (`schedule daemon`) | clean completion on later daemon polls | keep the same session identity across polls, increment `runs_completed`, continue until a clean terminal limit instead of inventing `paused` after completion | `cli/test/schedule-daemon-health-e2e.test.js` (`AT-SDH-009`, `AT-SDH-010`) and `cli/test/schedule-continuous.test.js` (`idle_exit` row) |
| Packaged tarball release boundary | same auto-chain boundary on the shipped artifact | packed CLI must ship `continuous-run.js` + `vision-reader.js` + `run-events.js`, auto-chain through multiple runs, and emit `session_continuation` with `{previous_run_id,next_run_id,next_objective}` | `cli/test/claim-reality-preflight.test.js` — `BUG-53 continuous auto-chain is packed (continuous-run + session_continuation event)` and `BUG-53 packaged continuous loop auto-chains through 2 runs and emits session_continuation` |

### Standing BUG-53 rule

Any future continuous-loop change must prove:

1. what happens after a clean run completion
2. whether `paused` appears anywhere on that path
3. which owner mode is covered (CLI-owned vs schedule-owned)
4. whether no-candidate termination ends cleanly (`idle_exit` / `completed`) instead of silently stalling

"`runs_completed` incremented" is not continuation proof. BUG-53 lived in the
gap between "the run finished" and "the session truthfully kept going."

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
