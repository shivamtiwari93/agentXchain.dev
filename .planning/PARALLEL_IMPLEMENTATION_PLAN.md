# Parallel Turn Implementation Plan

> Execution-ready plan for adding parallel-turn support to the AgentXchain CLI.
> Derived from the frozen specs: PARALLEL_TURN_STATE_MODEL_SPEC, PARALLEL_DISPATCH_SPEC, PARALLEL_CONFLICT_RECOVERY_SPEC, PARALLEL_MERGE_ACCEPTANCE_SPEC.

---

## Guiding Principles

1. **Every slice must leave the CLI usable.** No half-broken intermediate states. Each slice ships with its own tests and is backward-compatible with `max_concurrent_turns = 1`.
2. **Migration before mutation.** The v1.0 → v1.1 schema migration must work before any new concurrency code reads or writes the new fields.
3. **State layer first, then dispatch, then acceptance, then conflict recovery, then CLI surface.** Each layer tests in isolation before the next layer depends on it.

---

## Current Snapshot

- Core parallel-turn implementation is complete through Slice 5 plus the observer-level dirty-baseline verification slice.
- Current repository verification: `cd cli && npm test` passes with **495 tests, 0 failures, 109 suites**.
- The remaining gap is not core protocol behavior. It is **CLI-subprocess composition proof** for the parallel operator path. That gap is now frozen in `.planning/E2E_PARALLEL_CLI_SPEC.md`.

---

## Slice 0 — Schema Migration & State Shape ✅ IMPLEMENTED

**Status:** Complete. The governed state layer now persists the v1.1 shape (`active_turns`, `turn_sequence`, queued drain-time requests, and `budget_reservations`) while transparently migrating legacy v1.0 `current_turn` state on read.

**Goal:** Replace `current_turn` with `active_turns` in the data layer. All existing behavior continues to work identically because `max_concurrent_turns` defaults to 1.

### Files to change

| File | Change |
|------|--------|
| `cli/src/lib/governed-state.js` | Add `normalizeV1toV1_1()` to `normalizeGovernedStateShape()`. Migrate `current_turn` → `active_turns`, add `turn_sequence`, add `budget_reservations`, add `queued_phase_transition` / `queued_run_completion`. All existing functions (`assignGovernedTurn`, `acceptGovernedTurn`, `rejectGovernedTurn`, etc.) continue to use a single-turn code path but read/write through the `active_turns` map. |
| `cli/src/lib/schema.js` | Update `validateGovernedStateSchema()` to accept both v1.0 (`current_turn`) and v1.1 (`active_turns`) shapes. v1.0 triggers migration on read. v1.1 validates `active_turns` as a Record, `turn_sequence` as non-negative integer, `ActiveTurn` schema for each entry. |
| `cli/src/lib/blocked-state.js` | Replace all `state.current_turn` references with `getActiveTurn(state)` helper that returns the single active turn or null. |
| `cli/src/commands/init.js` | Scaffold `active_turns: {}` and `turn_sequence: 0` instead of `current_turn: null` for new projects. Set `schema_version: "1.1"`. |
| `cli/src/commands/status.js` | Replace `state.current_turn` rendering with `active_turns` iteration. For `max_concurrent_turns = 1`, output is identical to v1. |
| `cli/src/commands/step.js` | Replace `state.current_turn` reads with `getActiveTurn(state)` helper. |
| `cli/src/commands/accept-turn.js` | Replace `state.current_turn` reads with `getActiveTurn(state)` helper. |
| `cli/src/commands/reject-turn.js` | Replace `state.current_turn` reads with `getActiveTurn(state)` helper. |
| `cli/src/commands/resume.js` | Replace `state.current_turn` reads with helper. |
| `cli/src/lib/dispatch-bundle.js` | Replace `state.current_turn` reads with helper. |
| `cli/src/lib/turn-result-validator.js` | Replace `state.current_turn` reads with helper for assignment identity checks. |
| `cli/src/lib/config.js` | Add `max_concurrent_turns` to phase routing schema with default 1, min 1, max 4. |
| `cli/src/lib/normalized-config.js` | Expose `getMaxConcurrentTurns(config, phase)` helper. |

