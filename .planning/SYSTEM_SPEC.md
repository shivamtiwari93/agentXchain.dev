# System Spec — M8: Governed Run E2E Lifecycle via Hosted Runner

**Run:** `run_bbbb5f230a0ec907`
**Baseline:** git:1634e323 (latest checkpoint)
**Package version:** `agentxchain@2.155.73`

## Purpose

Close the M8 managed surface by proving a governed run completes end-to-end via the hosted runner. The execution worker currently executes one turn per job (`maxTurns: 1`) but never enqueues the next turn's job after completion, causing any run created via `POST /v1/projects/:id/runs` to stall after the first turn. This deliverable adds **continuation enqueue** to the execution worker and an **E2E lifecycle test** proving the full PM -> Dev -> QA cycle completes autonomously via the hosted runner API with dashboard visibility.

This is ROADMAP.md:98 — the final M8 acceptance criterion. It composes existing layers:
1. Hosted runner (`cli/src/lib/api/hosted-runner.js:400`) — `createHostedRunner(options)` with 24 routes + static file serving
2. Execution worker (`cli/src/lib/api/execution-worker.js:36`) — `createExecutionWorker(options)` with poll/execute/finalize
3. Job queue (`cli/src/lib/api/job-queue.js:43`) — `createJobQueue()` with enqueue/claim/heartbeat/finalize
4. Run loop (`cli/src/lib/run-loop.js:72`) — `runLoop(root, config, callbacks, options)` with maxTurns support
5. Org aggregator (`cli/src/lib/api/org-state-aggregator.js`) — `getOverview()`, `getRuns()`, `getRunHistory()`, `getAuditTrail()`

---

## 1. Architecture Overview

### 1.1 Current Flow (Broken After First Turn)

```
POST /v1/projects/:id/runs
  │
  ├─ createRun() → state.json with PM turn assigned
  ├─ queue.enqueue({ role: 'pm' })        ← ONLY enqueue point
  │
  ▼
Worker poll → claim job → runLoop(maxTurns: 1)
  │
  ├─ selectRole → 'pm'
  ├─ assignTurn → PM turn
  ├─ dispatch → api_proxy → staged result
  ├─ acceptTurn → phase transition gate → auto-approve → advance to implementation
  ├─ turnsExecuted=1 >= maxTurns=1 → return max_turns_reached
  │
  ▼
Worker finalize('failed') → emit event → STALL (no job for dev turn)
```

### 1.2 Fixed Flow (With Continuation Enqueue)

```
POST /v1/projects/:id/runs
  │
  ├─ createRun() → state.json with PM turn assigned
  ├─ queue.enqueue({ role: 'pm' })
  │
  ▼
Worker poll → claim PM job → runLoop(maxTurns: 1)
  ├─ PM turn dispatched, accepted, gate approved, phase → implementation
  ├─ return max_turns_reached
  ├─ finalize lease
  ├─ ★ READ FRESH STATE → active, phase=implementation, no active turns
  ├─ ★ ENQUEUE({ role: config.routing.implementation.entry_role })
  │
  ▼
Worker poll → claim Dev job → runLoop(maxTurns: 1)
  ├─ Dev turn dispatched, accepted, gate approved, phase → qa
  ├─ return max_turns_reached
  ├─ finalize lease
  ├─ ★ READ FRESH STATE → active, phase=qa, no active turns
  ├─ ★ ENQUEUE({ role: config.routing.qa.entry_role })
  │
  ▼
Worker poll → claim QA job → runLoop(maxTurns: 1)
  ├─ QA turn dispatched, accepted, run_completion_request → auto-approve → completed
  ├─ return completed (ok: true)
  ├─ finalize lease
  ├─ ★ READ FRESH STATE → completed
  ├─ ★ NO ENQUEUE (terminal state)
  │
  ▼
Run complete. Dashboard endpoints reflect the run.
```

---

## 2. Deliverables

### 2.1 Execution Worker — Add Continuation Enqueue

**Modify existing file:** `cli/src/lib/api/execution-worker.js`

#### 2.1.1 Change: Add `enqueueContinuation()` after job finalization

Insert after the `queue.finalize()` call (after line 119) and before the `emit()` call (line 121):

