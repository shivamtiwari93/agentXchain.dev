# Acceptance Matrix — agentXchain.dev

**Run:** run_936b36c729c01f54
**Scope:** Implementation-phase completion guard — require product code changes for authoritative implementation turns

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | Implementation-phase completion requires product code changes | Completed authoritative turns in the implementation phase fail validation unless `files_changed` includes at least one product repo path (not `.planning/`, `.agentxchain/reviews/`, or `.agentxchain/staging/`) | Test "rejects completed implementation turns with no product code changes" passes | 2026-05-02 | PASS |
| AC-002 | Planning-only artifacts rejected in implementation phase | Implementation turns listing only `.planning/` paths in `files_changed` fail validation with a clear error message | Test "rejects completed implementation turns with only planning artifacts changed" passes | 2026-05-02 | PASS |
| AC-003 | Non-implementation phases unaffected | Completed authoritative turns in qa or planning phases with empty `files_changed` are NOT rejected by the implementation guard | Test "allows non-implementation workspace artifact with checkpointable verification-produced files" (phase: qa) passes | 2026-05-02 | PASS |
| AC-004 | Blocked/failed implementation turns unaffected | Implementation turns with `status: "blocked"` or `status: "failed"` are NOT subject to the product-code requirement | Validator condition checks `tr.status === 'completed'` — non-completed statuses bypass the guard by design | 2026-05-02 | PASS |
| AC-005 | `isProductChangePath` helper correctness | Returns false for `.planning/*`, `.agentxchain/reviews/*`, `.agentxchain/staging/*`, empty strings; returns true for `src/*`, `cli/*`, `tests/*` product paths | Code review: lines 788-793 of turn-result-validator.js confirm correct path filtering | 2026-05-02 | PASS |
| AC-006 | `validateArtifact` receives state | Caller passes `state` to `validateArtifact`; function signature accepts optional `state = null` | Diff confirms line 141 passes state and line 673 accepts it | 2026-05-02 | PASS |
| AC-007 | No regressions in pre-existing test suites | All pre-existing validator, adapter, schema, run-loop, and timeout tests continue to pass | 236 tests pass (100 validator + 17 staged-result + 42 adapter + 77 schema/timeout/run-loop) | 2026-05-02 | PASS |
| AC-008 | No reserved path modifications | Dev changes do not touch .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | git diff --stat confirms only 3 files changed: IMPLEMENTATION_NOTES.md, turn-result-validator.js, turn-result-validator.test.js | 2026-05-02 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed in 3 consecutive QA runs |
