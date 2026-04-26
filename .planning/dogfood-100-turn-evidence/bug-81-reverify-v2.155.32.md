# BUG-81 Re-verify Evidence — agentxchain@2.155.32

## Summary

BUG-81 (PM turn requests phase transition but gate-required planning artifacts not modified; framework blocks instead of auto-stripping) is **VERIFIED FIXED** on the same dogfood session using shipped `agentxchain@2.155.32`.

## Re-verification Steps

### 1. Confirmed paused session state (pre-fix)

```
Session: cont-e958afb2 (paused)
Run: Run 3 for M29 (active, phase=planning)
Turn: turn_df1112d797428a6b (pm, failed_acceptance)
Failure: "Gate 'planning_signoff' is failing on .planning/PM_SIGNOFF.md,
  .planning/SYSTEM_SPEC.md, .planning/command-surface.md. Your turn did
  not modify those files."
Package at failure: agentxchain@2.155.31
```

### 2. Re-attempted acceptance with shipped v2.155.32

```sh
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
npx --yes -p agentxchain@2.155.32 -c 'agentxchain accept-turn --turn turn_df1112d797428a6b --checkpoint'
```

**Result: Turn Accepted**

```
Turn:     turn_df1112d797428a6b
Role:     pm
Status:   completed
Summary:  Reconciled M29 stale-checkbox false positive: flipped all 17 M29
  sub-items to [x] in .planning/ROADMAP.md against verifiable shipped V1.10
  evidence...
Proposed: dev
Accepted: git:a6a3c744930d592eed3fb6badc01bf82d00d6922
Checkpoint: c4a38fd08fbe83597e76255b1aadc4429d740077
```

### 3. Fix mechanism confirmed

`evaluateRoadmapDerivedConditionalCoverage()` auto-stripped the phase_transition_request
because the turn was in planning phase and didn't modify gate-required files. PM's
planning work (M29 checkbox reconciliation in ROADMAP.md) was preserved. Phase stays
in "planning" for continuous loop re-dispatch.

### 4. Verification Criteria Met

1. **PM turn accepted:** Same PM turn that failed on v2.155.31 accepted on v2.155.32.
2. **Phase transition auto-stripped:** `gate_transition_request_auto_stripped` event emitted.
3. **No manual intervention:** Zero staging JSON edits, zero operator workarounds.
4. **Session continued:** Next role dev ready for dispatch.

## Package Version

```
agentxchain@2.155.32
```

## Date

2026-04-26T06:30:00Z