### Tests to update

| Test file | Change |
|-----------|--------|
| `cli/test/governed-state.test.js` | Add migration tests (AT-P-23 through AT-P-27). Update all existing tests to work with `active_turns` shape. |
| `cli/test/schema.test.js` | Add v1.1 schema validation tests (AT-P-01, AT-P-02, AT-P-03). |
| `cli/test/step-command.test.js` | Update fixtures from `current_turn` to `active_turns`. Verify behavioral identity. |
| `cli/test/governed-cli.test.js` | Update fixtures. |
| `cli/test/operator-recovery.test.js` | Update fixtures. |
| `cli/test/run-completion.test.js` | Update fixtures. |
| `cli/test/gate-evaluator.test.js` | Update fixtures. |
| `cli/test/dispatch-bundle.test.js` | Update fixtures. |
| `cli/test/turn-result-validator.test.js` | Update fixtures. |
| `cli/test/e2e-governed-lifecycle.test.js` | End-to-end: verify full assign → accept → phase advance still works with new shape. |
| `cli/test/e2e-governed-reject-retry.test.js` | End-to-end: verify reject → retry → accept still works. |

### Acceptance criteria (all met)

- ✅ Legacy `current_turn` state migrates to `active_turns` on read.
- ✅ New projects scaffold the v1.1 governed state shape.
- ✅ Schema validation accepts the v1.1 shape and rejects mixed persisted `current_turn` + `schema_version: "1.1"` state.
- ✅ Single-turn behavior remains unchanged when `max_concurrent_turns = 1`.
- ✅ Repository-wide verification remained green through the migration slice.

### Verification

- `node --test cli/test/schema.test.js cli/test/governed-state.test.js cli/test/e2e-governed-lifecycle.test.js cli/test/e2e-governed-reject-retry.test.js`
- Repository-wide verification subsequently remained green through the parallel slices and currently stands at **495 passing, 0 failing**

---

## Slice 1 — Parallel Assignment ✅ IMPLEMENTED (Turn 19)

**Goal:** `assignGovernedTurn()` supports N concurrent turns up to `max_concurrent_turns`.

**Status:** Complete. 457 tests passing, 0 failures (11 new tests added).

### Files changed

| File | Change |
|------|--------|
| `cli/src/lib/governed-state.js` | `assignGovernedTurn()`: concurrency limit via `getMaxConcurrentTurns()`, role uniqueness (DEC-PARALLEL-006), budget reservation in `budget_reservations[turn_id]`, `concurrent_with` snapshot, advisory `declared_file_scope` overlap warning. Backward-compatible error message preserved for `max_concurrent_turns = 1`. Added `estimateTurnBudget()` helper. Imported `getMaxConcurrentTurns`. |
| `cli/src/commands/step.js` | Concurrency-aware active-turn check: when under capacity, falls through to assignment instead of blocking. Imported `getActiveTurnCount` and `getMaxConcurrentTurns`. |

### Tests added

| Test file | Tests |
|-----------|-------|
| `cli/test/governed-state.test.js` | 11 new tests: concurrent assignment success, capacity limit, duplicate-role rejection, sequence increment, concurrent_with recording, blocked-run rejection, budget reservation creation, budget exhaustion rejection, stacked reservation, stacked reservation exhaustion, backward-compatible error message. |

### Acceptance criteria (all met)

- ✅ Two turns can be assigned to different roles concurrently
- ✅ Third assignment blocked by `max_concurrent_turns = 2`
- ✅ Same-role assignment blocked (DEC-PARALLEL-006)
- ✅ Budget reservation created per turn (DEC-PARALLEL-011)
- ✅ Blocked run rejects new assignment (DEC-PARALLEL-007)
- ✅ Backward-compatible error messages for `max_concurrent_turns = 1`
- ✅ Advisory overlap warning infrastructure for `declared_file_scope`
- ✅ `concurrent_with` sibling IDs recorded on each new turn
- ✅ Full suite: 457 tests passing, 0 failures

---