```javascript
// ── Continuation enqueue: if the run is still active, enqueue the next turn
enqueueContinuation(job);
```

#### 2.1.2 New function: `enqueueContinuation(job)`

Add inside the `createExecutionWorker` closure, before the `executeJob` function:

```javascript
function enqueueContinuation(job) {
  try {
    const stateFile = join(root, '.agentxchain', 'state.json');
    if (!existsSync(stateFile)) return;

    const freshState = JSON.parse(readFileSync(stateFile, 'utf8'));

    // Only continue if the run is still active
    if (freshState.status !== 'active') return;

    // Check for already-assigned active turns
    const activeTurns = freshState.active_turns
      ? Object.values(freshState.active_turns)
      : [];

    let nextRole = null;

    if (activeTurns.length > 0) {
      // Use the already-assigned turn's role
      nextRole = activeTurns[0].assigned_role;
    } else {
      // No active turns — determine entry role for the current phase
      const phaseRouting = config.routing?.[freshState.phase];
      nextRole = phaseRouting?.entry_role || null;
    }

    if (!nextRole) return;

    queue.enqueue({
      run_id: freshState.run_id,
      project_id: job.project_id,
      role: nextRole,
      runtime_class: job.runtime_class || 'api_proxy',
    });

    emit('continuation_enqueued', {
      run_id: freshState.run_id,
      phase: freshState.phase,
      role: nextRole,
    });
  } catch {
    // Continuation failure is non-fatal — run can be manually continued
  }
}
```

#### 2.1.3 Design Invariants

1. **Terminal guard:** Only enqueue when `status === 'active'` — completed, blocked, paused states stop the chain
2. **Role resolution:** Prefer already-assigned turn role; fall back to phase entry_role
3. **Non-fatal:** Caught in try/catch — continuation failure does not crash the worker or affect the completed job
4. **Idempotent:** If the continuation job fails, the worker won't create another (each job only enqueues one continuation)
5. **No new imports:** `existsSync`, `readFileSync`, `join` are already imported at lines 15-16

---

### 2.2 E2E Lifecycle Test — `cli/test/hosted-runner-e2e.test.js`

**New file.** Proves a governed run completes all 3 phases via the hosted runner with dashboard visibility.

#### 2.2.1 Test Strategy

The test uses the **real protocol stack** (createHostedRunner, createExecutionWorker, runLoop, governed-state, gate-evaluator) with a **mocked `dispatchApiProxy`** that produces valid turn results. The mock writes staged turn-result.json files that the execution worker reads back.

**Key simplification:** The test config omits the `gates` section. When `config.gates` is undefined, the gate evaluator auto-advances phase transitions and run completions (gate-evaluator.js:239-248, :354-363). This isolates the test from gate file requirements.

#### 2.2.2 Test Config

```javascript
const config = {
  schema_version: '1.0',
  protocol_mode: 'governed',
  template: 'generic',
  project: {
    id: 'e2e-test',
    name: 'E2E Lifecycle Test',
    default_branch: 'main',
  },
  roles: {
    pm: { title: 'PM', mandate: 'Plan.', write_authority: 'authoritative', runtime: 'api-mock' },
    dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'api-mock' },
    qa: { title: 'QA', mandate: 'Verify.', write_authority: 'authoritative', runtime: 'api-mock' },
  },
  runtimes: {
    'api-mock': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'MOCK_KEY' },
  },
  routing: {
    planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
    implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
    qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'human'], exit_gate: 'qa_ship_verdict' },
  },
  phases: ['planning', 'implementation', 'qa'],
  // NO gates section → gate evaluator auto-advances
};
```

#### 2.2.3 Mock Dispatch

Mock `dispatchApiProxy` at module level via `vi.mock`:

```javascript
vi.mock('../src/lib/adapters/api-proxy-adapter.js', () => ({
  dispatchApiProxy: vi.fn(),
}));
```

The mock implementation produces role-specific turn results:

```javascript
dispatchApiProxy.mockImplementation(async (root, state, config, opts) => {
  const turnId = opts.turnId;
  const turn = Object.values(state.active_turns)[0];
  const role = turn.assigned_role;
  const phase = state.phase;

  // Build turn result based on role/phase
  const turnResult = buildMockTurnResult({
    run_id: state.run_id,
    turn_id: turnId,
    role,
    phase,
    runtime_id: 'api-mock',
  });

  // Write to staging path (execution worker reads this back)
  const stagingDir = join(root, '.agentxchain', 'staging', turnId);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(turnResult));

  return { ok: true };
});
```

