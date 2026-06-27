# Release Notes — BUG-FIX: Step Auto-Checkpoint Acceptance Closure

**Run:** run_71c0a7eaf361090b
**Turn:** turn_31528db7b18ee395 (QA)
**Date:** 2026-06-26

## Summary

Formal closure of ROADMAP.md:70: "PM→Dev handoff via consecutive `step` calls succeeds without manual git commit." The underlying bug-fix was delivered in run_8aceec319cd6aaed — this run verified the fix and closed the acceptance criterion. One new test (AT-STEP-CKPT-004) was added to cover the previously-untested `checkpoint.skipped` path.

## What Changed (This Run)

### New Test: AT-STEP-CKPT-004 in `cli/test/step-auto-checkpoint.test.js`

Tests the `checkpoint.skipped` branch at `step.js:1017` — when a review-only turn is accepted with `artifact.type: 'review'` and `files_changed: []`, `checkpointAcceptedTurn()` returns `{ ok: true, skipped: true }` and step.js continues silently without printing a checkpoint SHA or exiting with error.

Assertions:
- Turn accepted and present in history
- No `checkpoint_sha` in history entry (skipped, not failed)
- No checkpoint commit in git log
- `state.last_completed_turn_id` matches accepted turn (step completed without error)

### ROADMAP.md:70 Checked Off

Acceptance criterion "PM→Dev handoff via consecutive `step` calls succeeds without manual git commit" marked complete with run reference.

## Complete Test Coverage (Verified)

| Test ID | Name | What It Proves |
|---------|------|----------------|
| AT-STEP-CKPT-001 | PM accepted → auto-checkpoint → dev assigns cleanly | The acceptance criterion itself |
| AT-STEP-CKPT-002 | `--no-checkpoint` skips auto-checkpoint | Opt-out flag works |
| AT-STEP-CKPT-003 | Checkpoint failure exits non-zero with retry command | Fail-safe behavior |
| AT-STEP-CKPT-004 | Checkpoint skips silently for review-only turns | Skipped-path branch coverage |

## User Impact

- **Acceptance criterion closed**: Operators using `agentxchain step` for turn-by-turn execution no longer need to manually `git add && git commit` between PM and dev turns. The auto-checkpoint handles workspace cleanup automatically.
- **Improved branch coverage**: AT-STEP-CKPT-004 covers the `checkpoint.skipped` path, completing branch coverage of the step.js auto-checkpoint integration block (lines 1007-1020).
- **No breaking changes**: One test file modified, no source module changes.

## Verification Summary

QA independently ran 5 regression suites:
- **180 tests, 0 failures** (exit code 0)
- All 5 architecture invariants confirmed
- All 4 SYSTEM_SPEC acceptance criteria pass
- ROADMAP.md:70 acceptance item verified as closed
