import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');
const missionPlansPath = join(cliRoot, 'src', 'lib', 'mission-plans.js');

// ── Fixture helpers ──────────────────────────────────────────────────────────

function createTmpDir() {
  const dir = join(tmpdir(), `axc-coord-retry-e2e-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentxchainJson(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'coord-retry', id: 'coord-retry', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
    ...overrides,
  };
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
}

function writeGovernedState(dir, overrides = {}) {
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  const state = {
    schema_version: '1.1',
    project_id: overrides.project_id || 'fixture-project',
    run_id: null,
    status: 'idle',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    ...overrides,
  };
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
}

function createRepoFixture(parentDir, repoId) {
  const repoDir = join(parentDir, repoId);
  mkdirSync(repoDir, { recursive: true });
  writeAgentxchainJson(repoDir, { project: { name: repoId, id: repoId, default_branch: 'main' } });
  writeGovernedState(repoDir, { project_id: repoId });
  return repoDir;
}

function writeCoordinatorConfig(workspaceDir, repos) {
  const config = {
    schema_version: '0.1',
    project: { id: 'multi-retry-project', name: 'Multi Retry Project' },
    repos: Object.fromEntries(
      Object.entries(repos).map(([repoId, repoDir]) => [repoId, { path: repoDir, required: true }]),
    ),
    workstreams: {
      'ws-main': {
        repos: ['repo-a', 'repo-b'],
        entry_repo: 'repo-a',
        phase: 'implementation',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      'ws-followup': {
        repos: ['repo-a'],
        entry_repo: 'repo-a',
        phase: 'implementation',
        depends_on: ['ws-main'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    workstream_order: ['ws-main', 'ws-followup'],
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'done',
      },
    },
    gates: { done: {} },
  };
  writeFileSync(join(workspaceDir, 'agentxchain-multi.json'), JSON.stringify(config, null, 2));
  return config;
}

function writeMissionArtifact(dir, { missionId, coordinator }) {
  const missionsDir = join(dir, '.agentxchain', 'missions');
  mkdirSync(missionsDir, { recursive: true });
  const now = new Date().toISOString();
  const artifact = {
    mission_id: missionId,
    title: 'Coordinator Retry Mission',
    goal: 'Prove coordinator retry drives full recovery with dependent unblock',
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
    coordinator,
  };
  writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(artifact, null, 2));
  return artifact;
}

function planOutput() {
  return {
    workstreams: [
      {
        workstream_id: 'ws-main',
        title: 'Main coordinated rollout',
        goal: 'Dispatch and accept both repos',
        roles: ['dev'],
        phases: ['implementation'],
        depends_on: [],
        acceptance_checks: ['Both repos accepted'],
      },
      {
        workstream_id: 'ws-followup',
        title: 'Follow-up work',
        goal: 'Runs after the coordinated rollout completes',
        roles: ['dev'],
        phases: ['implementation'],
        depends_on: ['ws-main'],
        acceptance_checks: ['Follow-up repo can start'],
      },
    ],
  };
}

function appendAcceptanceProjection(workspaceDir, repoId, workstreamId, repoTurnId) {
  appendFileSync(
    join(workspaceDir, '.agentxchain', 'multirepo', 'history.jsonl'),
    `${JSON.stringify({
      type: 'acceptance_projection',
      timestamp: new Date().toISOString(),
      repo_id: repoId,
      workstream_id: workstreamId,
      repo_turn_id: repoTurnId,
      summary: `${repoId} accepted`,
    })}\n`,
  );
}

function setBarrierSatisfied(workspaceDir, workstreamId, repoIds) {
  const barrierPath = join(workspaceDir, '.agentxchain', 'multirepo', 'barriers.json');
  const barriers = JSON.parse(readFileSync(barrierPath, 'utf8'));
  barriers[`${workstreamId}_completion`].status = 'satisfied';
  barriers[`${workstreamId}_completion`].satisfied_repos = [...repoIds];
  writeFileSync(barrierPath, JSON.stringify(barriers, null, 2));
}

function recordAcceptedRepoTurn(repoDir, turnId) {
  const statePath = join(repoDir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  delete state.active_turns[turnId];
  state.accepted_count = (state.accepted_count || 0) + 1;
  state.updated_at = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  appendFileSync(
    join(repoDir, '.agentxchain', 'history.jsonl'),
    `${JSON.stringify({
      turn_id: turnId,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      summary: `${turnId} accepted`,
    })}\n`,
  );
}

function recordFailedRepoTurn(repoDir, turnId) {
  const statePath = join(repoDir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.active_turns[turnId]) {
    state.active_turns[turnId].status = 'failed';
    state.active_turns[turnId].failure_reason = 'execution_failed';
    state.active_turns[turnId].updated_at = new Date().toISOString();
  }
  state.updated_at = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ── Command runner helpers ──────────────────────────────────────────────────

async function runCoordinatorAutopilot(planId, opts) {
  const { missionPlanAutopilotCommand } = await import(missionCommandPath);
  const output = [];
  const errors = [];
  let exitCode = null;

  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = (...args) => { output.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error('__EXIT__');
  };

  try {
    await missionPlanAutopilotCommand(planId, opts);
  } catch (error) {
    if (error.message !== '__EXIT__') throw error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return { exitCode, output, errors, parsed: opts.json ? JSON.parse(output.join('')) : null };
}

async function runLaunchRetry(planId, opts) {
  const { missionPlanLaunchCommand } = await import(missionCommandPath);
  const output = [];
  const errors = [];
  let exitCode = null;

  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = (...args) => { output.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error('__EXIT__');
  };

  try {
    await missionPlanLaunchCommand(planId, opts);
  } catch (error) {
    if (error.message !== '__EXIT__') throw error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return { exitCode, output, errors, parsed: opts.json ? JSON.parse(output.join('')) : null };
}

// ── Lifecycle tracking ──────────────────────────────────────────────────────

let tempDirs = [];
beforeEach(() => { tempDirs = []; });
afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function trackDir(dir) {
  tempDirs.push(dir);
  return dir;
}

// ── Setup ───────────────────────────────────────────────────────────────────

async function setupCoordinatorMission() {
  const workspace = trackDir(createTmpDir());
  writeAgentxchainJson(workspace);

  const repoA = createRepoFixture(workspace, 'repo-a');
  const repoB = createRepoFixture(workspace, 'repo-b');
  writeCoordinatorConfig(workspace, { 'repo-a': repoA, 'repo-b': repoB });

  const { initializeCoordinatorRun } = await import('../src/lib/coordinator-state.js');
  const { loadCoordinatorConfig } = await import('../src/lib/coordinator-config.js');
  const { loadProjectContext } = await import('../src/lib/config.js');
  const { initializeGovernedRun } = await import('../src/lib/governed-state.js');
  const { createPlanArtifact, approvePlanArtifact } = await import('../src/lib/mission-plans.js');

  const workspaceContext = loadProjectContext(workspace);
  assert.ok(workspaceContext, 'workspace context must load');
  assert.ok(initializeGovernedRun(workspace, workspaceContext.config).ok, 'workspace run must initialize');

  const repoAContext = loadProjectContext(repoA);
  assert.ok(repoAContext, 'repo-a context must load');
  assert.ok(initializeGovernedRun(repoA, repoAContext.config).ok, 'repo-a run must initialize');

  const repoBContext = loadProjectContext(repoB);
  assert.ok(repoBContext, 'repo-b context must load');
  assert.ok(initializeGovernedRun(repoB, repoBContext.config).ok, 'repo-b run must initialize');

  const loadedConfig = loadCoordinatorConfig(workspace);
  assert.ok(loadedConfig.ok, `Coordinator config must load: ${JSON.stringify(loadedConfig.errors)}`);
  const coordinatorConfig = loadedConfig.config;

  const init = initializeCoordinatorRun(workspace, coordinatorConfig);
  assert.ok(init.ok, `Coordinator init must succeed: ${JSON.stringify(init.errors)}`);

  const mission = writeMissionArtifact(workspace, {
    missionId: 'mission-coord-retry',
    coordinator: {
      super_run_id: init.super_run_id,
      config_path: './agentxchain-multi.json',
      workspace_path: workspace,
    },
  });

  const created = createPlanArtifact(workspace, mission, {
    plannerOutput: planOutput(),
    coordinatorConfig,
  });
  assert.ok(created.ok, `Plan creation must succeed: ${JSON.stringify(created.errors)}`);

  const approved = approvePlanArtifact(workspace, mission.mission_id, created.plan.plan_id);
  assert.ok(approved.ok, `Plan approval must succeed: ${approved.error}`);

  return {
    workspace,
    repoA,
    repoB,
    mission,
    planId: approved.plan.plan_id,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Coordinator retry end-to-end', () => {
  it('AT-COORD-RETRY-E2E-001: autopilot failure → operator retry → acceptance → dependent workstream unblocked', async () => {
    const setup = await setupCoordinatorMission();
    const dispatches = [];

    // ─── Phase 1: Run autopilot. repo-a succeeds, repo-b fails. ─────────
    const autopilotResult = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
      continueOnFailure: false,
      _sleep: async () => {},
      _executeGovernedRun: async (repoContext, runOpts) => {
        const trigger = runOpts?.provenance?.trigger_reason || '';
        const repoMatch = trigger.match(/repo:([^ ]+)/);
        const workstreamMatch = trigger.match(/workstream:([^ ]+)/);
        assert.ok(repoMatch, `repo id must be present in provenance: ${trigger}`);
        assert.ok(workstreamMatch, `workstream id must be present in provenance: ${trigger}`);

        const repoId = repoMatch[1];
        const workstreamId = workstreamMatch[1];
        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        assert.ok(turnId, `active turn must exist for ${repoId}/${workstreamId}`);

        dispatches.push({ repo_id: repoId, workstream_id: workstreamId, turn_id: turnId });

        if (repoId === 'repo-a') {
          // repo-a succeeds
          recordAcceptedRepoTurn(repoContext.root, turnId);
          appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
          return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
        }

        // repo-b fails
        recordFailedRepoTurn(repoContext.root, turnId);
        return { exitCode: 1, result: { ok: false, stop_reason: 'failed', turns_executed: 1 } };
      },
    });

    // Verify autopilot stopped on failure
    assert.equal(autopilotResult.exitCode, 1, 'autopilot must exit with code 1 on failure');
    assert.equal(
      autopilotResult.parsed.summary.terminal_reason,
      'failure_stopped',
      'autopilot must stop with failure_stopped',
    );

    // Verify both repos were dispatched: repo-a (wave 1), repo-b (wave 2)
    assert.ok(
      dispatches.some((d) => d.repo_id === 'repo-a' && d.workstream_id === 'ws-main'),
      'repo-a must have been dispatched for ws-main',
    );
    assert.ok(
      dispatches.some((d) => d.repo_id === 'repo-b' && d.workstream_id === 'ws-main'),
      'repo-b must have been dispatched for ws-main',
    );

    // Capture the failed turn ID for repo-b
    const failedDispatch = dispatches.find((d) => d.repo_id === 'repo-b');
    const failedTurnId = failedDispatch.turn_id;

    // Verify plan state shows ws-main as needs_attention
    const missionPlans = await import(missionPlansPath);
    const planAfterFailure = missionPlans.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    const wsMainAfterFailure = planAfterFailure.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    assert.equal(wsMainAfterFailure.launch_status, 'needs_attention', 'ws-main must be needs_attention after repo-b failure');

    // ws-followup must still be blocked (depends on ws-main)
    const wsFollowupAfterFailure = planAfterFailure.workstreams.find((ws) => ws.workstream_id === 'ws-followup');
    assert.equal(wsFollowupAfterFailure.launch_status, 'blocked', 'ws-followup must still be blocked');

    // ─── Phase 2: Operator retries ws-main. repo-b succeeds on retry. ───
    const retryResult = await runLaunchRetry(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      workstream: 'ws-main',
      retry: true,
      json: true,
      _executeGovernedRun: async (repoContext, runOpts) => {
        // This must be the retried repo-b execution
        const trigger = runOpts?.provenance?.trigger_reason || '';
        assert.match(trigger, /coordinator-retry/, 'provenance must indicate coordinator-retry');
        assert.match(trigger, /repo-b/, 'retried repo must be repo-b');

        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        assert.ok(turnId, 'retried turn must exist');
        assert.notEqual(turnId, failedTurnId, 'retried turn must have a new ID');

        dispatches.push({ repo_id: 'repo-b', workstream_id: 'ws-main', turn_id: turnId, is_retry: true });

        // This time repo-b succeeds — record acceptance and satisfy the ws-main barrier
        recordAcceptedRepoTurn(repoContext.root, turnId);
        appendAcceptanceProjection(setup.workspace, 'repo-b', 'ws-main', turnId);
        setBarrierSatisfied(setup.workspace, 'ws-main', ['repo-a', 'repo-b']);

        return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
      },
    });

    // Retry command must succeed
    assert.ok(
      retryResult.exitCode === null || retryResult.exitCode === 0,
      `retry must exit cleanly, got ${retryResult.exitCode}`,
    );

    const retryParsed = retryResult.parsed;
    assert.ok(retryParsed, 'retry must produce JSON output');
    assert.equal(retryParsed.retry, true, 'output must indicate retry');
    assert.equal(retryParsed.dispatch_mode, 'coordinator', 'dispatch mode must be coordinator');
    assert.equal(retryParsed.workstream_id, 'ws-main', 'workstream must be ws-main');
    assert.equal(retryParsed.repo_id, 'repo-b', 'retried repo must be repo-b');
    assert.equal(retryParsed.retried_repo_turn_id, failedTurnId, 'retried_repo_turn_id must reference the failed turn');
    assert.ok(retryParsed.repo_turn_id, 'new repo_turn_id must be present');
    assert.notEqual(retryParsed.repo_turn_id, failedTurnId, 'new turn ID must differ from the failed one');

    // ─── Phase 3: Verify plan state after retry. ────────────────────────

    // Re-synchronize plan state so workstream statuses reflect the retry acceptance
    const { loadCoordinatorConfig } = await import('../src/lib/coordinator-config.js');
    const { synchronizeCoordinatorPlanState } = await import(missionPlansPath);
    const loadedConfig = loadCoordinatorConfig(setup.workspace);
    assert.ok(loadedConfig.ok, 'coordinator config must load for verification');

    const planAfterRetryRaw = missionPlans.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    const synced = synchronizeCoordinatorPlanState(setup.workspace, setup.mission, planAfterRetryRaw);
    const planAfterRetry = synced.ok ? synced.plan : planAfterRetryRaw;

    // ws-main must be completed (both repos accepted, barrier satisfied)
    const wsMainAfterRetry = planAfterRetry.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    assert.equal(wsMainAfterRetry.launch_status, 'completed', 'ws-main must be completed after retry acceptance');

    // ws-followup must now be ready (dependency ws-main is completed)
    const wsFollowupAfterRetry = planAfterRetry.workstreams.find((ws) => ws.workstream_id === 'ws-followup');
    assert.equal(wsFollowupAfterRetry.launch_status, 'ready', 'ws-followup must be ready after ws-main completes');

    // ─── Phase 4: Verify launch record retry metadata. ──────────────────

    const mainLaunchRecord = planAfterRetry.launch_records.find(
      (record) => record.workstream_id === 'ws-main' && record.dispatch_mode === 'coordinator',
    );
    assert.ok(mainLaunchRecord, 'ws-main coordinator launch record must exist');

    // Must have 3 repo dispatches: repo-a initial, repo-b initial, repo-b retry
    assert.equal(mainLaunchRecord.repo_dispatches.length, 3, 'must have 3 repo dispatches (a initial, b initial, b retry)');

    const repoADispatch = mainLaunchRecord.repo_dispatches.find((d) => d.repo_id === 'repo-a');
    assert.ok(repoADispatch, 'repo-a dispatch must exist');
    assert.ok(!repoADispatch.is_retry, 'repo-a dispatch must not be a retry');

    const repoBInitial = mainLaunchRecord.repo_dispatches.find(
      (d) => d.repo_id === 'repo-b' && !d.is_retry,
    );
    assert.ok(repoBInitial, 'repo-b initial dispatch must exist');
    assert.ok(repoBInitial.retried_at, 'repo-b initial dispatch must have retried_at timestamp');
    assert.equal(repoBInitial.retry_reason, 'failed', 'repo-b initial dispatch retry_reason must be "failed"');

    const repoBRetry = mainLaunchRecord.repo_dispatches.find(
      (d) => d.repo_id === 'repo-b' && d.is_retry === true,
    );
    assert.ok(repoBRetry, 'repo-b retry dispatch must exist');
    assert.equal(repoBRetry.retry_of, repoBInitial.repo_turn_id, 'retry dispatch must reference the original failed turn');

    // ─── Phase 5: Verify coordinator_retry event was emitted. ───────────

    const eventsPath = join(setup.workspace, '.agentxchain', 'events.jsonl');
    assert.ok(existsSync(eventsPath), 'events.jsonl must exist');
    const events = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const retryEvents = events.filter((e) => e.event_type === 'coordinator_retry');
    assert.ok(retryEvents.length >= 1, 'at least one coordinator_retry event must be emitted');

    const retryEvent = retryEvents[0];
    assert.equal(retryEvent.payload.workstream_id, 'ws-main', 'retry event workstream must be ws-main');
    assert.equal(retryEvent.payload.repo_id, 'repo-b', 'retry event repo must be repo-b');
    assert.equal(retryEvent.payload.failed_turn_id, failedTurnId, 'retry event must reference the failed turn');
    assert.ok(retryEvent.payload.reissued_turn_id, 'retry event must have reissued_turn_id');
    assert.equal(retryEvent.payload.retry_count, 1, 'retry_count must be 1');

    // ─── Phase 6: Verify coordinator history has a retry entry. ─────────

    const historyPath = join(setup.workspace, '.agentxchain', 'multirepo', 'history.jsonl');
    assert.ok(existsSync(historyPath), 'coordinator history must exist');
    const history = readFileSync(historyPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const retryHistoryEntries = history.filter((h) => h.type === 'coordinator_retry');
    assert.ok(retryHistoryEntries.length >= 1, 'coordinator history must have a retry entry');

    // ─── Phase 7: Verify decision ledger has a retry record. ────────────

    const ledgerPath = join(setup.workspace, '.agentxchain', 'multirepo', 'decision-ledger.jsonl');
    assert.ok(existsSync(ledgerPath), 'coordinator decision ledger must exist');
    const ledger = readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const retryLedgerEntries = ledger.filter((l) => l.category === 'retry');
    assert.ok(retryLedgerEntries.length >= 1, 'decision ledger must have a retry entry');
  });

  it('AT-COORD-RETRY-E2E-003/007: coordinator autopilot auto-retries a failed repo and completes the dependent plan', async () => {
    const setup = await setupCoordinatorMission();
    const repoAttempts = new Map();

    const autopilotResult = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
      autoRetry: true,
      maxRetries: '1',
      continueOnFailure: false,
      _sleep: async () => {},
      _executeGovernedRun: async (repoContext, runOpts) => {
        const trigger = runOpts?.provenance?.trigger_reason || '';
        const repoId = trigger.match(/repo:([^ ]+)/)?.[1];
        const workstreamId = trigger.match(/workstream:([^ ]+)/)?.[1];
        assert.ok(repoId, `repo id must be present in provenance: ${trigger}`);
        assert.ok(workstreamId, `workstream id must be present in provenance: ${trigger}`);

        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        assert.ok(turnId, `active turn must exist for ${repoId}/${workstreamId}`);

        const attemptKey = `${workstreamId}:${repoId}`;
        const attempt = (repoAttempts.get(attemptKey) || 0) + 1;
        repoAttempts.set(attemptKey, attempt);

        if (repoId === 'repo-a') {
          recordAcceptedRepoTurn(repoContext.root, turnId);
          appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
          if (workstreamId === 'ws-followup') {
            setBarrierSatisfied(setup.workspace, 'ws-followup', ['repo-a']);
          }
          return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
        }

        if (attempt === 1) {
          recordFailedRepoTurn(repoContext.root, turnId);
          return { exitCode: 1, result: { ok: false, stop_reason: 'failed', turns_executed: 1 } };
        }

        assert.match(trigger, /auto-retry/, 'retry attempt provenance must include auto-retry');
        recordAcceptedRepoTurn(repoContext.root, turnId);
        appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
        setBarrierSatisfied(setup.workspace, 'ws-main', ['repo-a', 'repo-b']);
        return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
      },
    });

    assert.equal(
      autopilotResult.exitCode,
      null,
      `autopilot with auto-retry must complete cleanly, got ${autopilotResult.exitCode}`,
    );
    assert.equal(autopilotResult.parsed.summary.terminal_reason, 'plan_completed');
    assert.equal(autopilotResult.parsed.summary.total_retries, 1, 'exactly one auto-retry must be recorded');

    const allWaveEntries = autopilotResult.parsed.waves.flatMap((wave) => wave.results);
    const wsMainRetryEntry = allWaveEntries.find((entry) => entry.workstream_id === 'ws-main' && entry.retried === true);
    assert.ok(wsMainRetryEntry, 'ws-main must surface successful retry metadata');
    assert.equal(wsMainRetryEntry.status, 'dispatched');
    assert.equal(wsMainRetryEntry.repo_id, 'repo-b');
    assert.equal(wsMainRetryEntry.retry_count, 1);
    assert.ok(wsMainRetryEntry.retried_repo_turn_id, 'retry entry must reference the failed turn');

    const missionPlans = await import(missionPlansPath);
    const finalPlan = missionPlans.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    assert.equal(finalPlan.status, 'completed', 'auto-retry path must complete the plan');
    assert.equal(repoAttempts.get('ws-main:repo-b'), 2, 'repo-b must execute once and retry once');
  });

  it('AT-COORD-RETRY-E2E-004/005: coordinator autopilot stops after one failed auto-retry attempt instead of looping forever', async () => {
    const setup = await setupCoordinatorMission();
    const repoAttempts = new Map();

    const autopilotResult = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
      autoRetry: true,
      maxRetries: '1',
      continueOnFailure: false,
      _sleep: async () => {},
      _executeGovernedRun: async (repoContext, runOpts) => {
        const trigger = runOpts?.provenance?.trigger_reason || '';
        const repoId = trigger.match(/repo:([^ ]+)/)?.[1];
        const workstreamId = trigger.match(/workstream:([^ ]+)/)?.[1];
        assert.ok(repoId, `repo id must be present in provenance: ${trigger}`);
        assert.ok(workstreamId, `workstream id must be present in provenance: ${trigger}`);

        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        assert.ok(turnId, `active turn must exist for ${repoId}/${workstreamId}`);

        const attemptKey = `${workstreamId}:${repoId}`;
        repoAttempts.set(attemptKey, (repoAttempts.get(attemptKey) || 0) + 1);

        if (repoId === 'repo-a') {
          recordAcceptedRepoTurn(repoContext.root, turnId);
          appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
          return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
        }

        recordFailedRepoTurn(repoContext.root, turnId);
        return { exitCode: 1, result: { ok: false, stop_reason: 'failed', turns_executed: 1 } };
      },
    });

    assert.equal(autopilotResult.exitCode, 1, 'autopilot must still fail when the retry attempt also fails');
    assert.equal(autopilotResult.parsed.summary.terminal_reason, 'failure_stopped');
    assert.equal(autopilotResult.parsed.summary.total_retries, 1, 'auto-retry budget must be consumed exactly once');
    assert.equal(repoAttempts.get('ws-main:repo-b'), 2, 'repo-b must execute once and retry once, then stop');

    const allWaveEntries = autopilotResult.parsed.waves.flatMap((wave) => wave.results);
    const wsMainFailureEntry = allWaveEntries.find((entry) => entry.workstream_id === 'ws-main' && entry.status === 'needs_attention');
    assert.ok(wsMainFailureEntry, 'ws-main must remain needs_attention after a failed retry');
    assert.equal(wsMainFailureEntry.retried, true, 'failed retry must still be surfaced as a retry attempt');
    assert.equal(wsMainFailureEntry.retry_count, 1);
  });

  it('AT-COORD-RETRY-E2E-006: coordinator autopilot rejects --max-retries 0', async () => {
    const setup = await setupCoordinatorMission();

    const autopilotResult = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      maxWaves: '5',
      cooldown: '0',
      autoRetry: true,
      maxRetries: '0',
      _sleep: async () => {},
    });

    assert.equal(autopilotResult.exitCode, 1);
    assert.match(autopilotResult.errors.join('\n'), /--max-retries must be >= 1 when --auto-retry is set/);
  });

  it('AT-COORD-RETRY-E2E-002: dashboard plan snapshot exposes retry metadata in repo_dispatches', async () => {
    const setup = await setupCoordinatorMission();

    // Run autopilot with repo-b failing
    await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
      continueOnFailure: false,
      _sleep: async () => {},
      _executeGovernedRun: async (repoContext, runOpts) => {
        const trigger = runOpts?.provenance?.trigger_reason || '';
        const repoMatch = trigger.match(/repo:([^ ]+)/);
        const repoId = repoMatch?.[1];
        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];

        if (repoId === 'repo-a') {
          recordAcceptedRepoTurn(repoContext.root, turnId);
          appendAcceptanceProjection(setup.workspace, repoId, 'ws-main', turnId);
          return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
        }
        recordFailedRepoTurn(repoContext.root, turnId);
        return { exitCode: 1, result: { ok: false, stop_reason: 'failed', turns_executed: 1 } };
      },
    });

    // Retry ws-main
    await runLaunchRetry(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      workstream: 'ws-main',
      retry: true,
      json: true,
      _executeGovernedRun: async (repoContext) => {
        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        recordAcceptedRepoTurn(repoContext.root, turnId);
        appendAcceptanceProjection(setup.workspace, 'repo-b', 'ws-main', turnId);
        setBarrierSatisfied(setup.workspace, 'ws-main', ['repo-a', 'repo-b']);
        return { exitCode: 0, result: { ok: true, stop_reason: 'completed', turns_executed: 1 } };
      },
    });

    // Read plan snapshot via the dashboard plan reader
    const { readPlanSnapshot } = await import('../src/lib/dashboard/plan-reader.js');
    const snapshot = readPlanSnapshot(setup.workspace, { missionId: setup.mission.mission_id });

    assert.ok(snapshot.ok, 'plan snapshot must succeed');
    assert.ok(snapshot.body.latest, 'latest plan summary must exist');

    // The latest plan must include launch records with repo_dispatches
    const wsMainRecord = snapshot.body.latest.launch_records.find(
      (lr) => lr.workstream_id === 'ws-main',
    );
    assert.ok(wsMainRecord, 'ws-main launch record must be in snapshot');
    assert.ok(Array.isArray(wsMainRecord.repo_dispatches), 'repo_dispatches must be an array in dashboard snapshot');
    assert.ok(wsMainRecord.repo_dispatches.length >= 3, 'repo_dispatches must include retry entries');

    // Verify retry metadata is visible
    const retryDispatch = wsMainRecord.repo_dispatches.find((d) => d.is_retry === true);
    assert.ok(retryDispatch, 'retry dispatch must be visible in dashboard snapshot');
    assert.ok(retryDispatch.retry_of, 'retry dispatch must include retry_of reference');
    assert.equal(retryDispatch.repo_id, 'repo-b', 'retry dispatch must be for repo-b');
  });
});
