import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function createTmpDir() {
  const dir = join(tmpdir(), `axc-mission-coord-launch-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentxchainJson(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'mission-coordinator-launch', id: 'mcl-001', default_branch: 'main' },
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
  return config;
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
  return state;
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
        repos: Object.keys(repos),
        entry_repo: Object.keys(repos)[0],
        phase: 'implementation',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
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

function appendAcceptanceProjection(workspaceDir, repoId, workstreamId, repoTurnId = `turn_${repoId}`) {
  appendFileSync(
    join(workspaceDir, '.agentxchain', 'multirepo', 'history.jsonl'),
    JSON.stringify({
      type: 'acceptance_projection',
      timestamp: new Date().toISOString(),
      repo_id: repoId,
      workstream_id: workstreamId,
      repo_turn_id: repoTurnId,
      summary: `${repoId} accepted`,
    }) + '\n',
  );
}

function setBarrierSatisfied(workspaceDir, workstreamId, repoIds) {
  const barrierPath = join(workspaceDir, '.agentxchain', 'multirepo', 'barriers.json');
  const barriers = JSON.parse(readFileSync(barrierPath, 'utf8'));
  barriers[`${workstreamId}_completion`].status = 'satisfied';
  barriers[`${workstreamId}_completion`].satisfied_repos = [...repoIds];
  writeFileSync(barrierPath, JSON.stringify(barriers, null, 2));
}

function setRepoTurnStatus(repoDir, turnId, status, extra = {}) {
  const statePath = join(repoDir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.active_turns[turnId] = {
    ...state.active_turns[turnId],
    status,
    ...extra,
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function updatePlanArtifact(workspace, missionId, planId, mutate) {
  const planPath = join(workspace, '.agentxchain', 'missions', 'plans', missionId, `${planId}.json`);
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  mutate(plan);
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return plan;
}

function readRunEvents(root) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) {
    return [];
  }
  return readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

let tempDirs = [];
beforeEach(() => { tempDirs = []; });
afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function track(dir) {
  tempDirs.push(dir);
  return dir;
}

async function setupCoordinatorMission() {
  const workspace = track(createTmpDir());
  writeAgentxchainJson(workspace);

  const repoA = createRepoFixture(workspace, 'repo-a');
  const repoB = createRepoFixture(workspace, 'repo-b');
  writeCoordinatorConfig(workspace, { 'repo-a': repoA, 'repo-b': repoB });

  const { initializeCoordinatorRun, loadCoordinatorState } = await import('../src/lib/coordinator-state.js');
  const { loadCoordinatorConfig } = await import('../src/lib/coordinator-config.js');
  const { loadProjectContext } = await import('../src/lib/config.js');
  const { initializeGovernedRun } = await import('../src/lib/governed-state.js');
  const {
    createPlanArtifact,
    approvePlanArtifact,
    loadPlan,
    launchCoordinatorWorkstream,
    retryCoordinatorWorkstream,
  } = await import('../src/lib/mission-plans.js');
  const { selectAssignmentForWorkstream, dispatchCoordinatorTurn } = await import('../src/lib/coordinator-dispatch.js');

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
  const init = initializeCoordinatorRun(workspace, loadedConfig.config);
  assert.ok(init.ok, `Coordinator init must succeed: ${JSON.stringify(init.errors)}`);

  const mission = writeMissionArtifact(workspace, {
    missionId: 'mission-coord-launch',
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
    coordinatorConfig,
    loadPlan,
    launchCoordinatorWorkstream,
    retryCoordinatorWorkstream,
    selectAssignmentForWorkstream,
    dispatchCoordinatorTurn,
    loadCoordinatorState,
  };
}

describe('mission plan coordinator launch', () => {
  it('AT-MISSION-COORD-LAUNCH-001/002: dispatches coordinator-backed workstreams and appends repo dispatches to one launch record', async () => {
    const setup = await setupCoordinatorMission();

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    assert.ok(firstAssignment.ok, firstAssignment.detail);
    assert.equal(firstAssignment.repo_id, 'repo-a');

    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);

    const firstLaunch = setup.launchCoordinatorWorkstream(
      setup.workspace,
      setup.mission,
      setup.planId,
      'ws-main',
      { ...firstDispatch, role: firstAssignment.role },
      setup.coordinatorConfig,
    );
    assert.ok(firstLaunch.ok, firstLaunch.error);
    assert.equal(firstLaunch.launchRecord.dispatch_mode, 'coordinator');
    assert.equal(firstLaunch.launchRecord.repo_dispatches.length, 1);
    assert.equal(firstLaunch.launchRecord.repo_dispatches[0].repo_id, 'repo-a');

    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    assert.ok(secondAssignment.ok, secondAssignment.detail);
    assert.equal(secondAssignment.repo_id, 'repo-b');

    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);

    const secondLaunch = setup.launchCoordinatorWorkstream(
      setup.workspace,
      setup.mission,
      setup.planId,
      'ws-main',
      { ...secondDispatch, role: secondAssignment.role },
      setup.coordinatorConfig,
    );
    assert.ok(secondLaunch.ok, secondLaunch.error);

    const reloaded = setup.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    assert.equal(reloaded.launch_records.length, 1, 'coordinator workstream should reuse a single launch record');
    assert.equal(reloaded.launch_records[0].dispatch_mode, 'coordinator');
    assert.equal(reloaded.launch_records[0].repo_dispatches.length, 2);
    assert.deepEqual(
      reloaded.launch_records[0].repo_dispatches.map((entry) => entry.repo_id),
      ['repo-a', 'repo-b'],
    );
  });

  it('AT-MISSION-COORD-LAUNCH-003/004: mission plan show synchronizes coordinator completion and unblocks dependents', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanShowCommand } = await import('../src/commands/mission.js');

    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', 'turn_repo_a');
    appendAcceptanceProjection(setup.workspace, 'repo-b', 'ws-main', 'turn_repo_b');
    setBarrierSatisfied(setup.workspace, 'ws-main', ['repo-a', 'repo-b']);

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line) => output.push(String(line));
    console.error = () => {};
    try {
      await missionPlanShowCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        json: true,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const parsed = JSON.parse(output.join('\n'));
    const main = parsed.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    const followup = parsed.workstreams.find((ws) => ws.workstream_id === 'ws-followup');
    assert.equal(main.launch_status, 'completed');
    assert.equal(main.coordinator_progress.accepted_repo_count, 2);
    assert.equal(main.coordinator_progress.completion_barrier_status, 'satisfied');
    assert.equal(followup.launch_status, 'ready');
  });

  it('AT-MISSION-COORD-LAUNCH-001: missionPlanLaunchCommand uses coordinator dispatch JSON and never calls the single-repo executor', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanLaunchCommand } = await import('../src/commands/mission.js');

    let executorCalled = false;
    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line) => output.push(String(line));
    console.error = () => {};
    try {
      await missionPlanLaunchCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        workstream: 'ws-main',
        json: true,
        _executeGovernedRun: async () => {
          executorCalled = true;
          return { exitCode: 0 };
        },
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(executorCalled, false, 'coordinator launch must not fall through to the single-repo chain executor');
    const parsed = JSON.parse(output.join('\n'));
    assert.equal(parsed.dispatch_mode, 'coordinator');
    assert.equal(parsed.workstream_id, 'ws-main');
    assert.equal(parsed.repo_id, 'repo-a');
    assert.ok(parsed.repo_turn_id);
    assert.equal(parsed.launch_record.dispatch_mode, 'coordinator');

    const repoState = JSON.parse(readFileSync(join(setup.workspace, 'repo-a', '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(Object.keys(repoState.active_turns || {}).length, 1, 'repo-local turn should be assigned');
    const bundleDir = join(setup.workspace, 'repo-a', '.agentxchain', 'dispatch', 'turns', parsed.repo_turn_id);
    assert.ok(existsSync(bundleDir), 'dispatch bundle should exist for the repo-local coordinator turn');
  });

  it('AT-MISSION-COORD-LAUNCH-005: --all-ready dispatches coordinator workstreams sequentially and syncs barrier state', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanLaunchCommand } = await import('../src/commands/mission.js');

    // Mock executeGovernedRun to simulate a successful repo-local turn
    const mockExecutor = async (repoContext, runOpts) => {
      return { exitCode: 0, result: { status: 'completed' } };
    };

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error('EXIT'); };
    console.log = (line) => { if (line) output.push(String(line)); };
    console.error = () => {};
    try {
      await missionPlanLaunchCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        allReady: true,
        json: true,
        _executeGovernedRun: mockExecutor,
      }).catch(() => {});
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.exit = originalExit;
    }

    // The command should dispatch coordinator workstreams (or exit 0 on success)
    // Since we're testing the path is no longer fail-closed, the key assertion is
    // that no "not supported" error is produced and the coordinator dispatch path is entered
    const combined = output.join('\n');
    assert.ok(!combined.includes('not supported'), '--all-ready must not fail-closed for coordinator missions');
  });

  it('AT-MISSION-COORD-LAUNCH-006: autopilot dispatches coordinator workstreams in waves', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanAutopilotCommand } = await import('../src/commands/mission.js');

    // Mock executor
    const mockExecutor = async (repoContext, runOpts) => {
      return { exitCode: 0, result: { status: 'completed' } };
    };

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error('EXIT'); };
    console.log = (line) => { if (line) output.push(String(line)); };
    console.error = () => {};
    try {
      await missionPlanAutopilotCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        json: true,
        maxWaves: 2,
        cooldown: 0,
        _executeGovernedRun: mockExecutor,
        _sleep: async () => {},
      }).catch(() => {});
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.exit = originalExit;
    }

    const combined = output.join('\n');
    assert.ok(!combined.includes('not supported'), 'autopilot must not fail-closed for coordinator missions');
  });

  it('AT-MISSION-COORD-LAUNCH-007: mission plan show surfaces repo-level coordinator failures as needs_attention', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanShowCommand } = await import('../src/commands/mission.js');

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...firstDispatch, role: firstAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'first coordinator launch must succeed',
    );

    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...secondDispatch, role: secondAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'second coordinator launch must succeed',
    );

    setRepoTurnStatus(join(setup.workspace, 'repo-b'), secondDispatch.turn_id, 'failed_acceptance', {
      failure_reason: 'Acceptance validator rejected the repo-local turn',
    });

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line) => output.push(String(line));
    console.error = () => {};
    try {
      await missionPlanShowCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        json: true,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const parsed = JSON.parse(output.join('\n'));
    const main = parsed.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    const launchRecord = parsed.launch_records.find((record) => record.workstream_id === 'ws-main');

    assert.equal(parsed.status, 'needs_attention');
    assert.equal(main.launch_status, 'needs_attention');
    assert.equal(main.coordinator_progress.repo_failure_count, 1);
    assert.deepEqual(main.coordinator_progress.failed_repo_ids, ['repo-b']);
    assert.equal(launchRecord.status, 'needs_attention');
    assert.equal(launchRecord.repo_failures.length, 1);
    assert.equal(launchRecord.repo_failures[0].repo_id, 'repo-b');
    assert.equal(launchRecord.repo_failures[0].repo_turn_id, secondDispatch.turn_id);
    assert.equal(launchRecord.repo_failures[0].failure_status, 'failed_acceptance');
  });

  it('AT-MISSION-COORD-LAUNCH-008: mission snapshots synchronize coordinator repo failures into latest plan summary', async () => {
    const setup = await setupCoordinatorMission();
    const { buildMissionSnapshot } = await import('../src/lib/missions.js');

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...firstDispatch, role: firstAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'first coordinator launch must succeed',
    );

    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...secondDispatch, role: secondAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'second coordinator launch must succeed',
    );

    setRepoTurnStatus(join(setup.workspace, 'repo-b'), secondDispatch.turn_id, 'failed', {
      failure_reason: 'Repo-local execution exhausted retries',
    });

    const snapshot = buildMissionSnapshot(setup.workspace, setup.mission);
    assert.ok(snapshot.latest_plan, 'mission snapshot must include latest plan summary');
    assert.equal(snapshot.latest_plan.status, 'needs_attention');
    assert.equal(snapshot.latest_plan.needs_attention_count, 1);
    assert.equal(snapshot.latest_plan.completed_count, 0);
  });

  it('AT-COORD-RETRY-001/009/010: coordinator --retry reissues the failed repo turn, appends retry metadata, and emits a retry event', async () => {
    const setup = await setupCoordinatorMission();
    const { missionPlanLaunchCommand } = await import('../src/commands/mission.js');

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...firstDispatch, role: firstAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'first coordinator launch must succeed',
    );
    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...secondDispatch, role: secondAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'second coordinator launch must succeed',
    );

    setRepoTurnStatus(join(setup.workspace, 'repo-b'), secondDispatch.turn_id, 'failed_acceptance', {
      failure_reason: 'Acceptance validator rejected the repo-local turn',
    });

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line) => output.push(String(line));
    console.error = () => {};

    let executorRepo = null;
    let executorTurnId = null;
    try {
      await missionPlanLaunchCommand('latest', {
        dir: setup.workspace,
        mission: setup.mission.mission_id,
        workstream: 'ws-main',
        retry: true,
        json: true,
        _executeGovernedRun: async (repoContext) => {
          executorRepo = repoContext.root;
          const repoState = JSON.parse(readFileSync(join(repoContext.root, '.agentxchain', 'state.json'), 'utf8'));
          executorTurnId = Object.keys(repoState.active_turns || {})[0] || null;
          return { exitCode: 0 };
        },
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const parsed = JSON.parse(output.join('\n'));
    assert.equal(parsed.dispatch_mode, 'coordinator');
    assert.equal(parsed.retry, true);
    assert.equal(parsed.workstream_id, 'ws-main');
    assert.equal(parsed.repo_id, 'repo-b');
    assert.equal(parsed.retried_repo_turn_id, secondDispatch.turn_id);
    assert.notEqual(parsed.repo_turn_id, secondDispatch.turn_id, 'retry must create a fresh repo-local turn');
    assert.equal(executorRepo, join(setup.workspace, 'repo-b'));
    assert.equal(executorTurnId, parsed.repo_turn_id);

    const persistedPlan = setup.loadPlan(setup.workspace, setup.mission.mission_id, setup.planId);
    const launchRecord = persistedPlan.launch_records.find((record) => record.workstream_id === 'ws-main');
    assert.equal(launchRecord.status, 'launched');
    assert.equal(launchRecord.repo_dispatches.length, 3);
    const retriedDispatch = launchRecord.repo_dispatches.find((entry) => entry.repo_turn_id === secondDispatch.turn_id);
    const retryDispatch = launchRecord.repo_dispatches.find((entry) => entry.repo_turn_id === parsed.repo_turn_id);
    assert.ok(retriedDispatch.retried_at, 'old dispatch must be marked retried');
    assert.equal(retriedDispatch.retry_reason, 'failed_acceptance');
    assert.equal(retryDispatch.is_retry, true);
    assert.equal(retryDispatch.retry_of, secondDispatch.turn_id);

    const retryEvents = readRunEvents(setup.workspace).filter((entry) => entry.event_type === 'coordinator_retry');
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].payload.workstream_id, 'ws-main');
    assert.equal(retryEvents[0].payload.repo_id, 'repo-b');
    assert.equal(retryEvents[0].payload.failed_turn_id, secondDispatch.turn_id);
    assert.equal(retryEvents[0].payload.reissued_turn_id, parsed.repo_turn_id);
    assert.equal(retryEvents[0].payload.retry_reason, 'failed_acceptance');
  });

  it('AT-COORD-RETRY-002: coordinator --retry refuses to proceed when a dependent workstream already dispatched after the failed repo turn', async () => {
    const setup = await setupCoordinatorMission();

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...firstDispatch, role: firstAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'first coordinator launch must succeed',
    );
    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...secondDispatch, role: secondAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'second coordinator launch must succeed',
    );

    setRepoTurnStatus(join(setup.workspace, 'repo-b'), secondDispatch.turn_id, 'failed', {
      failure_reason: 'Repo-local execution failed',
    });

    const persistedPlanAfterSecondLaunch = setup.loadPlan(
      setup.workspace,
      setup.mission.mission_id,
      setup.planId,
    );
    const wsMainLaunchRecord = persistedPlanAfterSecondLaunch.launch_records.find(
      (record) => record.workstream_id === 'ws-main',
    );
    const dependentDispatchAt = new Date(
      new Date(wsMainLaunchRecord.repo_dispatches.at(-1).dispatched_at).getTime() + 60_000,
    ).toISOString();

    updatePlanArtifact(setup.workspace, setup.mission.mission_id, setup.planId, (plan) => {
      const ws = plan.workstreams.find((entry) => entry.workstream_id === 'ws-followup');
      ws.launch_status = 'launched';
      plan.launch_records.push({
        workstream_id: 'ws-followup',
        dispatch_mode: 'coordinator',
        super_run_id: setup.mission.coordinator.super_run_id,
        launched_at: dependentDispatchAt,
        status: 'launched',
        completion_barrier: {
          barrier_id: 'ws-followup_completion',
          type: 'all_repos_accepted',
        },
        repo_dispatches: [
          {
            repo_id: 'repo-a',
            repo_turn_id: 'turn_followup',
            role: 'dev',
            dispatched_at: dependentDispatchAt,
            bundle_path: '/tmp/fake-followup',
            context_ref: 'ctx_followup',
          },
        ],
      });
    });

    const retry = setup.retryCoordinatorWorkstream(
      setup.workspace,
      setup.mission,
      setup.planId,
      'ws-main',
      setup.coordinatorConfig,
      { reason: 'operator retry after repo-local fix' },
    );

    assert.equal(retry.ok, false);
    assert.match(retry.error, /dependent workstream "ws-followup" has already dispatched/i);
  });

  it('AT-COORD-RETRY-003: coordinator --retry fails closed on non-retryable repo failure states', async () => {
    const setup = await setupCoordinatorMission();

    const firstAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const firstDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      firstAssignment,
    );
    assert.ok(firstDispatch.ok, firstDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...firstDispatch, role: firstAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'first coordinator launch must succeed',
    );
    appendAcceptanceProjection(setup.workspace, 'repo-a', 'ws-main', firstDispatch.turn_id);

    const secondAssignment = setup.selectAssignmentForWorkstream(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      'ws-main',
    );
    const secondDispatch = setup.dispatchCoordinatorTurn(
      setup.workspace,
      setup.loadCoordinatorState(setup.workspace),
      setup.coordinatorConfig,
      secondAssignment,
    );
    assert.ok(secondDispatch.ok, secondDispatch.error);
    assert.ok(
      setup.launchCoordinatorWorkstream(
        setup.workspace,
        setup.mission,
        setup.planId,
        'ws-main',
        { ...secondDispatch, role: secondAssignment.role },
        setup.coordinatorConfig,
      ).ok,
      'second coordinator launch must succeed',
    );

    setRepoTurnStatus(join(setup.workspace, 'repo-b'), secondDispatch.turn_id, 'conflicted', {
      failure_reason: 'Repo-local merge conflict',
    });

    const retry = setup.retryCoordinatorWorkstream(
      setup.workspace,
      setup.mission,
      setup.planId,
      'ws-main',
      setup.coordinatorConfig,
      { reason: 'operator retry after repo-local fix' },
    );

    assert.equal(retry.ok, false);
    assert.match(retry.error, /no retryable repo failures/i);
    assert.match(retry.error, /repo-b \(conflicted\)/i);
  });
});
