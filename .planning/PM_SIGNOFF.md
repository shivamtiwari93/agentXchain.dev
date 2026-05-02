# PM Signoff — M3: Multi-Model Turn Handoff Quality (Item #3: Model Identity Metadata in Turn Checkpoints)

Approved: YES

**Run:** `run_37fb509c4b6ed593`
**Phase:** planning
**Turn:** `turn_802ffcbad4e9fe67`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators and dashboards consuming checkpoint metadata — state.json, run events, and git log — to track which model produced each governed turn's checkpointed work.

### Core Pain Point

The checkpoint commit body already records `Runtime: local-opus-4.6` (turn-checkpoint.js:211), but the **programmatic metadata** produced by the checkpoint flow does not. Three downstream surfaces that code reads — not humans — are missing `runtime_id`:

| Surface | Location | runtime_id available? | runtime_id persisted? |
|---------|----------|----------------------|----------------------|
| Checkpoint commit body | turn-checkpoint.js:211 | YES (from history entry) | YES |
| `state.json last_completed_turn` | turn-checkpoint.js:469-476 | YES (from entry) | **NO** |
| `turn_checkpointed` event payload | turn-checkpoint.js:479-486 | YES (from entry) | **NO** |
| Checkpoint commit subject | turn-checkpoint.js:205 | YES (from entry) | **NO** |

**Impact:**

1. **`state.json last_completed_turn` gap:** Consumers reading state.json (session-checkpoint.js:95, operator-commit-reconcile.js:71, dispatch-bundle.js:785) to learn about the last completed turn get `turn_id`, `role`, `phase`, `checkpoint_sha`, `checkpointed_at`, `intent_id` — but NOT which model produced the work. The dispatch bundle renderer at line 793 works around this by reading `readLastHistoryEntry()` directly, but other consumers don't.

2. **`turn_checkpointed` event gap:** The events.jsonl event for `turn_checkpointed` carries `turn.turn_id` and `turn.role_id` but no runtime_id. Dashboard consumers (M6 scope) and audit tools querying events.jsonl cannot determine which model was checkpointed without cross-referencing history.jsonl.

3. **Commit subject gap:** `git log --oneline` shows `checkpoint: turn_xxx (role=qa, phase=qa)` — an operator scanning checkpoint history sees role and phase but not which model. The full `git show` reveals `Runtime:` in the body, but one-line log views don't.

### Core Workflow

1. PM scopes the three checkpoint metadata gaps and dev charter (this turn)
2. Dev adds `runtime_id` to state.json `last_completed_turn`, `turn_checkpointed` event, and commit subject + regression tests
3. QA verifies all three surfaces emit runtime_id and that existing checkpoint tests pass

### MVP Scope (this run)

- **PM (this turn):** Root-cause the checkpoint metadata gaps, scope implementation for dev
- **Dev:** Three code changes + regression tests in `turn-checkpoint.js`:
  1. Add `runtime_id` to `last_completed_turn` object at line 469-476
  2. Add `runtime_id` to `turn_checkpointed` event at line 479-486
  3. Add `runtime` to checkpoint commit subject at line 205
  4. Regression tests covering:
     - (a) `state.json last_completed_turn` includes `runtime_id` after checkpoint
     - (b) `turn_checkpointed` event payload includes `runtime_id`
     - (c) Checkpoint commit subject includes `runtime=<id>`
     - (d) Missing `runtime_id` (legacy turns) gracefully falls back to `(unknown)` in subject and `null` in state/event

### Out of Scope

- M3 item #4 (test cross-model challenge quality) — longitudinal assessment
- M3 item #5 (acceptance: 3 consecutive cycles) — longitudinal
- Adding actual model name/version (e.g., `claude-opus-4-6`) vs runtime label (e.g., `local-opus-4.6`) — the runtime_id is the system's canonical model identity; resolving to vendor model names would require parsing agentxchain.json command arrays at checkpoint time, which is unnecessary coupling
- Changes to `readLastHistoryEntry()` or dispatch-bundle.js — these already render runtime_id correctly from history entries
- Changes to `session-checkpoint.js` — session checkpoints serve a different contract (cross-session recovery), not model identity
- Backfilling historical state.json entries or events with runtime_id

