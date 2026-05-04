# System Spec — M5: Protocol V8 — Parallel Turn Support

**Run:** `run_b7c5380413abfbfb`
**Baseline:** git:2942c3f5711458cb2e7570264f8f151276725bf3
**Package version:** `agentxchain@2.155.72`

## Purpose

Verify and document the complete implementation of parallel turn dispatch within a single phase. This is a verification-only spec — all code is already shipped.

---

## 1. Frozen Specification Documents

The parallel turn feature was designed across 8 frozen specs and 3 E2E specs:

| Spec | Purpose |
|------|---------|
| `PARALLEL_TURN_STATE_MODEL_SPEC.md` | Schema v1.1: `active_turns` map replacing `current_turn`, `turn_sequence` monotonic clock, `budget_reservations` |
| `PARALLEL_DISPATCH_SPEC.md` | Per-turn dispatch bundle isolation (`.agentxchain/dispatch/turns/<turn_id>/`) |
| `PARALLEL_CONFLICT_RECOVERY_SPEC.md` | File-level conflict detection + two recovery paths (reject_and_reassign, human_merge) |
| `PARALLEL_MERGE_ACCEPTANCE_SPEC.md` | Drain-time evaluation: queued phase transitions + run completions wait for all active turns |
| `PARALLEL_RUN_LOOP_SPEC.md` | Run-loop parallel dispatch via `executeParallelTurns()` |
| `PARALLEL_DELEGATION_SPEC.md` | Delegation interaction with concurrent turns |
| `PARALLEL_OBSERVED_ATTRIBUTION_SPEC.md` | Observer-level dirty-baseline filtering for rebased retries |
| `E2E_PARALLEL_LIFECYCLE_SPEC.md` | Full operator workflow: assign → dispatch → accept → conflict → recover |
| `E2E_PARALLEL_CLI_SPEC.md` | CLI subprocess composition proof for parallel operator path |
| `E2E_PARALLEL_APPROVAL_POLICY_SPEC.md` | Approval policy interaction with parallel acceptance |
| `PARALLEL_IMPLEMENTATION_PLAN.md` | 6-slice execution plan (all slices complete) |

---

## 2. Implementation Inventory

### Slice 0: Schema Migration (v1.0 → v1.1)

| Component | File | Evidence |
|-----------|------|----------|
| State normalization | `governed-state.js` `normalizeV1toV1_1()` | Migrates `current_turn` → `active_turns`, adds `turn_sequence`, `budget_reservations` |
| Schema validation | `schema.js` | Accepts both v1.0 and v1.1 shapes |
| Config helper | `normalized-config.js:1494` | `getMaxConcurrentTurns(config, phase)` — default 1, max 4 |

### Slice 1: Parallel Assignment

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Concurrency enforcement | `governed-state.js:3540-3555` | Sequential mode (max=1) blocks if any active turn; parallel mode blocks at capacity |
| One-turn-per-role guard | `governed-state.js:3548` | `DEC-PARALLEL-006`: same role cannot have 2 concurrent turns |
| Budget reservation | `governed-state.js:3571-3587` | `DEC-PARALLEL-011`: reserves estimated cost at assignment, blocks if budget insufficient |
| File scope advisory | `governed-state.js:3589-3602` | `DEC-PARALLEL-008`: warns on overlap, does not block |
| Turn metadata | `governed-state.js:3681-3744` | `assigned_sequence` (monotonic), `concurrent_with` (sibling snapshot) |

### Slice 2: Per-Turn Dispatch Bundle Isolation

| Component | File | Evidence |
|-----------|------|----------|
| Turn-scoped paths | `turn-paths.js` | `getDispatchTurnDir(turnId)`, `getTurnStagingResultPath(turnId)` |
| Bundle writer | `dispatch-bundle.js` | Creates `.agentxchain/dispatch/turns/<turn_id>/` with ASSIGNMENT, PROMPT, CONTEXT |
| Dispatch index | `dispatch-bundle.js` | Updates `.agentxchain/dispatch/index.json` atomically |
| Legacy fallback | `governed-state.js` | Falls back to `.agentxchain/staging/turn-result.json` for v1.0 migration |

### Slice 3: Targeted Acceptance + Conflict Detection

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Acceptance lock | `governed-state.js:1199-1239` | `.agentxchain/locks/accept-turn.lock`, PID-based, 30s stale timeout |
| Overlap classification | `governed-state.js:4984-5025` | Checks `files_changed` against turns accepted after assignment; computes `overlap_ratio` |
| Conflict transition | `governed-state.js:5019-5025` | Sets `status: "conflicted"`, records `conflict_state` with detection count |
| Conflict event | `governed-state.js:5056-5057` | Emits `turn_conflicted` run event |

