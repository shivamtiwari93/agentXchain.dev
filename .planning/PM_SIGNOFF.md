# PM Signoff — M8: Governed Run E2E Lifecycle via Hosted Runner

Approved: YES

**Run:** `run_bbbb5f230a0ec907`
**Phase:** planning
**Turn:** `turn_f189486acf68c900`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators deploying the **hosted runner** (`agentxchain serve`) to manage governed runs via the control plane API. These operators expect a run created via `POST /v1/projects/:id/runs` to execute the full PM -> Dev -> QA lifecycle autonomously, with each turn auto-dispatched by the execution worker and results visible through the org dashboard.

### Core Pain Point

The hosted runner (`ROADMAP.md:95`, run_0937d8f23ff72791) executes governed turns via the execution worker, but has a **critical lifecycle gap**: the worker runs `maxTurns: 1` per job, and after each job completes, **no one enqueues the next turn's job**.

**Current flow (broken):**
1. `POST /v1/projects/:id/runs` creates a run, enqueues job for the first turn (hosted-runner.js:92)
2. Execution worker claims job, executes one turn via runLoop (maxTurns: 1)
3. runLoop accepts the turn, auto-approves phase transition gate, state machine assigns next turn
4. runLoop returns `max_turns_reached` (turnsExecuted=1 >= maxTurns=1)
5. Worker finalizes the lease -> **STALLS** (no job enqueued for the newly assigned turn)

**Result:** A governed run created via the hosted runner API executes exactly one turn and then freezes. The acceptance criterion "a governed run completes via the hosted runner" is **impossible** with the current code.

**Evidence:**
- `execution-worker.js:114` — `{ maxTurns: 1 }` limits each job to one turn
- `execution-worker.js:116-128` — After job completes, only emits events and finalizes lease; no state check or re-enqueue
- `hosted-runner.js:86-98` — Only the `POST /runs` route enqueues a job; no other code path creates jobs

### Challenge to Previous Turn

#### OBJ-PM-001: Planning artifacts still describe persistent run history (run_b2a4084d6b3fe3b3, ROADMAP.md:97) — this run targets ROADMAP.md:98 (severity: high)

All three planning artifacts were written for ROADMAP.md:97 — "Persistent run history and governance audit trail":
- PM_SIGNOFF.md scoped getRunHistory + getAuditTrail + 2 routes + 2 dashboard components + 8 tests
- SYSTEM_SPEC.md described org-state-aggregator modifications, hosted-runner route additions, dashboard components
- ROADMAP.md phases table shows run_b2a4084d6b3fe3b3 implementation phases

This run targets ROADMAP.md:98 — "Acceptance: a governed run completes via the hosted runner with dashboard visibility." All three artifacts rewritten from scratch.

#### OBJ-PM-002: ROADMAP.md:97 still unchecked despite QA ship verdict YES (severity: medium)

ROADMAP.md:97 ("Persistent run history and governance audit trail") was completed in run_b2a4084d6b3fe3b3:
- QA ship verdict YES (turn_2f903c5a3d12867f): "8/8 acceptance criteria, 132 tests across 6 files, 0 failures"
- Dev delivered: getRunHistory, getAuditTrail, 2 routes, 2 dashboard components, 8 integration tests

The checkbox remains `[ ]` in ROADMAP.md. This turn checks it off based on QA-verified evidence.

### Core Workflow (this run)

1. **PM (this turn)** — Scope continuation enqueue in execution-worker.js + E2E lifecycle test; check off ROADMAP.md:97
2. **Dev** — Implement continuation enqueue (~15 LOC), E2E lifecycle test with mocked dispatch
3. **QA** — Verify E2E test passes, verify continuation enqueue is correct, run full test suite, check off ROADMAP.md:98

### MVP Scope (this run)

**This run scopes ROADMAP.md:98 — "Acceptance: a governed run completes via the hosted runner with dashboard visibility."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, gap analysis, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec for continuation enqueue + E2E lifecycle test
3. ROADMAP.md: Check off :97, update phases table for :98

**Dev deliverables:**
1. `cli/src/lib/api/execution-worker.js` — **Modify** to add continuation enqueue: after each job completes, read fresh state and enqueue the next waiting turn
2. `cli/test/hosted-runner-e2e.test.js` — **New** E2E lifecycle test: create run via API -> worker executes PM -> auto-continues Dev -> auto-continues QA -> run completes -> org endpoints reflect results

### Out of Scope

