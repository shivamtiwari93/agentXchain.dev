# Acceptance Matrix — agentXchain.dev

**Run:** run_37fb509c4b6ed593
**Turn:** turn_ae1f99e6b5e0cf3c (QA)
**Scope:** M3 Checkpoint Runtime Identity Metadata

## Checkpoint Runtime Identity Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| CRI-001 | `state.json` `last_completed_turn` includes `runtime_id` | turn-checkpoint.js:481 writes `runtime_id: runtimeId`; test 1 asserts `state.last_completed_turn.runtime_id === 'local-dev'` (line 169) | PASS |
| CRI-002 | `turn_checkpointed` event includes `runtime_id` in `turn` object | turn-checkpoint.js:492 writes `runtime_id: runtimeId` in turn object; test 1 asserts event `turn.runtime_id === 'local-dev'` (line 180) | PASS |
| CRI-003 | Checkpoint commit subject includes `runtime=<id>` | turn-checkpoint.js:212 renders `runtime=${runtimeId}` in subject; test 1 regex match `runtime=local-dev` (line 187) | PASS |
| CRI-004 | Legacy entries without `runtime_id` produce `null` in state/events | normalizeRuntimeId returns null for missing/blank runtime_id; test 2 asserts `state.last_completed_turn.runtime_id === null` (line 212) and `event.turn.runtime_id === null` (line 219) | PASS |
| CRI-005 | Legacy entries produce `(unknown)` in commit subject | buildCheckpointCommit uses `normalizeRuntimeId(entry) \|\| '(unknown)'`; test 2 regex match `runtime=\(unknown\)` (line 222) | PASS |
| CRI-006 | M3 ROADMAP item #3 checked off | ROADMAP.md:41 `- [x] Add model identity metadata to turn checkpoints` | PASS |
| CRI-007 | No reserved files modified by dev | git show HEAD: 4 files — `.planning/IMPLEMENTATION_NOTES.md`, `.planning/ROADMAP.md`, `cli/src/lib/turn-checkpoint.js`, `cli/test/checkpoint-turn.test.js`. No `.agentxchain/` or `agentxchain.json` paths | PASS |
| CRI-008 | `agentxchain.json` unmodified | `git diff HEAD -- agentxchain.json` returns empty | PASS |

## Regression Suites

| Suite | Count | Result |
|-------|-------|--------|
| checkpoint-turn.test.js | 12 | PASS |
| dispatch-bundle-decision-history.test.js | 10 | PASS |
| governed-state.test.js | 99 | PASS |
| dispatch-bundle.test.js | 74 | PASS |
| turn-result-validator.test.js | 100 | PASS |
| staged-result-proof.test.js | 14 | PASS |
| continuous-run.test.js | 87 | PASS |
| local-cli-adapter.test.js | 46 | PASS |
| vision-reader.test.js | 36 | PASS |
| claude-local-auth-smoke-probe.test.js | 8 | PASS |
| config-schema + timeout-evaluator + run-loop + release-notes-gate | 87 | PASS |
| **Total** | **573** | **0 failures** |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure from prior runs; predates this run | Not a regression — confirmed across 12 consecutive QA runs |