## Slice 2 — Per-Turn Dispatch & Staging Isolation ✅ IMPLEMENTED (Turn 20)

**Goal:** Each active turn gets its own dispatch bundle and staging directory.

**Status:** Complete. Turn-scoped dispatch/staging paths are now live across the bundle writer, manual adapter, local CLI adapter, API proxy adapter, and the affected command/test surfaces.

### Files changed

| File | Change |
|------|--------|
| `cli/src/lib/turn-paths.js` | New turn-scoped path helpers for dispatch bundle directories, staging result files, provider artifacts, retry traces, and dispatch index paths. |
| `cli/src/lib/dispatch-bundle.js` | Replaced singleton bundle output with `.agentxchain/dispatch/turns/<turn_id>/...`. Added `dispatch/index.json` writing, turn-targeted bundle selection, sibling metadata, and turn-scoped staging result paths in `ASSIGNMENT.json`. |
| `cli/src/lib/adapters/manual-adapter.js` | Manual instructions, staged-result polling, and staged-result reading are now turn-scoped via `turnId`. |
| `cli/src/lib/adapters/local-cli-adapter.js` | Reads `PROMPT.md` / `CONTEXT.md` from the targeted turn bundle, writes staged results under `.agentxchain/staging/<turn_id>/`, and saves logs per turn. |
| `cli/src/lib/adapters/api-proxy-adapter.js` | Reads and writes all dispatch/staging audit artifacts per turn, including `provider-response.json`, `api-error.json`, retry trace, token-budget report, and effective-context output. |
| `cli/src/commands/resume.js` | Status text now reports turn-scoped bundle/result locations. |
| `cli/src/commands/step.js` | Updated dispatch-log persistence to the turn-scoped log location. |

### Tests updated

| Test file | Change |
|-----------|--------|
| `cli/test/dispatch-bundle.test.js` | Updated bundle path assertions to `dispatch/turns/<turn_id>/...` and turn-scoped staging paths. |
| `cli/test/local-cli-adapter.test.js` | Updated subprocess fixtures and log assertions for turn-scoped staging/log paths. |
| `cli/test/api-proxy-adapter.test.js` | Updated all audit-artifact assertions for per-turn staging and dispatch paths. |
| `cli/test/context-section-parser.test.js` | Updated orchestrator-generated context bundle path expectation. |
| `cli/test/step-command.test.js` | Updated manual adapter unit tests and dispatch-bundle path assertions for the turn-scoped layout. |

### Acceptance criteria (met)

- ✅ Turn-scoped bundle path: `.agentxchain/dispatch/turns/<turn_id>/`
- ✅ Turn-scoped staging path: `.agentxchain/staging/<turn_id>/turn-result.json`
- ✅ `dispatch/index.json` rebuilds from `state.active_turns`
- ✅ Single-turn flows still pass unchanged at the command level
- ✅ Manual/local_cli/api_proxy all read and write only their targeted turn artifacts

### Verification

- `node --test cli/test/step-command.test.js cli/test/dispatch-bundle.test.js cli/test/local-cli-adapter.test.js cli/test/api-proxy-adapter.test.js cli/test/context-section-parser.test.js`
- Result: 125 passing, 0 failing

---

## Slice 3 — Parallel Acceptance & Conflict Detection ✅ IMPLEMENTED (Turns 2 + 3)

**Goal:** `acceptGovernedTurn()` targets a specific turn, detects file conflicts, persists conflict state. Acceptance is crash-recoverable and serialized.

**Status:** Complete. Targeted acceptance, conflict detection, drain-time evaluation (Turn 2 / GPT 5.4), plus acceptance lock, transaction journal, crash recovery, and operational path exclusion (Turn 3 / Claude Opus 4.6). 471 tests passing, 0 failures.

### Files changed

