# System Spec — Step Command Auto-Checkpoint After Acceptance

**Run:** `run_8aceec319cd6aaed`
**Baseline:** git:9c6c8bad193abb51a02db43bc251d5a90a8a9c6c (HEAD at planning start)
**Package version:** `agentxchain@2.155.72`

## Purpose

Wire `checkpointAcceptedTurn()` into the `step` command after successful acceptance, so the workspace is clean for the next turn assignment without manual git commits.

**Root cause:** `step.js:992-1004` calls `acceptGovernedTurn()` then `printAcceptSummary()` but never calls `checkpointAcceptedTurn()`. The import is absent. By contrast, `run.js:617` and `accept-turn.js:177` both call it.

---

## 1. Existing Infrastructure

### Auto-checkpoint in `run.js` (already working)

```
run --continuous
  → executeGovernedRun(root, config, { afterAccept })
    → afterAccept({ turn, acceptResult })            [run.js:605]
      → checkpointAcceptedTurn(root, { turnId })      [run.js:617]
        → git add + git commit                         [turn-checkpoint.js:391-456]
        → update history + state.json                  [turn-checkpoint.js:462-486]
```

### Checkpoint in `accept-turn.js` (already working)

```
accept-turn --checkpoint
  → acceptGovernedTurn(root, config, opts)            [accept-turn.js:22]
  → checkpointAcceptedTurn(root, { turnId })          [accept-turn.js:177]
```

### Missing: `step.js` (the bug)

```
step
  → acceptGovernedTurn(root, config, { turnId })      [step.js:994]
  → printAcceptSummary(acceptResult, config)           [step.js:1004]
  → (no checkpoint — workspace stays dirty)
```

### Dirty-workspace detection (the symptom)

```
step (next turn)
  → assignGovernedTurn(root, config, { roleId })      
    → checkCleanBaseline(root, writeAuthority)         [governed-state.js:3606]
      → dirty files detected → detectPendingCheckpoint [governed-state.js:3608]
      → return { ok: false, error_code: 'checkpoint_required' }  [governed-state.js:3610]
```

---

## 2. Fix Specification

### Change 1: `cli/src/commands/step.js` — Add auto-checkpoint after acceptance

**Import addition** (add to existing imports near top of file):

```javascript
import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';
```

**Code addition** (insert after line 1004, inside the `if (validation.ok)` block, after `printAcceptSummary`):

```javascript
    // Auto-checkpoint accepted turn so workspace is clean for next assignment
    if (!opts.noCheckpoint) {
      const checkpoint = checkpointAcceptedTurn(root, { turnId: turn.turn_id });
      if (!checkpoint.ok) {
        console.log(`  ${chalk.yellow('Checkpoint:')} accepted but checkpoint failed`);
        console.log(`  ${chalk.dim('Error:')}  ${checkpoint.error}`);
        console.log(`  ${chalk.dim('Retry:')}  agentxchain checkpoint-turn --turn ${turn.turn_id}`);
        console.log('');
        process.exit(1);
      }
      if (!checkpoint.skipped) {
        console.log(`  ${chalk.dim('Checkpoint:')} ${checkpoint.checkpoint_sha}`);
      }
    }
```

**Behavior:**
- Default: auto-checkpoint after acceptance (matches `run.js` behavior)
- `--no-checkpoint` flag: skip checkpoint (workspace stays dirty, operator manages manually)
- Checkpoint failure: print error with retry command, exit non-zero (matches `accept-turn.js:178-183`)
- Skipped checkpoint (no files to commit, e.g. review-only turns): silent, no error

### Change 2: `cli/bin/agentxchain.js` — Add `--no-checkpoint` flag

**Location:** Line 751, add after `--auto-reject` option:

```javascript
  .option('--no-checkpoint', 'Skip git checkpoint after acceptance (workspace stays dirty)')
```

### Design Rationale

1. **Default-on matches `run.js`** — The `run` command auto-checkpoints by default (line 614: `const autoCheckpoint = ...`). The `step` command should have the same default. Operators who want manual control use `--no-checkpoint`.

2. **Exit non-zero on checkpoint failure** — Matches `accept-turn.js:178-183`. The turn IS accepted (state updated, history written), but the workspace is dirty. Exiting non-zero signals to the operator that the next step will fail without intervention.

3. **No changes to `checkpointAcceptedTurn()`** — The checkpoint function is correct and complete. It handles: empty files_changed (skip), already-checkpointed turns (skip), missing files (error), staging + commit + state update + event emission. No modifications needed.

4. **No changes to `checkCleanBaseline()`** — The dirty-workspace check is correct and should remain strict. The fix is at the source (checkpoint after acceptance), not at the check (loosen the baseline requirement).

---

## Dev Charter

### Scope

**Change 1: `cli/src/commands/step.js`**
- Add `import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';`
- After `printAcceptSummary(acceptResult, config);` (line 1004), add auto-checkpoint block (~12 LOC)
- ~15 LOC delta total in step.js

**Change 2: `cli/bin/agentxchain.js`**
- Add `.option('--no-checkpoint', ...)` to the step command at line 751
- 1 LOC delta

**Change 3: Integration test** (new file `cli/test/step-auto-checkpoint.test.js` or append to `cli/test/checkpoint-turn.test.js`)
- Test AT-STEP-CKPT-001: PM turn accepted via step → git log contains checkpoint commit → dev turn assignment succeeds (no `checkpoint_required` error)
- Test AT-STEP-CKPT-002: PM turn accepted via step with `--no-checkpoint` → no checkpoint commit → `checkCleanBaseline` would detect dirty workspace
- ~50-80 LOC

### Out of Scope

- `run.js` (already works)
- `accept-turn.js` (already works)
- `continuous-run.js` (already works)
- `turn-checkpoint.js` (correct, just unwired in step)
- `governed-state.js` `checkCleanBaseline()` (correct, should stay strict)
- Making `accept-turn` default to checkpoint (separate enhancement)

### Verification

Dev must confirm:
1. `npm test` passes with 0 failures
2. New test AT-STEP-CKPT-001 exercises PM accept → checkpoint → dev assign flow
3. New test AT-STEP-CKPT-002 exercises `--no-checkpoint` opt-out
4. `step.js` imports and calls `checkpointAcceptedTurn` after acceptance

## Acceptance Tests

- [x] `step.js` imports `checkpointAcceptedTurn` from `../lib/turn-checkpoint.js` — verified at `step.js:80`
- [x] After successful acceptance, `step` calls `checkpointAcceptedTurn(root, { turnId: turn.turn_id })` — verified at `step.js:1009`, guarded by `.git` existence check (DEC-001)
- [x] Checkpoint failure exits non-zero with error message and retry command — verified at `step.js:1010-1016`
- [x] Checkpoint skip (no files) is silent and continues normally — verified at `step.js:1017-1019`, `!checkpoint.skipped` guard
- [x] `--no-checkpoint` flag registered on step command in `cli/bin/agentxchain.js` — verified at `agentxchain.js:752`
- [x] `--no-checkpoint` flag skips checkpoint call — verified at `step.js:1008`, `!opts.noCheckpoint` guard
- [x] AT-STEP-CKPT-001: PM turn → accept → auto-checkpoint → dev turn assigns without error — verified in `step-auto-checkpoint.test.js:229-269`
- [x] AT-STEP-CKPT-002: PM turn → accept with `--no-checkpoint` → workspace remains dirty — verified in `step-auto-checkpoint.test.js:271-293`
- [ ] `npm test` passes with 0 failures — deferred to QA; dev ran 12 targeted test files (443 tests, 0 failures)