### Success Metric

1. `state.json last_completed_turn.runtime_id` is populated after `checkpointAcceptedTurn()` completes — matching the history entry's `runtime_id`
2. `turn_checkpointed` event in events.jsonl includes `runtime_id` at the top level (alongside `run_id`, `phase`, `status`) or in `turn` object
3. Checkpoint commit subject includes `runtime=<id>` — e.g., `checkpoint: turn_xxx (role=qa, phase=qa, runtime=local-opus-4.6)`
4. When `runtime_id` is absent from the history entry (legacy), subject shows `runtime=(unknown)`, state shows `runtime_id: null`, event shows `runtime_id: null`
5. All existing checkpoint tests continue to pass

## Challenge to Previous Work

### OBJ-PM-001: Prior M3 runs left checkpoint programmatic metadata untouched despite adding runtime_id to adjacent surfaces (severity: low)

Run `run_fb3583590a1a4799` (M3 item #1) correctly added `runtime_id` to three surfaces: decision ledger entries (governed-state.js:5241), CONTEXT.md "Last Accepted Turn" rendering (dispatch-bundle.js:800), and the decision history table (dispatch-bundle.js:1415). However, it did not address the `last_completed_turn` object written to state.json by `checkpointAcceptedTurn()` at turn-checkpoint.js:469. The checkpoint commit body at line 211 already had `Runtime:` — that predates the M3 work — so the prior run correctly didn't change it. But `last_completed_turn` in state.json and `turn_checkpointed` events were both missing runtime_id and were not identified as gaps.

This is not a defect in the prior run — its scope was explicitly decision ledger + CONTEXT.md rendering. The checkpoint state metadata is a naturally separate concern addressed by this run.

### OBJ-PM-002: The checkpoint commit subject omits runtime, making `git log --oneline` audit incomplete (severity: low)

The current subject format `checkpoint: turn_xxx (role=qa, phase=qa)` was adequate when all turns ran on the same model. With multi-model runs (Opus 4.7, GPT 5.5, Opus 4.6), an operator running `git log --oneline` cannot distinguish which model produced each checkpoint without `git show`. Adding `runtime=<id>` to the subject is a low-cost improvement with high audit visibility.

## Notes for Dev

Your charter is **adding runtime_id to checkpoint programmatic metadata: state.json, events, and commit subject**.

All changes are in **one file**: `cli/src/lib/turn-checkpoint.js`.

### 1. Add runtime_id to checkpoint commit subject (line 205)

Change:
```javascript
const subject = `checkpoint: ${entry.turn_id} (role=${entry.role}, phase=${entry.phase})`;
```
To:
```javascript
const subject = `checkpoint: ${entry.turn_id} (role=${entry.role}, phase=${entry.phase}, runtime=${entry.runtime_id || '(unknown)'})`;
```

### 2. Add runtime_id to `last_completed_turn` in state.json (lines 469-476)

Change:
```javascript
last_completed_turn: {
  turn_id: entry.turn_id,
  role: entry.role || null,
  phase: entry.phase || null,
  checkpoint_sha: checkpointSha,
  checkpointed_at: checkpointedAt,
  intent_id: entry.intent_id || null,
},
```
To:
```javascript
last_completed_turn: {
  turn_id: entry.turn_id,
  role: entry.role || null,
  phase: entry.phase || null,
  runtime_id: entry.runtime_id || null,
  checkpoint_sha: checkpointSha,
  checkpointed_at: checkpointedAt,
  intent_id: entry.intent_id || null,
},
```

### 3. Add runtime_id to `turn_checkpointed` event (lines 479-486)

Change:
```javascript
emitRunEvent(root, 'turn_checkpointed', {
  run_id: state.run_id || null,
  phase: state.phase || null,
  status: state.status || null,
  turn: { turn_id: entry.turn_id, role_id: entry.role || null },
  intent_id: entry.intent_id || null,
  payload: { checkpoint_sha: checkpointSha, checkpointed_at: checkpointedAt },
});
```
To:
```javascript
emitRunEvent(root, 'turn_checkpointed', {
  run_id: state.run_id || null,
  phase: state.phase || null,
  status: state.status || null,
  turn: { turn_id: entry.turn_id, role_id: entry.role || null, runtime_id: entry.runtime_id || null },
  intent_id: entry.intent_id || null,
  payload: { checkpoint_sha: checkpointSha, checkpointed_at: checkpointedAt },
});
```

### 4. Regression tests

Add tests in `cli/test/checkpoint-turn.test.js` (or a new focused test file if the existing file is too large):

**Test A: state.json last_completed_turn includes runtime_id**
- Set up a governed run with `runtime_id: 'local-opus-4.6'` in the turn result
- Accept turn, checkpoint it
- Read state.json, assert `state.last_completed_turn.runtime_id === 'local-opus-4.6'`

**Test B: turn_checkpointed event includes runtime_id**
- Same setup as Test A
- Read events.jsonl, find the `turn_checkpointed` event
- Assert `event.turn.runtime_id === 'local-opus-4.6'`

**Test C: Checkpoint commit subject includes runtime**
- Same setup as Test A
- Read the HEAD commit message with `git log -1 --format=%s`
- Assert subject matches `checkpoint: turn_xxx (role=..., phase=..., runtime=local-opus-4.6)`

**Test D: Missing runtime_id gracefully falls back**
- Accept a turn without `runtime_id` (simulate legacy)
- Checkpoint it
- Assert: commit subject has `runtime=(unknown)`, state has `runtime_id: null`, event has `runtime_id: null`

### 5. Check off M3 item #3

In `.planning/ROADMAP.md` line 41, change:
```
- [ ] Add model identity metadata to turn checkpoints (which model produced this turn)
```
to:
```
- [x] Add model identity metadata to turn checkpoints (which model produced this turn)
```

## Notes for QA

- Verify `state.json last_completed_turn.runtime_id` is populated after checkpoint
- Verify `turn_checkpointed` event in events.jsonl includes `runtime_id` in the `turn` object
- Verify checkpoint commit subject includes `runtime=<id>` (check with `git log --oneline`)
- Verify legacy entries without `runtime_id` produce `(unknown)` in subject and `null` in state/event — no crashes
- Run the full test suite — confirm no regressions
- Spot-check that existing checkpoint tests in `checkpoint-turn.test.js` still pass without modification (the subject format change may require test fixture updates if tests assert on commit message format)

## Acceptance Contract Response

1. **Roadmap milestone addressed: M3: Multi-Model Turn Handoff Quality** — YES. This run addresses the third M3 item: adding model identity metadata to turn checkpoints. The checkpoint commit body already had `Runtime:` in the body, but the programmatic metadata (state.json, events, commit subject) was missing runtime_id.

2. **Unchecked roadmap item completed: Add model identity metadata to turn checkpoints (which model produced this turn)** — YES (after dev implements). The three gaps are: state.json `last_completed_turn` missing `runtime_id`, `turn_checkpointed` event missing `runtime_id`, and commit subject missing runtime. Dev charter adds all three + regression tests.

3. **Evidence source: .planning/ROADMAP.md:41** — Line 41 will be checked off by dev after implementation. Evidence: state.json `last_completed_turn.runtime_id` populated, events.jsonl `turn_checkpointed` event carries `runtime_id`, checkpoint commit subject includes `runtime=<id>`, and legacy fallback works.