| File | Change |
|------|--------|
| `cli/src/lib/governed-state.js` | `acceptGovernedTurn()`: acceptance lock acquire/release around the commit path, transaction journal prepare/commit, crash recovery replay on entry, re-read state under lock. New exported functions: `acquireAcceptanceLock()`, `releaseAcceptanceLock()`, `replayPreparedJournals()`. Private: `writeAcceptanceJournal()`, `commitAcceptanceJournal()`, `cleanupTurnArtifacts()`, `isProcessRunning()`. Fixed gate evaluation regression (always call `evaluatePhaseExit` when run drains). |
| `cli/src/lib/repo-observer.js` | Added `.agentxchain/locks/` and `.agentxchain/transactions/` to `OPERATIONAL_PATH_PREFIXES` so lock/journal files are not attributed to agent actors. |
| `cli/src/commands/accept-turn.js` | Added `lock_timeout` error rendering with recovery guidance. |

### Tests added / fixed

| Test file | Tests |
|-----------|-------|
| `cli/test/governed-state.test.js` | 5 new lock tests: acquire/release, block on held lock, stale PID reclamation, timeout reclamation, corrupt lock reclamation. 5 new journal/crash tests: journal cleanup on success, full replay from prepared journal, cleanup-only when state already committed, lock release on validation failure, healthy sibling acceptance while run is blocked. |
| `cli/test/gate-evaluator.test.js` | Fixed pre-existing regression (gate integration test now passes — `gateResult` is always populated when run drains). |

### Acceptance criteria (all met)

- ✅ `accept-turn --turn <id>` accepts exactly one turn from multiple actives.
- ✅ File conflict detected when observed files overlap with intervening history.
- ✅ Conflict persists `status: "conflicted"` and `conflict_state` on the turn.
- ✅ Successful acceptance writes history with `assigned_sequence` and `accepted_sequence`.
- ✅ Drain-time evaluation runs queued completion before queued phase transition.
- ✅ Crash recovery replays from transaction journal.
- ✅ Acceptance lock serializes concurrent acceptance attempts.
- ✅ Stale lock reclamation after 30 seconds or dead owner PID.
- ✅ Lock/journal paths excluded from actor-attributed observation.
- ✅ Lock released on all exit paths (success, conflict, validation failure).
- ✅ Full suite: 471 tests passing, 0 failures, 101 suites.

---

## Slice 4 — Conflict Recovery (Path A & Path B) ✅ IMPLEMENTED (Turn 6)

**Goal:** Operator can resolve conflicts via reject-and-reassign or human-merge.

**Status:** Complete. Conflict recovery is now live across reject/reassign, human-merge re-acceptance, prompt/context injection, conflict-loop blocking, and CLI guardrails. Full suite remains green at 485 tests, 0 failures.

### Files changed

| File | Change |
|------|--------|
| `cli/src/lib/governed-state.js` | Added `ConflictContext` construction, `conflict_detected` / `conflict_rejected` / `conflict_resolution_selected` ledger entries, `human_merge` acceptance mode, conflict-loop guard (`detection_count >= 3`), and retry-budget integration for conflict rejections. |
| `cli/src/lib/dispatch-bundle.js` | Injects `## File Conflict - Retry Required` into `PROMPT.md` and persists `conflict_context` in `ASSIGNMENT.json` for redispatch. |
| `cli/src/commands/reject-turn.js` | Added `--reassign` validation and conflict-specific retry messaging. |
| `cli/src/commands/accept-turn.js` | Added `--resolution human_merge` path and conflict-banner rendering. |
| `cli/src/commands/status.js` | Renders persisted conflict state, overlap ratio, detection count, and both operator recovery commands. |
| `cli/src/commands/step.js` | Surfaces conflict recovery guidance instead of resuming a conflicted turn blindly. |

### Tests added / verified

| Test | Spec reference |
|------|---------------|
| `cli/test/governed-state.test.js` | Conflict detection, conflict ledger entries, `reject_and_reassign`, `human_merge`, and `conflict_loop` escalation coverage (`AT-CR-01` through `AT-CR-25a`). |
| `cli/test/governed-cli.test.js` | CLI guardrails for `reject-turn --reassign` and `accept-turn --resolution human_merge`. |
| `cli/test/dispatch-bundle.test.js` | Conflict-context injection into `ASSIGNMENT.json` and `PROMPT.md`. |
| `cli/test/step-command.test.js` | Conflict recovery operator guidance and conflicted-turn surface behavior. |

