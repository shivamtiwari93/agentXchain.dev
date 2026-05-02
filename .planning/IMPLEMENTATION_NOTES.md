# Implementation Notes — agentXchain.dev M1 Ghost Turn Hardening

## 2026-05-02 M3 eng_director Acceptance Pipeline Regression

### Challenge

The previous PM turn correctly identified the structural gap: `eng_director` is an escalation-only role, so normal PM→Dev→QA cycles do not prove its turn-result acceptance path. I do not accept the wording of the acceptance item literally requiring three production cycles with a director turn, because that would require manufacturing deadlocks; the defensible evidence is a pipeline integration regression plus the existing escalation proof.

### Changes

- Extended the dispatch-bundle decision-history fixture config with the real `eng_director` role and routing eligibility in planning, implementation, and QA phases.
- Added an integration regression that accepts a Dev implementation turn proposing `eng_director`, verifies the next recommended role, accepts a valid director turn with runtime identity, decisions, and objections, then generates the follow-up QA `CONTEXT.md`.
- Asserted that director evidence persists across history, decision ledger runtime attribution, `## Last Accepted Turn`, objections rendering, and `## Decision History`.
- Marked the M3 all-role acceptance item complete because PM/Dev/QA have 13+ production cycles and `eng_director` now has executable governed-pipeline coverage.

### Verification

- `node --test --test-timeout=60000 --test-name-pattern "eng_director escalation" cli/test/dispatch-bundle-decision-history.test.js`

## 2026-05-02 M3 Cross-Model Challenge Quality Regression

### Challenge

The previous PM turn correctly identified that the cross-model challenge audit needed to become executable coverage, but I do not accept a shallow static rendering test as sufficient. The regression must exercise the acceptance pipeline so runtime identity and objections are proven to survive accepted history, decision-ledger persistence, and the next generated `CONTEXT.md`.

### Changes

- Added an integration regression in `dispatch-bundle-decision-history.test.js` that accepts a Dev turn from `local-gpt-5.5`, accepts a QA challenge turn from `local-opus-4.6`, and generates the follow-up Dev dispatch context.
- Asserted that decision-ledger entries retain each accepted turn's `runtime_id`.
- Asserted that the QA objection is preserved in accepted history and rendered in `## Last Accepted Turn`.
- Asserted that `## Decision History` renders Dev and QA decisions with distinct runtime attribution.
- Marked the M3 cross-model challenge quality ROADMAP item complete.
- Added a tracking annotation to the M3 3-cycle acceptance item because PM found 3/4 roles covered; `eng_director` still needs a normal governed-cycle dispatch before completion.

### Verification

- `node --test --test-timeout=60000 --test-name-pattern "preserves cross-model" cli/test/dispatch-bundle-decision-history.test.js`

## 2026-05-02 Checkpoint Runtime Identity Metadata

### Challenge

The previous PM turn correctly identified the three missing checkpoint metadata surfaces: `state.json` `last_completed_turn`, the `turn_checkpointed` event payload, and the checkpoint commit subject. I do not accept the test scope as requiring four separate tests: one normal checkpoint regression can assert all three runtime-bearing surfaces together, while a focused legacy-history regression is the right place to cover missing `runtime_id` fallback behavior.

### Changes

- Added normalized runtime identity handling in `checkpointAcceptedTurn()`.
- Included `runtime_id` in `state.last_completed_turn` for checkpointed turns.
- Included `runtime_id` in the `turn_checkpointed` event `turn` object.
- Added `runtime=<id>` to checkpoint commit subjects, with `(unknown)` for legacy accepted-history entries that predate runtime identity.
- Checked off the M3 checkpoint model identity ROADMAP item after implementation.

### Verification

- `node --check cli/src/lib/turn-checkpoint.js`
- `node --test --test-timeout=60000 cli/test/checkpoint-turn.test.js`

## 2026-05-02 M3 Output Format Validation

### Challenge

