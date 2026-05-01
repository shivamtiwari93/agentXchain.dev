# Acceptance Matrix — agentXchain.dev

**Run:** run_8485b8044fbc7e77
**Scope:** Harden turn-result workspace artifact validation (self-governance substrate work)

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | Workspace artifacts with empty files_changed must be rejected | `artifact.type: "workspace"` with `files_changed: []` and no checkpointable produced_files yields validation error | 99/99 validator tests pass; test "rejects authoritative workspace artifact with no files_changed" confirms | 2026-04-30 | PASS |
| AC-002 | Checkpointable verification-produced files bypass empty-workspace rejection | Workspace artifact with `verification.produced_files` containing `disposition: "artifact"` entries passes Stage C | Test "allows workspace artifact with checkpointable verification-produced files" confirms | 2026-04-30 | PASS |
| AC-003 | No-edit lifecycle turns normalize workspace to review type | Empty workspace claims on human-bound no-edit turns normalize to `artifact.type: "review"` with warning | Test "warns when authoritative no-edit review turn completes with no files_changed" confirms | 2026-04-30 | PASS |
| AC-004 | Normalization must not downgrade workspace when produced files exist | `normalizeTurnResult` skips workspace→review conversion when `hasCheckpointableProducedFiles` returns true | Normalization and BUG-46 scenario tests confirm produced-file promotion path | 2026-04-30 | PASS |
| AC-005 | Existing validation and normalization behavior is preserved | All pre-existing tests continue to pass without modification | 99 validator + 32 scenario + 79 adjacent + 4 guard = 214 tests pass | 2026-04-30 | PASS |
| AC-006 | No reserved path modifications | dev changes do not touch .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json source code | git diff confirms only turn-result-validator.js, its test, and IMPLEMENTATION_NOTES.md changed | 2026-04-30 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | TALK.md lacks compressed summary structure; predates this run; dev only appended standard turn entries | Not a regression — pre-existing state issue |