- Changes to hosted-runner.js (no route changes needed)
- Changes to run-loop.js, governed-state.js, or any state machine code
- Changes to job-queue.js (enqueue API is sufficient as-is)
- Changes to protocol-bridge.js or api-proxy-adapter.js
- Changes to any dashboard component (dashboard visibility is already delivered via :96 + :97)
- Multi-project E2E scenarios (single-project lifecycle is sufficient for acceptance)
- Real API calls to cloud providers (mocked dispatch is standard for tests)
- Changes to the `serve` command or CLI entry point
- Retry/recovery after failed turns (existing retry infrastructure is unchanged)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP | ROADMAP.md:98 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: Acceptance: a governed run completes via the hosted runner with dashboard visibility | E2E test proves: POST /v1/projects/:id/runs -> worker auto-dispatches PM, Dev, QA turns -> run status=completed -> GET /v1/org/runs shows the run |
| 3 | Evidence source: .planning/ROADMAP.md:98 | ROADMAP.md:98 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Continuation enqueue creates infinite loops if state never reaches terminal | Low | Only enqueue when state.status === 'active' AND there are active turns with status !== 'running'; terminal states (completed/blocked) stop the chain |
| E2E test timing sensitivity (worker poll interval vs test assertions) | Medium | Use short poll interval (50ms) in test; poll state until terminal or timeout |
| Gate file requirements block phase transitions in test | Medium | Pre-create minimal gate files (.planning/PM_SIGNOFF.md, .planning/IMPLEMENTATION_NOTES.md, acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) in temp dir |
| Mock dispatch must produce schema-valid turn results | Low | Use existing turn-result schema from tests; include all required fields |

### Design Decision: Continuation Enqueue in Execution Worker (DEC-001)

After each job completion (successful or max_turns_reached), the execution worker reads the fresh state from disk and enqueues a new job if there is a waiting active turn. This creates an automatic continuation chain: PM job -> Dev job -> QA job -> completion.

Rationale:
1. **Locality** — The worker already has access to `queue`, `root`, and the job's `project_id`; reading state + calling `queue.enqueue()` is ~10 lines
2. **No new modules** — No scheduler, no watcher, no event bus needed
3. **Idempotent** — If the state has no active turns (terminal state), nothing is enqueued; if the worker restarts, it picks up from the queue
4. **Composable** — Future multi-worker scaling only requires the same enqueue pattern; no central coordinator needed

### Design Decision: E2E Test Uses Mocked Dispatch With Real Protocol Machinery (DEC-002)

The E2E lifecycle test mocks `dispatchApiProxy` at the module level but exercises the real protocol stack: createRun, runLoop, governed-state acceptance, phase transitions, gate evaluation. This proves the full lifecycle is functional without requiring cloud API credentials.

Rationale:
1. **Protocol parity** — Real state machine, real gate evaluation, real run-history recording
2. **Deterministic** — Mocked dispatch produces predictable turn results for each role
3. **CI-safe** — No network calls, no API keys, runs in any environment
4. **Sufficient** — The acceptance criterion is "a governed run completes via the hosted runner"; the mock dispatch simulates the cloud agent's contribution

### Design Decision: Check Off ROADMAP.md:97 Based on Prior QA Evidence (DEC-003)

ROADMAP.md:97 is checked off in this turn based on the QA ship verdict YES from run_b2a4084d6b3fe3b3 (turn_2f903c5a3d12867f, 8/8 acceptance criteria, 132 tests, 0 failures). The previous QA turn did not check it off (likely because QA only writes .qa artifacts, not ROADMAP.md).

## Notes for Dev

**Your charter is 1 modified file + 1 new test file (2 total).**

See SYSTEM_SPEC.md for full technical details including:
- Exact insertion point for continuation enqueue in execution-worker.js
- E2E test setup (temp dir, gate files, mock dispatch, poll-until-complete)
- Turn result schemas for PM, Dev, QA mocked responses
- 6 acceptance test IDs (AT-E2E-001 through AT-E2E-006)

## Notes for QA

- Verify the E2E test passes: `cd cli && npx vitest run test/hosted-runner-e2e.test.js`
- Verify continuation enqueue doesn't create infinite loops (check for terminal state guard)
- Verify existing hosted-runner.test.js still passes (no regressions)
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:98 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP** — ROADMAP.md:98 scoped with planning artifacts; continuation enqueue + E2E test prove the managed surface delivers end-to-end governed runs
2. **Unchecked roadmap item completed: Acceptance: a governed run completes via the hosted runner with dashboard visibility** — E2E lifecycle test creates a run via POST /v1/projects/:id/runs, execution worker auto-dispatches all 3 phase turns via continuation enqueue, run reaches status=completed, org dashboard endpoints return the run's data
3. **Evidence source: .planning/ROADMAP.md:98** — ROADMAP.md:98 checked off after QA full suite verification

## API Map

No new API routes. Existing routes exercised by E2E test:

| Route | Method | Role in E2E Test |
|-------|--------|-----------------|
| `/v1/projects/:proj_id/runs` | POST | Creates run, enqueues first turn |
| `/v1/runs/:run_id` | GET | Poll until status=completed |
| `/v1/org/runs` | GET | Verify run appears in org view |
| `/health` | GET | Verify server is running |
