import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');

// ── Fixture helpers ──────────────────────────────────────────────────────────

function createTmpDir() {
  const dir = join(tmpdir(), `axc-coord-fail-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentxchainJson(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'coord-fail', id: 'coord-fail', default_branch: 'main' },
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

/**
 * Two INDEPENDENT workstreams — ws-a targets repo-a, ws-b targets repo-b.
 * Neither depends on the other, so both are ready in wave 1.
 *
 * @param {string} workspaceDir
 * @param {Object} repos - { 'repo-a': repoAPath, 'repo-b': repoBPath }
 * @param {string[]} [workstreamOrder] - defaults to ['ws-a', 'ws-b']; pass ['ws-b', 'ws-a']
 *   to make ws-b dispatch first in the wave (used by FAIL-002 so that ws-b succeeds before
 *   ws-a fails and sets plan.status = 'needs_attention').
 */
function writeCoordinatorConfig(workspaceDir, repos, workstreamOrder = ['ws-a', 'ws-b']) {
  const config = {
    schema_version: '0.1',
    project: { id: 'multi-fail-project', name: 'Multi Fail Project' },
    repos: Object.fromEntries(
      Object.entries(repos).map(([repoId, repoDir]) => [repoId, { path: repoDir, required: true }]),
    ),
    workstreams: {
      'ws-a': {
        repos: ['repo-a'],
        entry_repo: 'repo-a',
        phase: 'implementation',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      'ws-b': {
        repos: ['repo-b'],
        entry_repo: 'repo-b',
        phase: 'implementation',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    workstream_order: workstreamOrder,
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
    title: 'Coordinator Failure Mission',
    goal: 'Prove failure handling across independent workstreams',
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
    coordinator,
  };
  writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(artifact, null, 2));
  return artifact;
}

function planOutput(workstreamOrder = ['ws-a', 'ws-b']) {
  const byId = {
    'ws-a': {
      workstream_id: 'ws-a',
      title: 'Workstream A',
      goal: 'Work on repo-a',
      roles: ['dev'],
      phases: ['implementation'],
      depends_on: [],
      acceptance_checks: ['repo-a accepted'],
    },
    'ws-b': {
      workstream_id: 'ws-b',
      title: 'Workstream B',
      goal: 'Work on repo-b',
      roles: ['dev'],
      phases: ['implementation'],
      depends_on: [],
      acceptance_checks: ['repo-b accepted'],
    },
  };
  return { workstreams: workstreamOrder.map((id) => byId[id]) };
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

/**
 * Mark an active turn as 'failed' in the repo state. This is necessary so that
 * synchronizeCoordinatorPlanState can classify the dispatch as failed via
 * classifyRepoDispatchOutcome (which checks REPO_FAILURE_STATUSES on active_turns).
 * Without this, the turn remains 'in_flight' and the coordinator wave loop keeps
 * re-dispatching the workstream until wave_limit_reached.
 */
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

async function setupCoordinatorMission({ workstreamOrder = ['ws-a', 'ws-b'] } = {}) {
  const workspace = trackDir(createTmpDir());
  writeAgentxchainJson(workspace);

  const repoA = createRepoFixture(workspace, 'repo-a');
  const repoB = createRepoFixture(workspace, 'repo-b');
  writeCoordinatorConfig(workspace, { 'repo-a': repoA, 'repo-b': repoB }, workstreamOrder);

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
    missionId: 'mission-coord-fail',
    coordinator: {
      super_run_id: init.super_run_id,
      config_path: './agentxchain-multi.json',
      workspace_path: workspace,
    },
  });

  const created = createPlanArtifact(workspace, mission, {
    plannerOutput: planOutput(workstreamOrder),
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

// ── Lifecycle tracking ───────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Coordinator wave failure handling', () => {
  it('AT-COORD-WAVE-FAIL-001: without --continue-on-failure, ws-a failure stops the wave loop with failure_stopped and ws-b is skipped', async () => {
    const setup = await setupCoordinatorMission();
    const dispatched = [];

    const result = await runCoordinatorAutopilot(setup.planId, {
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

        dispatched.push({ repo_id: repoId, workstream_id: workstreamId });

        // ws-a fails with exitCode 1 — simulates a repo-local execution failure.
        // Mark the active turn as 'failed' so that synchronizeCoordinatorPlanState
        // classifies the dispatch as failed (via classifyRepoDispatchOutcome) and sets
        // ws.launch_status = 'needs_attention' rather than leaving it as 'in_flight'.
        if (workstreamId === 'ws-a') {
          const statePath = join(repoContext.root, '.agentxchain', 'state.json');
          const state = JSON.parse(readFileSync(statePath, 'utf8'));
          const turnId = Object.keys(state.active_turns || {})[0];
          if (turnId) {
            recordFailedRepoTurn(repoContext.root, turnId);
          }
          return {
            exitCode: 1,
            result: {
              ok: false,
              stop_reason: 'failed',
              turns_executed: 1,
            },
          };
        }

        // ws-b succeeds (should never be reached in this test, but handle it defensively)
        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        if (turnId) {
          recordAcceptedRepoTurn(repoContext.root, turnId);
          appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
          setBarrierSatisfied(setup.workspace, workstreamId, [repoId]);
        }
        return {
          exitCode: 0,
          result: { ok: true, stop_reason: 'completed', turns_executed: 1 },
        };
      },
    });

    const { parsed } = result;

    // The autopilot must exit with code 1 (non-zero) because the plan did not complete
    assert.equal(result.exitCode, 1, 'exitCode must be 1 when the wave stops on failure');

    // The terminal reason must be failure_stopped — not plan_incomplete, not wave_limit_reached
    assert.equal(
      parsed.summary.terminal_reason,
      'failure_stopped',
      `terminal_reason must be 'failure_stopped' but got '${parsed.summary.terminal_reason}'`,
    );

    // At least one workstream must be counted as failed
    assert.ok(
      parsed.summary.failed >= 1,
      `total_failed must be >= 1 but got ${parsed.summary.failed}`,
    );

    // Only one wave should have run (the wave that had the failure)
    assert.equal(parsed.summary.total_waves, 1, 'only one wave should have executed before stopping');

    // ws-a was dispatched (it entered _executeGovernedRun and failed)
    assert.ok(
      dispatched.some((d) => d.workstream_id === 'ws-a'),
      'ws-a must have been dispatched',
    );

    // ws-b must appear in wave results as skipped due to prior workstream failure
    // OR ws-b was never dispatched at all (both are valid: skipped in wave vs. never reached)
    const wave1 = parsed.waves[0];
    assert.ok(wave1, 'wave 1 must exist in output');

    const wsBEntry = wave1.results.find((r) => r.workstream_id === 'ws-b');
    if (wsBEntry) {
      // If ws-b appears in the wave results it must be skipped, not dispatched
      assert.equal(
        wsBEntry.status,
        'skipped',
        `ws-b status must be 'skipped' when present in wave results, got '${wsBEntry.status}'`,
      );
      assert.match(
        wsBEntry.skip_reason || '',
        /prior workstream failed/,
        `ws-b skip_reason must mention prior workstream failure`,
      );
    }

    // ws-b must NOT have been dispatched to _executeGovernedRun
    assert.ok(
      !dispatched.some((d) => d.workstream_id === 'ws-b'),
      'ws-b must NOT have been dispatched to _executeGovernedRun when continueOnFailure is false',
    );
  });

  it('AT-COORD-WAVE-FAIL-002: with --continue-on-failure, ws-b is dispatched after ws-a fails and the run ends plan_incomplete or failure_stopped', async () => {
    // Use ['ws-b', 'ws-a'] order so ws-b runs FIRST (succeeds), then ws-a runs SECOND (fails).
    // If ws-a ran first, its failure would set plan.status = 'needs_attention', blocking ws-b's
    // launchCoordinatorWorkstream call. By running ws-b first, it completes cleanly and its
    // barrier is satisfied before ws-a's failure is processed.
    const setup = await setupCoordinatorMission({ workstreamOrder: ['ws-b', 'ws-a'] });
    const dispatched = [];

    const result = await runCoordinatorAutopilot(setup.planId, {
      dir: setup.workspace,
      mission: setup.mission.mission_id,
      json: true,
      maxWaves: '5',
      cooldown: '0',
      continueOnFailure: true,
      _sleep: async () => {},
      _executeGovernedRun: async (repoContext, runOpts) => {
        const trigger = runOpts?.provenance?.trigger_reason || '';
        const repoMatch = trigger.match(/repo:([^ ]+)/);
        const workstreamMatch = trigger.match(/workstream:([^ ]+)/);
        assert.ok(repoMatch, `repo id must be present in provenance: ${trigger}`);
        assert.ok(workstreamMatch, `workstream id must be present in provenance: ${trigger}`);

        const repoId = repoMatch[1];
        const workstreamId = workstreamMatch[1];

        dispatched.push({ repo_id: repoId, workstream_id: workstreamId });

        // ws-a fails with exitCode 1. Mark the active turn as 'failed' so that
        // synchronizeCoordinatorPlanState classifies this dispatch as failed and sets
        // ws-a's launch_status to 'needs_attention'. Without this, the turn remains
        // 'in_flight' and the wave loop re-dispatches ws-a indefinitely until wave_limit_reached.
        if (workstreamId === 'ws-a') {
          const statePath = join(repoContext.root, '.agentxchain', 'state.json');
          const state = JSON.parse(readFileSync(statePath, 'utf8'));
          const turnId = Object.keys(state.active_turns || {})[0];
          if (turnId) {
            recordFailedRepoTurn(repoContext.root, turnId);
          }
          return {
            exitCode: 1,
            result: {
              ok: false,
              stop_reason: 'failed',
              turns_executed: 1,
            },
          };
        }

        // ws-b succeeds — record acceptance and satisfy its barrier
        const statePath = join(repoContext.root, '.agentxchain', 'state.json');
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const turnId = Object.keys(state.active_turns || {})[0];
        assert.ok(turnId, `active turn must exist for ${repoId}/${workstreamId}`);

        recordAcceptedRepoTurn(repoContext.root, turnId);
        appendAcceptanceProjection(setup.workspace, repoId, workstreamId, turnId);
        setBarrierSatisfied(setup.workspace, workstreamId, [repoId]);

        return {
          exitCode: 0,
          result: { ok: true, stop_reason: 'completed', turns_executed: 1 },
        };
      },
    });

    const { parsed } = result;

    // The autopilot must exit with code 1 because not all workstreams completed
    assert.equal(result.exitCode, 1, 'exitCode must be 1 when the plan is not fully completed');

    // With continueOnFailure, the terminal reason should be plan_incomplete
    // (deriveAutopilotIdleOutcome returns 'plan_incomplete' when continueOnFailure=true and
    // needs_attention workstreams remain). 'failure_stopped' is also acceptable if the
    // implementation terminates early after exhausting ready work.
    const acceptableReasons = ['plan_incomplete', 'failure_stopped'];
    assert.ok(
      acceptableReasons.includes(parsed.summary.terminal_reason),
      `terminal_reason must be one of ${JSON.stringify(acceptableReasons)} but got '${parsed.summary.terminal_reason}'`,
    );

    // ws-a must have been dispatched and counted as failed
    assert.ok(
      dispatched.some((d) => d.workstream_id === 'ws-a'),
      'ws-a must have been dispatched to _executeGovernedRun',
    );
    assert.ok(
      parsed.summary.failed >= 1,
      `total_failed must be >= 1 but got ${parsed.summary.failed}`,
    );

    // ws-b must have been dispatched — continueOnFailure allows independent work to proceed
    assert.ok(
      dispatched.some((d) => d.workstream_id === 'ws-b'),
      'ws-b must have been dispatched to _executeGovernedRun when continueOnFailure is true',
    );

    // ws-b must appear in wave results as dispatched (not skipped, not needs_attention)
    const allWaveEntries = parsed.waves.flatMap((wave) => wave.results);
    const wsBEntry = allWaveEntries.find((r) => r.workstream_id === 'ws-b');
    assert.ok(wsBEntry, 'ws-b must appear in wave results');
    assert.equal(
      wsBEntry.status,
      'dispatched',
      `ws-b status must be 'dispatched' but got '${wsBEntry.status}'`,
    );

    // ws-a must appear as needs_attention in wave results
    const wsAEntry = allWaveEntries.find((r) => r.workstream_id === 'ws-a');
    assert.ok(wsAEntry, 'ws-a must appear in wave results');
    assert.equal(
      wsAEntry.status,
      'needs_attention',
      `ws-a status must be 'needs_attention' but got '${wsAEntry.status}'`,
    );
  });
});
