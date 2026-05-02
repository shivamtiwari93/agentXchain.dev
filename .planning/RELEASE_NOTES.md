# Release Notes

## Bug Fix: Continuous Mode Idle After Run Completion (BUG-76)

### Problem

When running `agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 1`, the CLI would report completed with `runs_completed=0` and no objective even when `ROADMAP.md` contained unchecked milestone work (e.g., M28/M29). The continuous loop was checking vision candidates first and returning idle without consulting the roadmap.

### Fix

`seedFromVision()` now calls `deriveRoadmapCandidates()` first (before vision candidate derivation). When unchecked roadmap milestones are found:

1. A `roadmap_open_work_detected` intake event is recorded through the normal pipeline
2. The intent is auto-triaged and auto-approved with charter `[roadmap] Mxx: <goal>`
3. `idle_cycles` is reset to 0, preventing premature idle-exit
4. The governed run executes against the roadmap objective

### Related Fix: Roadmap Exhaustion (BUG-77)

When all roadmap milestones are checked but VISION.md has unplanned scope, the system now dispatches a `roadmap_replenishment` intent to PM instead of idling. This ensures continuous mode keeps deriving bounded increments from the vision.

### Status Reporting

`agentxchain status --json` now surfaces `roadmap_open_work_detected` and `roadmap_exhausted_vision_open` as `next_actions` entries, telling operators exactly what pending work exists and the command to resume it.

## Verification Summary

- 303 tests across 6 suites independently verified by QA, 0 failures
- BUG-76 command-chain integration test: continuous loop derives M28 from unchecked roadmap
- BUG-77 command-chain integration test: continuous loop dispatches roadmap-replenishment
- Status JSON output verified for both action types