**`buildMockTurnResult` function:**

```javascript
function buildMockTurnResult({ run_id, turn_id, role, phase, runtime_id }) {
  const base = {
    schema_version: '1.0',
    run_id,
    turn_id,
    role,
    runtime_id,
    status: 'completed',
    summary: `${role} completed ${phase}`,
    decisions: [],
    objections: [],
    files_changed: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'Mock pass', machine_evidence: [] },
    artifact: { type: 'review', ref: 'git:dirty' },
    proposed_next_role: null,
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  if (role === 'pm' && phase === 'planning') {
    base.proposed_next_role = 'dev';
    base.phase_transition_request = 'implementation';
  } else if (role === 'dev' && phase === 'implementation') {
    base.proposed_next_role = 'qa';
    base.phase_transition_request = 'qa';
  } else if (role === 'qa' && phase === 'qa') {
    base.proposed_next_role = 'human';
    base.run_completion_request = true;
  }

  return base;
}
```

#### 2.2.4 Poll-Until-Complete Helper

```javascript
async function pollUntilTerminal(root, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stateFile = join(root, '.agentxchain', 'state.json');
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (state.status === 'completed' || state.status === 'blocked') {
        return state;
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for run to complete');
}
```

#### 2.2.5 Test Cases

| # | Test ID | Description | Assertion |
|---|---------|-------------|-----------|
| T1 | AT-E2E-001 | Full lifecycle: PM -> Dev -> QA -> completed | Create run via POST, poll until completed, assert state.status==='completed' |
| T2 | AT-E2E-002 | All 3 phases executed | Final state has phase_gate_status with all 3 gates passed (or auto-advanced) |
| T3 | AT-E2E-003 | Execution worker dispatched 3 turns | dispatchApiProxy called 3 times (once per role: pm, dev, qa) |
| T4 | AT-E2E-004 | Continuation enqueue created 2 follow-up jobs | After PM job: dev job enqueued; after Dev job: qa job enqueued; after QA: no enqueue |
| T5 | AT-E2E-005 | Dashboard visibility: GET /v1/org/runs reflects completed run | GET /v1/org/runs returns data including the completed run |
| T6 | AT-E2E-006 | Health endpoint available throughout | GET /health returns 200 with status: 'ok' |

#### 2.2.6 Test Setup and Teardown

```javascript
let project, runner, port;

beforeEach(async () => {
  project = createE2EProject();  // temp dir with agentxchain.json + .agentxchain/staging/
  port = 10000 + Math.floor(Math.random() * 50000);
  const normalizedConfig = loadTestConfig(project.dir);

  runner = createHostedRunner({
    root: project.dir,
    config: normalizedConfig,
    port,
    host: '127.0.0.1',
  });

  await runner.start();
});

afterEach(async () => {
  if (runner) await runner.stop();
});
```

---

## 3. Integration Points

### 3.1 Execution Worker → State File

The continuation enqueue reads `.agentxchain/state.json` directly (not via `loadState()` from config.js) to avoid importing additional modules. The worker already imports `readFileSync`, `existsSync`, and `join` (execution-worker.js:15-16). The state file path is well-known and stable.

### 3.2 Execution Worker → Job Queue

The `queue` instance is already available in the `createExecutionWorker` closure (execution-worker.js:40). The `queue.enqueue()` API accepts `{ run_id, project_id, role, runtime_class }` (job-queue.js:43-58).

### 3.3 Execution Worker → Config Routing

The `config` object is already available in the closure (execution-worker.js:39). `config.routing[phase].entry_role` provides the role for newly transitioned phases.

### 3.4 Hosted Runner → Org Aggregator

The E2E test exercises `/v1/org/runs` (hosted-runner.js:259-262) which calls `aggregator.getRuns()` (org-state-aggregator.js). The run's state is read from `.agentxchain/run-history.jsonl` or the primary project root, providing dashboard visibility.

---

## 4. Files Changed (Expected)

