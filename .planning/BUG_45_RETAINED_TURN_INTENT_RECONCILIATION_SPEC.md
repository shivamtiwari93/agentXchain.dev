# BUG-45: Retained-Turn Intent Reconciliation Spec

**Status:** Implementing
**Bug:** Retained-turn acceptance uses stale embedded `intake_context.acceptance_contract` instead of reconciling against current intent state
**Root cause:** `governed-state.js:3228` reads `currentTurn.intake_context` from state.json — a snapshot taken at dispatch time — never checking whether the intent has since been completed, satisfied, or had its contract updated.

## Purpose

Fix three distinct defects that together cause retained-turn acceptance to deadlock:

1. **Stale contract enforcement:** acceptance reads embedded `intake_context.acceptance_contract` instead of the live intent file
2. **No operator escape hatch:** `intake resolve` cannot transition `executing → completed` even when evidence is available
3. **Framework-generated file pollution:** `HUMAN_TASKS.md` edits by the escalation layer trigger "Undeclared file changes" errors

## Interface

### Defect 1: Live intent reconciliation

Before `evaluateIntentCoverage()` at line 3228, insert a reconciliation step:

```
function reconcileIntakeContext(root, intakeCtx):
  if (!intakeCtx?.intent_id) return intakeCtx  // no intent binding

  liveIntent = readIntent(root, intakeCtx.intent_id)
  if (!liveIntent.ok) return intakeCtx  // intent file missing — fall back to embedded

  TERMINAL_STATES = ['completed', 'satisfied', 'superseded', 'suppressed', 'failed', 'rejected']
  if (TERMINAL_STATES.includes(liveIntent.intent.status)):
    return null  // skip coverage enforcement entirely

  // Intent is still active — use the CURRENT acceptance_contract from disk
  return { ...intakeCtx, acceptance_contract: liveIntent.intent.acceptance_contract }
```

### Defect 2: `intake resolve --outcome completed`

Add `--outcome` flag to `resolveIntent()`:
- When `outcome === 'completed'` and intent status is `executing`, transition to `completed`
- Record reason: `"operator-resolved: intent marked completed via intake resolve --outcome completed"`
- Emit `intent_resolved` event

### Defect 3: HUMAN_TASKS.md exclusion

Add `'HUMAN_TASKS.md'` to `ORCHESTRATOR_STATE_FILES` in `cli/src/lib/repo-observer.js`.

## Behavior

1. On acceptance, if the live intent is terminal, coverage enforcement is skipped — acceptance proceeds as if no intent was bound.
2. On acceptance, if the live intent's `acceptance_contract` differs from the embedded copy, the live version is authoritative.
3. `intake resolve --intent <id> --outcome completed` transitions `executing → completed` atomically.
4. Framework-owned `HUMAN_TASKS.md` writes do not trigger "Undeclared file changes" during artifact observation.

## Error Cases

- Intent file missing on disk: fall back to embedded `intake_context` (no regression from current behavior)
- `intake resolve --outcome completed` on a non-executing intent: error with current status
- `HUMAN_TASKS.md` exclusion only applies to baseline observation, not to turn-owned file lists

## Acceptance Tests

1. Seed retained turn with embedded `intake_context.acceptance_contract`, intent on disk in `completed` status. `accept-turn` succeeds without "Intent coverage incomplete."
2. Seed retained turn with embedded stale contract, intent on disk in `executing` status with updated contract. Coverage evaluates against the disk contract, not the embedded one.
3. `intake resolve --intent <id> --outcome completed` transitions executing intent to completed.
4. Framework-generated `HUMAN_TASKS.md` edit does not cause "Undeclared file changes" in artifact observation.
5. Exact tester scenario: retained turn `turn_1e8cabbfdda98f5d` shape, `accept-turn` succeeds after intent is resolved.

## Open Questions

- Should `reconcileIntakeContext` also update the embedded copy in state.json for consistency? (Probably yes, but not required for the fix.)