### Slice 4: Conflict Recovery

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Path A: reject_and_reassign | `governed-state.js:6467-6482` | Rejects conflicted turn, clears `conflict_state`, re-assigns with fresh baseline |
| Path B: human_merge | `governed-state.js:4179-4201` | Accepts conflicted turn after operator resolves merge manually |
| Resolution suggestion | `governed-state.js:1480` | `overlap_ratio < 0.5` → `reject_and_reassign`; else → `human_merge` |

### Slice 5: CLI Surface + Report Rendering

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Status: multi-turn display | `status.js` | Renders all `active_turns` with conflict banners |
| Step: turn targeting | `step.js` | `--turn <id>` targets specific active turn |
| Accept: turn targeting | `accept-turn.js` | `--turn <id>` accepts specific turn |
| Report: concurrent_with | `report.js:459` | History entries include `concurrent_with` sibling list |
| Report: sibling attribution | `report.js:460-461, 1435, 1817, 2053, 2432, 2797` | Text/markdown/HTML all render sibling-attributed file notes |

### Run-Loop: Parallel Dispatch

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Parallel entry | `run-loop.js:200` | `executeParallelTurns()` called when `maxConcurrent > 1` |
| Slot filling | `run-loop.js:251-380` | Fills concurrency slots via `callbacks.selectRole()`, dispatches all via `Promise.allSettled()` |
| Drain-time evaluation | `governed-state.js:5330-5385` | Queued phase transitions + run completions evaluated only when `active_turns` is empty |

---

## 3. Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `e2e-parallel-lifecycle.test.js` | Full lifecycle: assign 2 → accept → conflict → reject_and_reassign → accept rebase |
| `e2e-parallel-cli.test.js` | CLI subprocess composition: parallel step commands |
| `run-loop-parallel.test.js` | Run-loop parallel dispatch with slot filling |
| `run-loop-conflict.test.js` | Conflict detection during parallel acceptance |
| `parallel-attribution-observability.test.js` | Observer-level dirty-baseline filtering |
| `parallel-dispatch-progress-e2e.test.js` | Per-turn dispatch progress tracking |
| `e2e-parallel-approval-policy-lifecycle.test.js` | Approval policy interaction with parallel turns |

**Total: 7 files, 29 tests, 0 failures** (verified 2026-05-03)

---

## 4. Key Protocol Invariants

1. **One active turn per role** (`DEC-PARALLEL-006`): Different roles run concurrently; same role queues
2. **Concurrency limit per phase**: Configured via `routing[phase].max_concurrent_turns`, default 1, max 4
3. **Acceptance is serialized**: File lock ensures one acceptance at a time (30s stale timeout)
4. **Conflict is second-writer-loses**: First-to-accept always succeeds; later acceptors check overlap
5. **Phase gates drain**: No phase transition while active turns exist; requests are queued
6. **Budget is reserved at assignment**: Blocks over-budget assignment; released at acceptance

---

## Dev Charter

### Scope

**Verification-only — no code changes.**

1. Confirm each line number reference in Section 2 is accurate
2. Run the 7 parallel test files and confirm 29 tests pass
3. Produce evidence document (`.planning/IMPLEMENTATION_NOTES.md`) with corrections if any citation is wrong
4. If all citations are accurate, document "all 11 cited references verified, 0 corrections"

### Out of Scope

- Any code modifications
- Any new tests
- Changes to frozen parallel specs
- M6+ features

### Verification

Dev must confirm:
1. All 7 parallel test files pass (29 tests, 0 failures)
2. Each cited `governed-state.js` line number matches the described functionality
3. Each cited `run-loop.js`, `report.js`, `dispatch-bundle.js` line number matches

## Interface

### Parallel Turn State Machine

```
                    ┌─────────────────────┐
                    │   assignGovernedTurn  │
                    │  (concurrency check) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   active_turns[id]   │
                    │   status: assigned   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   executeParallel    │
                    │   Turns() dispatch   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  acceptGovernedTurn  │
                    │   (lock acquired)    │
                    └──────┬────────┬─────┘
                           │        │
                    no overlap    overlap detected
                           │        │
                    ┌──────▼──┐  ┌──▼────────────┐
                    │ accepted │  │  conflicted    │
                    │ (history)│  │ (conflict_state│
                    └─────────┘  └───┬────────┬───┘
                                     │        │
                              Path A: reject   Path B: human_merge
                              & reassign       (operator resolves)
                                     │        │
                              ┌──────▼──┐  ┌──▼──────┐
                              │ re-assign│  │ accept  │
                              │ (fresh   │  │ (merged)│
                              │ baseline)│  └─────────┘
                              └─────────┘
```

### Concurrency Configuration

```json
{
  "routing": {
    "implementation": {
      "max_concurrent_turns": 2,
      "allowed_next_roles": ["dev_a", "dev_b"]
    }
  }
}
```

## Acceptance Tests

- [ ] All 5 ROADMAP.md M5 items checked off with evidence annotations
- [ ] Dev verifies all cited line numbers are accurate (0 corrections expected)
- [ ] 7 parallel test files pass: 29 tests, 0 failures
- [ ] Full test suite passes with 0 failures (deferred to QA)