The previous PM turn correctly identified the Claude/Codex asymmetry, but I do not accept its validation detail as complete. Limiting Codex `--json` validation to stdin transport would leave argv and dispatch-bundle Codex runtimes able to run without machine-readable diagnostics. The adapter still treats staged `turn-result.json` as authoritative, but Codex subprocess output should consistently be JSON diagnostics.

### Changes

- Added Codex local CLI runtime detection and Codex/OpenAI auth failure text classification alongside the existing Claude helpers.
- Added a Codex auth-failure close-handler branch in the local CLI adapter, returning a typed `codex_auth_failed` blocker with OpenAI credential recovery guidance.
- Extended local CLI command compatibility validation so Codex runtimes must use `codex exec --json` before dispatch.
- Added regression coverage for Codex auth failure classification, adapter-level Codex command-shape preflight blocking, Codex successful `exec --json` staged-result handling, and the shared Codex detector/classifier helpers.
- Marked the M3 ROADMAP output-format validation item complete.

### Verification

- `node --check cli/src/lib/claude-local-auth.js`
- `node --check cli/src/lib/adapters/local-cli-adapter.js`
- `node --test --test-timeout=60000 cli/test/claude-local-auth-smoke-probe.test.js`
- `node --test --test-timeout=60000 cli/test/local-cli-adapter.test.js`

## 2026-05-02 M3 Runtime Identity Handoff Context

### Challenge

The previous PM turn correctly identified the user-facing context gap, but I do not accept the root-cause framing as three equivalent missing renderings. Accepted history already persisted `runtime_id`; the concrete defects were one missing ledger field and two missing `CONTEXT.md` render surfaces. That distinction matters because the fix should preserve historical compatibility instead of inventing a backfill.

### Changes

- Added `runtime_id` to accepted decision-ledger entries produced by `acceptGovernedTurn()`.
- Rendered the previous accepted turn runtime in the `## Last Accepted Turn` section of generated `CONTEXT.md` when history contains it.
- Added a `Runtime` column to the `## Decision History` table, leaving pre-M3 ledger rows blank when no runtime was recorded.
- Added regression coverage for ledger persistence, last-turn runtime rendering, and mixed old/new decision-history rendering.
- Updated stale test fixtures that conflicted with the implementation-phase product-code guard without weakening that guard.

### Verification

- `node --check cli/src/lib/governed-state.js && node --check cli/src/lib/dispatch-bundle.js`
- `node --test --test-timeout=60000 cli/test/governed-state.test.js`
- `node --test --test-timeout=60000 cli/test/dispatch-bundle.test.js`

## 2026-05-02 M2 Acceptance Tracking Defense-in-Depth

### Challenge

The previous PM turn correctly identified a timing anomaly as the likely reason M2 #5 re-triggered, but I do not accept that diagnosis as sufficient by itself. The current scanner already skips complete tracking annotations, so the practical risk is metadata leakage and mixed-state routing: tracked longitudinal items must not influence dedup text, and untracked downstream roadmap work must still seed normally.

### Changes

- Added `stripRoadmapTrackingAnnotations()` and applied it at `deriveRoadmapCandidates()` goal extraction so candidate goal text cannot retain complete `<!-- tracking: ... -->` annotations if it survives parsing.
- Added focused regression coverage for the sanitizer, including preservation of normal non-tracking HTML comments.
- Added a `seedFromVision()` mixed-state integration test with tracked M1 and M2 acceptance items plus untracked M3 roadmap work, verifying that M3 is seeded and tracking metadata does not enter the resulting intent.
- Updated the M2 longitudinal acceptance tracking counter from `0/5` to `1/5`.

### Verification

- `node --check cli/src/lib/vision-reader.js`
- `node --test --test-timeout=60000 cli/test/vision-reader.test.js`
- `node --test --test-timeout=60000 --test-name-pattern seedFromVision cli/test/continuous-run.test.js`
- `node --test --test-timeout=60000 cli/test/continuous-run.test.js`

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