| File | Change Type | LOC | Description |
|------|-------------|-----|-------------|
| `cli/src/lib/api/execution-worker.js` | **Modify** | ~35 | Add `enqueueContinuation()` function + call site after job finalization |
| `cli/test/hosted-runner-e2e.test.js` | **Create** | ~250 | 6 E2E lifecycle tests with mocked dispatch |

1 modified file, 1 new file. Vitest contract file count increases from 671 to 672.

---

## 5. Key Architecture Invariants

1. **No hosted-runner.js changes.** The route table, server factory, and static file serving are untouched. The only production change is in execution-worker.js.
2. **No run-loop.js changes.** The runLoop's `maxTurns: 1` behavior is correct. The gap was in the caller (execution worker), not the loop.
3. **No state machine changes.** governed-state.js, gate-evaluator.js, and approval-policy.js are untouched.
4. **Terminal guard prevents infinite loops.** Continuation only fires when `state.status === 'active'`. Completed/blocked/paused states stop the chain.
5. **Gate-free test config.** The E2E test omits `gates` from config so gate evaluator auto-advances. This isolates the lifecycle test from gate file content validation (tested extensively in workflow-gate-semantics.test.js).
6. **Mocked dispatch, real protocol.** `dispatchApiProxy` is mocked but all protocol machinery (state machine, acceptance, phase transitions, run completion) runs for real.

---

## Interface

### Continuation Enqueue Data Flow

```
executeJob(job, lease)
  │
  ├─ runLoop(maxTurns: 1) → result
  ├─ queue.finalize(lease)
  │
  ▼
enqueueContinuation(job)
  │
  ├─ readFileSync('.agentxchain/state.json')
  ├─ if status !== 'active' → return (terminal guard)
  │
  ├─ if active_turns exist → nextRole = activeTurns[0].assigned_role
  ├─ else → nextRole = config.routing[phase].entry_role
  │
  ├─ queue.enqueue({ run_id, project_id, role: nextRole, runtime_class })
  ├─ emit('continuation_enqueued', { run_id, phase, role })
  │
  ▼
Worker poll() → claims new job → executeJob → ... → cycle continues
```

---

## Dev Charter

### Scope

**1 modified file + 1 new test file: continuation enqueue + E2E lifecycle test.**

1. `cli/src/lib/api/execution-worker.js` — Add `enqueueContinuation(job)` function + call after `queue.finalize()` in `executeJob`
2. `cli/test/hosted-runner-e2e.test.js` — 6 E2E tests proving full PM -> Dev -> QA lifecycle via hosted runner

### Out of Scope

- Changes to hosted-runner.js, run-loop.js, governed-state.js, gate-evaluator.js
- Changes to job-queue.js, protocol-bridge.js, api-proxy-adapter.js
- Changes to any dashboard component or dashboard app
- Multi-worker or multi-project scenarios
- Retry/recovery after failed turns
- Real API calls or cloud provider integration

### Verification

Dev must confirm:
1. E2E test: POST /v1/projects/:id/runs creates a run
2. E2E test: Worker dispatches PM turn, then auto-enqueues dev turn
3. E2E test: Worker dispatches Dev turn, then auto-enqueues qa turn
4. E2E test: Worker dispatches QA turn, run reaches status=completed
5. E2E test: GET /v1/org/runs shows the completed run
6. E2E test: dispatchApiProxy called exactly 3 times
7. Continuation enqueue has terminal guard (no enqueue when status !== 'active')
8. All 6 E2E tests pass
9. Vitest contract passes with 672 files
10. Existing hosted-runner.test.js passes (no regressions)
11. No existing tests broken

## Acceptance Tests

- [ ] AT-E2E-001: Full lifecycle PM -> Dev -> QA -> completed via hosted runner
- [ ] AT-E2E-002: All 3 phases executed (gate statuses reflect passage)
- [ ] AT-E2E-003: Execution worker dispatched exactly 3 turns
- [ ] AT-E2E-004: Continuation enqueue created 2 follow-up jobs (dev after PM, qa after Dev)
- [ ] AT-E2E-005: Dashboard visibility: GET /v1/org/runs reflects completed run
- [ ] AT-E2E-006: Health endpoint available throughout lifecycle
