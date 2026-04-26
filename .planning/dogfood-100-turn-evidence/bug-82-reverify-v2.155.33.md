# BUG-82 Re-verify Evidence — agentxchain@2.155.33

## Summary

BUG-82 (dev turn proposes routing-illegal `proposed_next_role` after BUG-81's gate auto-strip keeps session in planning phase; protocol validation hard-errors instead of auto-normalizing) is **VERIFIED FIXED** on the same dogfood session using shipped `agentxchain@2.155.33`.

## Re-verification Steps

### 1. Confirmed paused session state (pre-fix)

```
Session: cont-e958afb2 (active)
Run: Run 3 for M29 (active, phase=planning)
Turn: turn_c9732a9f04c371a1 (dev, failed_acceptance)
Failure: "proposed_next_role \"qa\" is not in the allowed_next_roles for
  phase \"planning\": [pm, dev, product_marketing, eng_director, human]."
Package at failure: agentxchain@2.155.32
Staged result: proposed_next_role="qa", phase_transition_request="implementation"
```

### 2. Re-attempted acceptance with shipped v2.155.33

```sh
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
npx --yes -p agentxchain@2.155.33 -c 'agentxchain accept-turn --turn turn_c9732a9f04c371a1 --checkpoint'
```

**Result: Turn Accepted**

```
Turn:     turn_c9732a9f04c371a1
Role:     dev
Status:   completed
Summary:  Challenged PM M29 stale-checkbox reconciliation turn, independently
  re-verified V1.10 baseline (npm test exit 0, 13-command CLI, 16 eval
  scenarios, zero source drift), updated IMPLEMENTATION_NOTES.md, and
  confirmed planning_signoff gate artifacts are complete.
Proposed: pm
Accepted: git:c4a38fd08fbe83597e76255b1aadc4429d740077
Checkpoint: a4eca246ac09dafc66960aa061a1b3e5bbaab706
```

### 3. Fix mechanism confirmed

1. **proposed_next_role normalization**: `normalizeTurnResult()` Rule 6 (BUG-82 branch) detected `proposed_next_role: "qa"` is not in planning's `allowed_next_roles`, auto-normalized to `"pm"` (first allowed role that isn't the assigned role "dev").
2. **phase_transition_request handling**: BUG-81's gate auto-strip may also have fired for the `phase_transition_request: "implementation"`.
3. **Result**: Turn accepted with `Proposed: pm` — the normalized value, not the original "qa".

### 4. Verification Criteria Met

1. **Dev turn accepted:** Same dev turn that failed protocol validation on v2.155.32 accepted on v2.155.33.
2. **proposed_next_role auto-normalized:** Original "qa" → accepted as "pm" (routing-legal for planning phase).
3. **No manual intervention:** Zero staging JSON edits, zero operator workarounds.
4. **Session continued:** Next role pm ready for dispatch.

## Package Version

```
agentxchain@2.155.33
```

## Date

2026-04-26T06:52:00Z
