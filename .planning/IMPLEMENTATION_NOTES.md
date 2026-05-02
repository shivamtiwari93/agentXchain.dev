# Implementation Notes — agentXchain.dev M1 Ghost Turn Hardening

## 2026-05-02 M2 Roadmap Replenishment Three-State Integration

### Challenge

The previous PM turn correctly scoped the status message and missing integration coverage, but I do not accept the claim that `seedFromVision()` already handled the full three-state model. Inspection showed that `detectRoadmapExhaustedVisionOpen()` could return `vision_fully_mapped`, but `seedFromVision()` ignored that terminal classification and fell through to generic VISION.md derivation. That could seed new work from already-mapped vision goals instead of idling.

### Changes

- Updated the roadmap-replenishment operator log to the required exact status: "Roadmap exhausted, vision still open, deriving next increment".
- Changed `seedFromVision()` to treat `vision_fully_mapped` and `vision_no_actionable_scope` detector results as an idle `vision_exhausted` state instead of falling through to generic vision derivation.
- Added `seedFromVision()` integration regression coverage for the M2 three-state model: roadmap open work, roadmap exhausted with unplanned vision scope, and vision fully mapped.
- Tightened the BUG-77 command-chain assertion to require the exact roadmap-exhausted status message.
- Marked M2 ROADMAP items #2-#4 complete and added a tracking annotation to the longitudinal 5-run acceptance item.

### Verification

- `node --check cli/src/lib/continuous-run.js`
- `node --test --test-timeout=60000 --test-name-pattern seedFromVision cli/test/continuous-run.test.js`
- `node --test --test-timeout=60000 cli/test/continuous-run.test.js`
- `node --test --test-timeout=60000 cli/test/vision-reader.test.js`
- `node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js`

## 2026-05-02 M2 Idle-Expansion Heuristic Fix

### Challenge

The previous PM turn correctly identified the inconsistent tracking-annotation handling between `deriveRoadmapCandidates()` and `detectRoadmapExhaustedVisionOpen()`. I do not accept the scope as fully proven by inspection alone: the exhaustion detector has its own roadmap scan, so it needed direct three-state regression coverage rather than relying on the existing candidate derivation tests.

### Changes

- Updated `detectRoadmapExhaustedVisionOpen()` to ignore unchecked roadmap lines containing a complete `<!-- tracking: ... -->` annotation when deciding whether actionable unchecked work remains.
- Added regression coverage for the three relevant states: tracked-only roadmap with unplanned vision scope, actionable unchecked roadmap work, and exhausted roadmap with fully mapped vision scope.
- Marked the first M2 ROADMAP item complete after implementation.

### Verification

- `node --check cli/src/lib/vision-reader.js`
- `node --test --test-timeout=60000 cli/test/vision-reader.test.js`

## 2026-05-02 Roadmap Tracking Annotation Implementation

### Challenge

The previous PM turn correctly identified the vision scanner re-trigger loop, but I do not accept the implementation detail as broadly stated. A scanner guard that only checks for `<!-- tracking:` as a substring is too loose for a roadmap parser because normal comments and prose can coexist on checklist items. The implementation therefore recognizes complete inline tracking annotations in the form `<!-- tracking: ... -->` and leaves other unchecked roadmap comments actionable.

### Changes

- Added `<!-- tracking: ... -->` annotation detection in `deriveRoadmapCandidates()` so longitudinal unchecked ROADMAP items are skipped by continuous vision scanning while remaining visibly unchecked for humans.
- Preserved existing behavior for unchecked roadmap items without a complete tracking annotation.
- Added regression coverage for the M1 longitudinal acceptance item and for normal HTML comments that should not be skipped.

### Verification

- `node --check cli/src/lib/vision-reader.js`
- `node --test --test-timeout=60000 cli/test/vision-reader.test.js`

## 2026-05-01 Implementation Phase Gate Hardening

### Challenge

The previous dev turn concluded that no source implementation was needed. I do not accept that conclusion for this implementation phase: the dispatch contract explicitly says a completed implementation turn must include actual product code changes in `files_changed`, not only documentation or planning artifacts. Leaving the validator at warning-only behavior would allow the same verification-only implementation turn pattern to pass again.

### Changes

- Changed staged turn-result artifact validation so completed authoritative turns in the `implementation` phase fail unless `files_changed` contains at least one product repo path.
- Kept planning and review artifacts as valid supplementary outputs, but they no longer satisfy implementation completion by themselves.
- Preserved checkpointable verification-produced file behavior outside the implementation phase.
- Added regression coverage for no-edit implementation completions and implementation completions that only list `.planning/` artifacts.

### Verification

- `node --check cli/src/lib/turn-result-validator.js` passed.
- `node --test --test-timeout=60000 cli/test/turn-result-validator.test.js` passed.

## Prior M1 Ghost Turn Hardening

## Challenge

The prior PM turn correctly identified the missing `--verbose` flag as the concrete root cause for the observed Claude `stream-json` ghost turns. I do not accept the broader conclusion that the adapter layer only needed additive watchdog hardening while leaving CLI compatibility unchecked. A known deterministic command-shape failure should be rejected before spawn, otherwise the system still depends on operator memory and post-failure watchdog recovery.

## Changes

- Added a local CLI compatibility guard that blocks Claude commands using `--print` plus `--output-format stream-json` without `--verbose` before subprocess spawn. The result is a typed `local_cli_command_incompatible` dispatch blocker instead of a ghost-style startup failure.
- Added startup heartbeat diagnostics for spawned local CLI subprocesses that are silent before first output. Heartbeats are written as `[adapter:diag] startup_heartbeat` and can update run progress as adapter keepalives, but they do not set `first_output_at` and do not count as governed startup proof.
- Added `startup_heartbeat_ms` as a schema-backed, validated knob at both `run_loop.startup_heartbeat_ms` and `runtimes.<id>.startup_heartbeat_ms`, with runtime > global > default precedence.
- Threaded explicit dispatch timeout inputs into the local CLI adapter so run-loop `timeouts.per_turn_minutes` deadlines are reflected at the adapter boundary as well as the outer run-loop abort signal.
- Added focused regression coverage for the missing-`--verbose` guard, startup heartbeat behavior, heartbeat precedence, stderr-only non-proof behavior, and existing per-turn timeout coverage.

## Verification

- `node --check cli/src/lib/adapters/local-cli-adapter.js` passed.
- `node --check cli/src/lib/dispatch-progress.js` passed.
- `node --check cli/src/commands/run.js` passed.
- `node --check cli/src/lib/normalized-config.js` passed.
- `node --test --test-timeout=60000 cli/test/local-cli-adapter.test.js` passed.
- `node --test --test-timeout=60000 cli/test/agentxchain-config-schema.test.js cli/test/timeout-evaluator.test.js cli/test/run-loop.test.js` passed.

## Notes

- I did not verify the acceptance target of zero ghost turns across 10 consecutive self-governed runs; that belongs in QA or a longer dogfood run.
- The existing turn timeout system is `timeouts.per_turn_minutes`; this turn verified it rather than introducing a second, conflicting timeout mechanism.
