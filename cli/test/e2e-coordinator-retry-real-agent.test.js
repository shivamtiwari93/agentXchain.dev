/**
 * E2E coordinator retry with real child-repo execution.
 *
 * Proves that coordinator autopilot failure, targeted retry, and downstream
 * completion all work through real `local_cli` child runtimes instead of
 * injected `_executeGovernedRun` callbacks.
 *
 * See: .planning/COORDINATOR_RETRY_REAL_AGENT_SPEC.md
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const missionCommandPath = join(__dirname, '..', 'src', 'commands', 'mission.js');
const missionPlansPath = join(__dirname, '..', 'src', 'lib', 'mission-plans.js');
const RETRY_AGENT = join(__dirname, '..', 'test-support', 'coordinator-retry-agent.mjs');
const tempDirs = [];

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function parseJsonResult(result, label, expectedExitCode = 0) {
  assert.equal(result.exitCode ?? 0, expectedExitCode, `${label} failed:\n${result.combined}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON:\n${result.stdout}\n${error.message}`);
  }
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
    if (error.message !== '__AUTOPILOT_EXIT__') throw error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    exitCode,
    stdout: output.join(''),
    stderr: errors.join('\n'),
    combined: `${output.join('')}${errors.join('\n')}`,
  };
}

async function runCoordinatorRetry(planId, opts) {
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
    throw new Error('__LAUNCH_EXIT__');
  };

  try {
    await missionPlanLaunchCommand(planId, opts);
  } catch (error) {
    if (error.message !== '__LAUNCH_EXIT__') throw error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    exitCode,
    stdout: output.join(''),
    stderr: errors.join('\n'),
    combined: `${output.join('')}${errors.join('\n')}`,
  };
}

async function loadPlanArtifact(root, missionId, planId) {
  const missionPlans = await import(missionPlansPath);
  return missionPlans.loadPlan(root, missionId, planId);
}

async function loadSyncedPlanArtifact(root, missionId, planId) {
  const missionPlans = await import(missionPlansPath);
  const plan = missionPlans.loadPlan(root, missionId, planId);
  const mission = readJson(join(root, '.agentxchain', 'missions', `${missionId}.json`));
  const synced = missionPlans.synchronizeCoordinatorPlanState(root, mission, plan);
  return synced.ok ? synced.plan : plan;
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
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
    protocol_mode: 'governed',
  });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [RETRY_AGENT],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    rules: {
      challenge_required: false,
      max_turn_retries: 1,
    },
  });
}

async function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-retry-real-'));
  tempDirs.push(workspace);

  writeGovernedRepo(workspace, 'coord-retry-real-root');

  const repoA = join(workspace, 'repo-a');
  const repoB = join(workspace, 'repo-b');
  writeGovernedRepo(repoA, 'repo-a');
  writeGovernedRepo(repoB, 'repo-b');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-retry-real', name: 'Coordinator Retry Real Agent' },
    repos: {
      'repo-a': { path: './repo-a', default_branch: 'main', required: true },
      'repo-b': { path: './repo-b', default_branch: 'main', required: true },
    },
    workstreams: {
      'ws-main': {
        phase: 'implementation',
        repos: ['repo-a', 'repo-b'],
        entry_repo: 'repo-a',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      'ws-followup': {
        phase: 'implementation',
        repos: ['repo-a'],
        entry_repo: 'repo-a',
        depends_on: ['ws-main'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    workstream_order: ['ws-main', 'ws-followup'],
    routing: {
      implementation: { entry_workstream: 'ws-main' },
    },
    gates: {},
  });

  const { initializeCoordinatorRun } = await import('../src/lib/coordinator-state.js');
  const { loadCoordinatorConfig } = await import('../src/lib/coordinator-config.js');
  const { loadProjectContext } = await import('../src/lib/config.js');
  const { initializeGovernedRun } = await import('../src/lib/governed-state.js');
  const { createMission } = await import('../src/lib/missions.js');
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
  assert.ok(loadedConfig.ok, `coordinator config must load: ${JSON.stringify(loadedConfig.errors)}`);
  const coordinatorConfig = loadedConfig.config;

  const init = initializeCoordinatorRun(workspace, coordinatorConfig);
  assert.ok(init.ok, `coordinator init must succeed: ${JSON.stringify(init.errors)}`);

  const missionResult = createMission(workspace, {
    missionId: 'mission-coord-retry-real',
    title: 'Coordinator Retry Real Agent Mission',
    goal: 'Prove coordinator retry through real child runtimes',
  });
  assert.ok(missionResult.ok, `mission creation must succeed: ${missionResult.error}`);

  const boundMission = {
    ...missionResult.mission,
    coordinator: {
      super_run_id: init.super_run_id,
      config_path: './agentxchain-multi.json',
      workspace_path: workspace,
    },
  };
  writeJson(
    join(workspace, '.agentxchain', 'missions', `${boundMission.mission_id}.json`),
    boundMission,
  );

  const created = createPlanArtifact(workspace, boundMission, {
    plannerOutput: {
      workstreams: [
        {
          workstream_id: 'ws-main',
          title: 'Main coordinated rollout',
          goal: 'Complete repo-a then repo-b',
          roles: ['dev'],
          phases: ['implementation'],
          depends_on: [],
          acceptance_checks: ['repo-a and repo-b accepted'],
        },
        {
          workstream_id: 'ws-followup',
          title: 'Follow-up work',
          goal: 'Run after ws-main completes',
          roles: ['dev'],
          phases: ['implementation'],
          depends_on: ['ws-main'],
          acceptance_checks: ['repo-a follow-up accepted'],
        },
      ],
    },
    coordinatorConfig,
  });
  assert.ok(created.ok, `plan creation must succeed: ${JSON.stringify(created.errors)}`);

  const approved = approvePlanArtifact(workspace, boundMission.mission_id, created.plan.plan_id);
  assert.ok(approved.ok, `plan approval must succeed: ${approved.error}`);

  return {
    workspace,
    missionId: boundMission.mission_id,
    planId: approved.plan.plan_id,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('Coordinator retry with real agent execution', () => {
  it('AT-COORD-RETRY-REAL-001..005: autopilot failure, targeted retry, and downstream completion work through real local_cli child repos', async () => {
    const { workspace, missionId, planId } = await makeWorkspace();

    const firstAutopilot = await runCoordinatorAutopilot(planId, {
      dir: workspace,
      mission: missionId,
      autoApprove: true,
      maxWaves: '5',
      cooldown: '0',
      json: true,
    });
    const firstAutopilotJson = parseJsonResult(
      firstAutopilot,
      'initial coordinator autopilot',
      1,
    );

    assert.equal(firstAutopilotJson.summary.terminal_reason, 'failure_stopped');

    const planAfterFailure = await loadSyncedPlanArtifact(workspace, missionId, planId);
    const wsMainAfterFailure = planAfterFailure.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    const wsFollowupAfterFailure = planAfterFailure.workstreams.find((ws) => ws.workstream_id === 'ws-followup');
    assert.equal(wsMainAfterFailure.launch_status, 'needs_attention', 'ws-main must need attention after repo-b fails');
    assert.equal(wsFollowupAfterFailure.launch_status, 'blocked', 'ws-followup must stay blocked while ws-main is incomplete');

    const repoBStateAfterFailure = readJson(join(workspace, 'repo-b', '.agentxchain', 'state.json'));
    const failedTurns = Object.values(repoBStateAfterFailure.active_turns || {}).filter((turn) => turn.status === 'failed');
    assert.equal(failedTurns.length, 1, 'repo-b must retain one failed turn after the first autopilot run');
    const failedTurnId = failedTurns[0].turn_id;

    const retryResult = await runCoordinatorRetry(planId, {
      dir: workspace,
      mission: missionId,
      workstream: 'ws-main',
      retry: true,
      autoApprove: true,
      json: true,
    });
    const retryJson = parseJsonResult(retryResult, 'coordinator retry');

    assert.equal(retryJson.retry, true);
    assert.equal(retryJson.repo_id, 'repo-b');
    assert.equal(retryJson.retried_repo_turn_id, failedTurnId);
    assert.ok(retryJson.repo_turn_id, 'retry must emit a new repo turn id');
    assert.notEqual(retryJson.repo_turn_id, failedTurnId, 'retry must reissue a new turn');

    const planAfterRetry = await loadSyncedPlanArtifact(workspace, missionId, planId);
    const wsMainAfterRetry = planAfterRetry.workstreams.find((ws) => ws.workstream_id === 'ws-main');
    const wsFollowupAfterRetry = planAfterRetry.workstreams.find((ws) => ws.workstream_id === 'ws-followup');
    assert.equal(wsMainAfterRetry.launch_status, 'completed', 'ws-main must complete after successful retry');
    assert.equal(wsFollowupAfterRetry.launch_status, 'ready', 'ws-followup must become ready after ws-main completes');

    const retryLaunchRecord = planAfterRetry.launch_records.find(
      (record) => record.workstream_id === 'ws-main' && record.dispatch_mode === 'coordinator',
    );
    assert.ok(retryLaunchRecord, 'ws-main launch record must exist');
    const initialRepoBDispatch = retryLaunchRecord.repo_dispatches.find(
      (dispatch) => dispatch.repo_id === 'repo-b' && !dispatch.is_retry,
    );
    const retriedRepoBDispatch = retryLaunchRecord.repo_dispatches.find(
      (dispatch) => dispatch.repo_id === 'repo-b' && dispatch.is_retry === true,
    );
    assert.ok(initialRepoBDispatch?.retried_at, 'failed repo-b dispatch must be marked retried');
    assert.equal(initialRepoBDispatch?.retry_reason, 'failed', 'retry reason must capture the failed status');
    assert.equal(retriedRepoBDispatch?.retry_of, failedTurnId, 'retry metadata must point back to the failed turn');

    const retryEvents = readJsonl(join(workspace, '.agentxchain', 'events.jsonl'))
      .filter((event) => event.event_type === 'coordinator_retry');
    assert.ok(retryEvents.length >= 1, 'coordinator retry event must be emitted');
    assert.equal(retryEvents.at(-1).payload.reissued_turn_id, retryJson.repo_turn_id);

    const secondAutopilot = await runCoordinatorAutopilot(planId, {
      dir: workspace,
      mission: missionId,
      autoApprove: true,
      maxWaves: '5',
      cooldown: '0',
      json: true,
    });
    const secondAutopilotJson = parseJsonResult(secondAutopilot, 'follow-up autopilot');
    assert.equal(secondAutopilotJson.summary.terminal_reason, 'plan_completed');

    const finalPlan = await loadSyncedPlanArtifact(workspace, missionId, planId);
    assert.equal(finalPlan.status, 'completed', 'plan must complete after the follow-up autopilot run');

    assert.ok(
      finalPlan.launch_records.some((record) => record.workstream_id === 'ws-followup' && record.status === 'completed'),
      'ws-followup must have its own completed coordinator launch record',
    );
  });
});