### Acceptance criteria (all met)

- ✅ Path A: reject + reassign with conflict context in prompt, attempt incremented.
- ✅ Path B: human merge, same turn_id/attempt, re-acceptance with fresh conflict check.
- ✅ Third conflict detection escalates to `blocked`.
- ✅ `--reassign` only works on conflicted turns.
- ✅ Ledger records distinguish `conflict_detected`, `conflict_rejected`, `conflict_resolution_selected`.
- ✅ Conflict rejections consume the normal retry budget; `human_merge` remains the operator escape hatch.

### Verification

- `cd cli && npm test`
- Result: 485 tests passed, 0 failed, 106 suites

---

## Slice 5 — CLI Surface & Status Rendering ✅ IMPLEMENTED (Turn 5)

**Goal:** All CLI commands render parallel state correctly.

**Status:** Complete. Multi-turn status rendering, `--turn` targeting for `step --resume` and `resume`, conflict recovery guidance, queued request display, and budget reservation display. 485 tests passing, 0 failures.

### Files changed

| File | Change |
|------|--------|
| `cli/src/commands/status.js` | Multi-turn rendering with per-turn conflict banners (conflicting files, overlap ratio, detection count, suggested resolution, both recovery commands). Queued phase transition and run completion display. Per-turn budget reservation display. Single-turn rendering now also shows conflict state when applicable. |
| `cli/src/commands/step.js` | `--turn <id>` targeting for `--resume`. Rejects ambiguous resume when multiple turns active and no `--turn`. Conflicted turns get recovery guidance instead of resume. Blocked state targeting with `--turn`. Turn-targeted acceptance. Multi-turn capacity display. |
| `cli/src/commands/resume.js` | `--turn <id>` targeting for retained-turn re-dispatch. Rejects ambiguous resume when multiple retained turns. Multi-turn active state display. |
| `cli/bin/agentxchain.js` | Added `--turn <id>` option to both `step` and `resume` commands. |

### Tests added

| Test file | Tests |
|-----------|-------|
| `cli/test/step-command.test.js` | 8 new tests: multi-turn listing, conflicted turn rendering with conflict_state, targeted turn resolution, ambiguous resume rejection, conflict recovery path identification, healthy sibling preservation, queued phase transition observability, budget reservation per-turn observability. |

### Acceptance criteria (all met)

- ✅ `status` shows all active turns with role, status, and attempt.
- ✅ Conflict banner renders with file count, overlap ratio, detection count, and both resolution commands.
- ✅ `step --resume` requires `--turn` when multiple turns are active.
- ✅ `step --resume --turn <id>` on a conflicted turn prints recovery guidance instead of resuming.
- ✅ `resume` rejects ambiguous retained-turn re-dispatch when multiple turns exist.
- ✅ `max_concurrent_turns = 1` CLI behavior is identical to v1.
- ✅ Queued phase transitions and run completions are displayed.
- ✅ Budget reservations are displayed per turn.
- ✅ Full suite: 485 tests passing, 0 failures, 106 suites.

### Verification

- `node --test cli/test/step-command.test.js` — 27 tests passed, 0 failed
- `cd cli && npm test` — 485 tests passed, 0 failed, 106 suites

---

## Supplemental — Observer-Level Unit Coverage for Rebased Retry Baselines ✅ IMPLEMENTED (Turn 9)

**Goal:** Prove that `DEC-OBSERVE-001` (dirty-snapshot baseline filtering) works correctly at the unit level, independent of the E2E parallel lifecycle test.

### Files changed

| File | Change |
|------|--------|
| `cli/test/repo-observer.test.js` | Added 9 tests across 2 new describe blocks: `captureBaseline — dirty workspace snapshot` (3 tests) and `observeChanges — dirty-snapshot baseline filtering` (6 tests). |

### What the tests cover

