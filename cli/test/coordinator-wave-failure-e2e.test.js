/**
 * E2E coordinator wave-failure with real child-repo execution.
 *
 * Proves that coordinator autopilot wave-failure handling works through real
 * `local_cli` child runtimes instead of injected `_executeGovernedRun` callbacks.
 *
 * See: .planning/COORDINATOR_WAVE_FAILURE_REAL_AGENT_SPEC.md
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
const WAVE_FAILURE_AGENT = join(__dirname, '..', 'test-support', 'coordinator-wave-failure-agent.mjs');
const tempDirs = [];

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseJsonResult(result, label, expectedExitCode) {
  assert.equal(result.exitCode, expectedExitCode, `${label} exit code mismatch:\n${result.combined}`);
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
        args: [WAVE_FAILURE_AGENT],
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

async function makeWorkspace(workstreamOrder = ['ws-a', 'ws-b']) {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-wave-fail-real-'));
  tempDirs.push(workspace);

  writeGovernedRepo(workspace, 'coord-wave-fail-root');

  const repoA = join(workspace, 'repo-a');
  const repoB = join(workspace, 'repo-b');
  writeGovernedRepo(repoA, 'repo-a');
  writeGovernedRepo(repoB, 'repo-b');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-wave-fail', name: 'Coordinator Wave Failure Real Agent' },
    repos: {
      'repo-a': { path: './repo-a', default_branch: 'main', required: true },
      'repo-b': { path: './repo-b', default_branch: 'main', required: true },
    },
    workstreams: {
      'ws-a': {
        phase: 'implementation',
        repos: ['repo-a'],
        entry_repo: 'repo-a',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      'ws-b': {
        phase: 'implementation',
        repos: ['repo-b'],
        entry_repo: 'repo-b',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    workstream_order: workstreamOrder,
    routing: {
      implementation: { entry_workstream: workstreamOrder[0] },
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
    missionId: 'mission-wave-fail',
    title: 'Coordinator Wave Failure Real Agent Mission',
    goal: 'Prove wave-failure handling through real child runtimes',
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

  const plannerWorkstreams = workstreamOrder.map((id) => ({
    workstream_id: id,
    title: id === 'ws-a' ? 'Workstream A' : 'Workstream B',
    goal: id === 'ws-a' ? 'Work on repo-a' : 'Work on repo-b',
    roles: ['dev'],
    phases: ['implementation'],
    depends_on: [],
    acceptance_checks: [`${id === 'ws-a' ? 'repo-a' : 'repo-b'} accepted`],
  }));

  const created = createPlanArtifact(workspace, boundMission, {
    plannerOutput: { workstreams: plannerWorkstreams },
    coordinatorConfig,
  });
  assert.ok(created.ok, `plan creation must succeed: ${JSON.stringify(created.errors)}`);

  const approved = approvePlanArtifact(workspace, boundMission.mission_id, created.plan.plan_id);
  assert.ok(approved.ok, `plan approval must succeed: ${approved.error}`);

  return {
    workspace,
    repoA,
    repoB,
    missionId: boundMission.mission_id,
    planId: approved.plan.plan_id,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Coordinator wave failure with real agent execution', () => {
  it('AT-COORD-WAVE-FAIL-001: without --continue-on-failure, repo-a failure stops the wave loop and repo-b is never dispatched', async () => {
    // ws-a dispatches first (default order), repo-a agent always fails
    const { workspace, repoA, repoB, missionId, planId } = await makeWorkspace(['ws-a', 'ws-b']);

    const result = await runCoordinatorAutopilot(planId, {
      dir: workspace,
      mission: missionId,
      autoApprove: true,
      maxWaves: '5',
      cooldown: '0',
      json: true,
      continueOnFailure: false,
    });

    const parsed = parseJsonResult(result, 'autopilot (no continue-on-failure)', 1);

    // Terminal reason must be failure_stopped
    assert.equal(
      parsed.summary.terminal_reason,
      'failure_stopped',
      `terminal_reason must be 'failure_stopped' but got '${parsed.summary.terminal_reason}'`,
    );

    // Only one wave should have run
    assert.equal(parsed.summary.total_waves, 1, 'only one wave should have executed before stopping');

    // At least one workstream must be counted as failed
    assert.ok(parsed.summary.failed >= 1, `total_failed must be >= 1 but got ${parsed.summary.failed}`);

    // Exit code must be 1
    assert.equal(result.exitCode, 1, 'exitCode must be 1 when the wave stops on failure');

    // ws-a must appear as needs_attention in wave results
    const wave1 = parsed.waves[0];
    assert.ok(wave1, 'wave 1 must exist in output');
    const wsAEntry = wave1.results.find((r) => r.workstream_id === 'ws-a');
    assert.ok(wsAEntry, 'ws-a must appear in wave results');
    assert.equal(wsAEntry.status, 'needs_attention', `ws-a status must be 'needs_attention' but got '${wsAEntry.status}'`);

    // ws-b must be skipped or absent (never dispatched)
    const wsBEntry = wave1.results.find((r) => r.workstream_id === 'ws-b');
    if (wsBEntry) {
      assert.equal(wsBEntry.status, 'skipped', `ws-b must be 'skipped' when present, got '${wsBEntry.status}'`);
      assert.match(wsBEntry.skip_reason || '', /prior workstream failed/, 'ws-b skip_reason must mention prior workstream failure');
    }

    // repo-b must NOT have any agent-written artifacts (proves it was never dispatched)
    assert.ok(
      !existsSync(join(repoB, 'src')),
      'repo-b must NOT have agent-written artifacts — it should never have been dispatched',
    );

    // repo-a must NOT have agent-written artifacts either (agent exits before writing)
    assert.ok(
      !existsSync(join(repoA, 'src')),
      'repo-a must NOT have agent-written artifacts — agent exits with code 1 before writing',
    );
  });

  it('AT-COORD-WAVE-FAIL-002: with --continue-on-failure, repo-b succeeds and repo-a fails with plan_incomplete', async () => {
    // ws-b dispatches first, repo-b succeeds; then ws-a dispatches, repo-a fails
    const { workspace, repoA, repoB, missionId, planId } = await makeWorkspace(['ws-b', 'ws-a']);

    const result = await runCoordinatorAutopilot(planId, {
      dir: workspace,
      mission: missionId,
      autoApprove: true,
      maxWaves: '5',
      cooldown: '0',
      json: true,
      continueOnFailure: true,
    });

    const parsed = parseJsonResult(result, 'autopilot (continue-on-failure)', 1);

    // Exit code must be 1 because not all workstreams completed
    assert.equal(result.exitCode, 1, 'exitCode must be 1 when the plan is not fully completed');

    // Terminal reason should be plan_incomplete or failure_stopped
    const acceptableReasons = ['plan_incomplete', 'failure_stopped'];
    assert.ok(
      acceptableReasons.includes(parsed.summary.terminal_reason),
      `terminal_reason must be one of ${JSON.stringify(acceptableReasons)} but got '${parsed.summary.terminal_reason}'`,
    );

    // At least one failed
    assert.ok(parsed.summary.failed >= 1, `total_failed must be >= 1 but got ${parsed.summary.failed}`);

    // ws-b must appear as dispatched (successful)
    const allWaveEntries = parsed.waves.flatMap((wave) => wave.results);
    const wsBEntry = allWaveEntries.find((r) => r.workstream_id === 'ws-b');
    assert.ok(wsBEntry, 'ws-b must appear in wave results');
    assert.equal(wsBEntry.status, 'dispatched', `ws-b status must be 'dispatched' but got '${wsBEntry.status}'`);

    // ws-a must appear as needs_attention
    const wsAEntry = allWaveEntries.find((r) => r.workstream_id === 'ws-a');
    assert.ok(wsAEntry, 'ws-a must appear in wave results');
    assert.equal(wsAEntry.status, 'needs_attention', `ws-a status must be 'needs_attention' but got '${wsAEntry.status}'`);

    // AT-COORD-WAVE-FAIL-004: repo-b must have agent-written artifacts (proves real execution)
    assert.ok(
      existsSync(join(repoB, 'src', 'output.js')),
      'repo-b must have agent-written implementation artifact — proves real local_cli execution happened',
    );
    const artifactContent = readFileSync(join(repoB, 'src', 'output.js'), 'utf8');
    assert.match(artifactContent, /wave-failure:repo-b/, 'artifact must contain repo proof marker');

    // repo-a must NOT have agent-written artifacts (agent exits before writing)
    assert.ok(
      !existsSync(join(repoA, 'src')),
      'repo-a must NOT have agent-written artifacts — agent exits with code 1 before writing',
    );
  });
});
