# Release Notes

## User Impact

Operators using `agentxchain run --continuous` will no longer experience premature idle-exit when unchecked roadmap milestones exist. Previously, the continuous loop would report `runs_completed=0` and idle even with open roadmap work (e.g., M28/M29). Now the CLI:

- **Auto-derives roadmap objectives** before checking vision candidates, so unchecked milestones are picked up immediately
- **Only idles when genuinely no work remains** — both roadmap and vision must be exhausted before idle_cycles increments
- **Reports pending work in `status --json`** via `roadmap_open_work_detected` and `roadmap_exhausted_vision_open` next_actions entries

Additionally, when all roadmap milestones are checked but VISION.md has unplanned scope (BUG-77), the system dispatches a `roadmap_replenishment` intent to PM instead of idling, keeping continuous mode productive.

## Bug Fix Details

### BUG-76: Continuous Mode Idle After Run Completion

**Problem:** `seedFromVision()` checked vision candidates first and returned idle without consulting the roadmap, causing `--continuous` runs to exit with zero completed runs.

**Fix:** `seedFromVision()` now calls `deriveRoadmapCandidates()` first (line 1259). When unchecked milestones are found, a `roadmap_open_work_detected` intake event is recorded, the intent is auto-triaged and auto-approved, `idle_cycles` resets to 0, and the governed run executes against the roadmap objective.

### BUG-77: Roadmap Exhaustion With Open Vision Scope

**Problem:** When all roadmap milestones were checked but VISION.md still had unplanned scope, the system would idle instead of deriving new work.

**Fix:** `detectRoadmapExhaustedVisionOpen()` (lines 1332-1412) now dispatches a `roadmap_replenishment` intent to PM when this condition is detected.

## Verification Summary

- 303 tests across 6 suites independently verified by QA, 0 failures
- BUG-76 command-chain integration test: continuous loop derives M28 from unchecked roadmap
- BUG-77 command-chain integration test: continuous loop dispatches roadmap-replenishment
- Status JSON output verified for both next_action types
- Gate evaluator, turn-result-validator, and release-preflight suites all pass