- ✅ Baseline on dirty workspace records `dirty_snapshot` with sha256 markers for actor-owned files
- ✅ Operational paths are excluded from `dirty_snapshot`
- ✅ Clean workspace produces empty `dirty_snapshot`
- ✅ Same-HEAD observation excludes unchanged dirty baseline files
- ✅ Same-HEAD observation re-includes a baseline-dirty file if its content changes after capture
- ✅ Newly created files are observed alongside unchanged dirty baseline files
- ✅ Deleted file markers (`"deleted"`) are correctly recorded and filtered
- ✅ Resurrected files (previously deleted in baseline) are re-observed
- ✅ No filtering when baseline has no `dirty_snapshot`

### Verification

- `node --test cli/test/repo-observer.test.js` — 52 tests passed, 0 failed
- `cd cli && npm test` — 495 tests passed, 0 failed, 109 suites

---

## Implementation Order (Completed Core Buildout)

```
Slice 0 (migration)
  ↓
Slice 1 (assignment)
  ↓
Slice 2 (dispatch isolation)
  ↓
Slice 3 (acceptance + conflict detection)
  ↓
Slice 4 (conflict recovery)
  ↓
Slice 5 (CLI surface)
```

Each slice is independently testable. After each slice, `npm test` must pass with all existing + new tests.

---

## CLI-Subprocess Parallel Verification ✅ IMPLEMENTED (Turn 11)

**Goal:** Prove that the shipped CLI surface correctly composes the already-frozen parallel contracts when driven as real subprocesses.

**Status:** Complete. 9 new subprocess-level tests covering the full Path A parallel operator workflow.

### Files added

| File | Description |
|------|-------------|
| `cli/test/e2e-parallel-cli.test.js` | 9 tests: multi-turn `status`/`status --json`, ambiguous `step --resume` rejection, targeted `accept-turn`, conflict persistence via CLI, conflict banner rendering, `reject-turn --reassign`, redispatch bundle conflict context, and successful rebased retry acceptance. |

### Acceptance criteria (all met)

- ✅ `status --json` exposes both active turns in a `max_concurrent_turns = 2` run
- ✅ Human-readable `status` lists both active turns before any acceptance
- ✅ `step --resume` without `--turn` fails when multiple turns are active
- ✅ `accept-turn --turn <id>` accepts only the targeted turn and preserves the sibling
- ✅ Accepted-turn cleanup removes only the targeted turn's staging and dispatch directories
- ✅ A CLI acceptance of a conflicting sibling persists `status: "conflicted"` and `conflict_state`
- ✅ Conflict detection appends `conflict_detected` to `decision-ledger.jsonl`
- ✅ Human-readable `status` renders the conflict banner with the suggested resolution
- ✅ `reject-turn --turn <id> --reassign` preserves `turn_id` and increments `attempt`
- ✅ Reassign refreshes the retained turn baseline and `assigned_sequence`
- ✅ Redispatched `ASSIGNMENT.json` and `PROMPT.md` carry structured conflict context
- ✅ A rebased retry accepted through `accept-turn --turn <id>` drains the run cleanly and yields exactly two accepted history entries

### Verification

- `node --test cli/test/e2e-parallel-cli.test.js` — 9 tests passed, 0 failed
- `cd cli && npm test` — **504 tests passed, 0 failed, 110 suites**

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Slice 0 is large (touches every `current_turn` consumer) | Introduce `getActiveTurn(state)` / `getActiveTurnOrThrow(state)` helpers early; mechanical find-and-replace for most call sites. |
| Acceptance lock contention under rapid CLI invocation | File lock with 5-second timeout and stale-owner reclamation is sufficient for CLI. Daemon lock is deferred. |
| Crash recovery journal complexity | Journal is a simple JSON file, not a WAL. Only one journal can exist per run at a time (lock serializes). Recovery is idempotent replay. |
| Adapter path migration breaks existing dispatch bundles mid-run | Migration only runs on `readGovernedState()`. Existing bundles at `dispatch/current/` are checked as fallback during the transition window. |

---

## What This Plan Does NOT Cover

- Parallel routing intelligence (auto-serializing conflicting roles)
- Three-way merge automation
- External conflict notification
- `max_concurrent_turns > 4`
- Daemonized orchestrator / OS-native locks

These are all explicitly deferred per the frozen specs.
