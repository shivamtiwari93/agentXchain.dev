import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');
const missionPlansPath = join(cliRoot, 'src', 'lib', 'mission-plans.js');

function createTmpDir() {
  const dir = join(tmpdir(), `axc-coord-wave-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentxchainJson(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'coord-wave', id: 'coord-wave', default_branch: 'main' },
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
    project: { id: 'multi-project', name: 'Multi Project' },
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
    title: 'Coordinator Mission',
    goal: 'Coordinate work across repos',
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
    missionId: 'mission-coord-wave',
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
    mission,
    planId: approved.plan.plan_id,
  };
}

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
    throw new Error('__AUTOPILOT_EXIT__');
  };

  try {
    await missionPlanAutopilotCommand(planId, opts);
  } catch (error) {
    if (error.message !== '__AUTOPILOT_EXIT__') {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    exitCode,
    output,
    errors,
    parsed: opts.json ? JSON.parse(output.join('')) : null,
  };
}

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

describe('Coordinator wave autopilot', () => {
  it('AT-COORD-WAVE-002/003: autopilot re-dispatches multi-repo workstreams across waves, unblocks dependents, and completes the plan', async () => {
    const setup = await setupCoordinatorMission();
    const dispatches = [];

    const result = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
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

        recordAcceptedRepoTurn(repoContext.root, turnId);
        appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);

        if (workstreamId === 'ws-main' && repoId === 'repo-b') {
          setBarrierSatisfied(setup.workspace, 'ws-main', ['repo-a', 'repo-b']);
        }
        if (workstreamId === 'ws-followup' && repoId === 'repo-a') {
          setBarrierSatisfied(setup.workspace, 'ws-followup', ['repo-a']);
        }

        dispatches.push({ repo_id: repoId, workstream_id: workstreamId, turn_id: turnId });
        return {
          exitCode: 0,
          result: {
            ok: true,
            stop_reason: 'completed',
            turns_executed: 1,
          },
        };
      },
    });

    assert.equal(result.exitCode, null);
    assert.equal(result.parsed.summary.terminal_reason, 'plan_completed');
    assert.equal(result.parsed.summary.total_waves, 3);
    assert.equal(result.parsed.summary.total_launched, 3);
    assert.deepEqual(
      result.parsed.waves.map((wave) => wave.results.map((entry) => [entry.workstream_id, entry.repo_id])),
      [
        [['ws-main', 'repo-a']],
        [['ws-main', 'repo-b']],
        [['ws-followup', 'repo-a']],
      ],
    );
    assert.deepEqual(
      dispatches.map((entry) => [entry.workstream_id, entry.repo_id]),
      [['ws-main', 'repo-a'], ['ws-main', 'repo-b'], ['ws-followup', 'repo-a']],
    );

    const missionPlans = await import(missionPlansPath);
    const persistedPlan = missionPlans.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    assert.equal(persistedPlan.status, 'completed');
    assert.deepEqual(
      persistedPlan.workstreams.map((ws) => [ws.workstream_id, ws.launch_status]),
      [['ws-main', 'completed'], ['ws-followup', 'completed']],
    );

    const mainLaunch = persistedPlan.launch_records.find((record) => record.workstream_id === 'ws-main');
    assert.ok(mainLaunch, 'ws-main launch record must exist');
    assert.equal(mainLaunch.dispatch_mode, 'coordinator');
    assert.equal(mainLaunch.repo_dispatches.length, 2);
    assert.deepEqual(mainLaunch.repo_dispatches.map((entry) => entry.repo_id), ['repo-a', 'repo-b']);
  });
});
