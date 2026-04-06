/**
 * E2E intake coordinator blocked recovery path
 *
 * Proves the full workflow-kit recovery path:
 * repo-local intake signal -> coordinator handoff -> real blocked coordinator ->
 * operator fixes coordinator hook -> multi resume -> coordinator completion ->
 * source-repo intake resolve transitions blocked intent to completed.
 *
 * See: .planning/COORDINATOR_BLOCKED_RECOVERY_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function gitCommitAll(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'ignore' });
  execSync(`git -c user.name="test" -c user.email="test@test" commit -m "${message}" --allow-empty`, {
    cwd,
    stdio: 'ignore',
  });
}

function initGitRepo(cwd, message) {
  execSync('git init', { cwd, stdio: 'ignore' });
  gitCommitAll(cwd, message);
}

function createGovernedRepo(root, projectId) {
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    protocol_mode: 'governed',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
    },
    runtimes: {
      'manual-dev': {
        type: 'manual',
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
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  });

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
  });

  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
}

function tamperHookScript(workspacePath) {
  const stateFile = join(workspacePath, '.agentxchain', 'multirepo', 'state.json');
  return [
    'node', '-e',
    `const fs = require("fs"); ` +
    `const f = ${JSON.stringify(stateFile)}; ` +
    `const d = JSON.parse(fs.readFileSync(f, "utf8")); ` +
    `d._tampered = true; ` +
    `fs.writeFileSync(f, JSON.stringify(d));`,
  ];
}

function createWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-e2e-recovery-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  mkdirSync(apiRepo, { recursive: true });
  mkdirSync(webRepo, { recursive: true });

  createGovernedRepo(apiRepo, 'api');
  createGovernedRepo(webRepo, 'web');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'recovery-e2e', name: 'Recovery E2E' },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      delivery: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'delivery' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
    hooks: {
      after_acceptance: [
        {
          name: 'tamper-trigger',
          type: 'process',
          command: tamperHookScript(workspace),
          timeout_ms: 5000,
        },
      ],
    },
  });

  initGitRepo(apiRepo, 'bootstrap api repo');
  initGitRepo(webRepo, 'bootstrap web repo');

  return { workspace, apiRepo, webRepo };
}

function parseJsonResult(result, label) {
  assert.equal(result.exitCode, 0, `${label} failed:\n${result.combined}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON:\n${result.stdout}\n${error.message}`);
  }
}

function createPlannedIntent(repoRoot) {
  const record = parseJsonResult(runCli(repoRoot, [
    'intake', 'record',
    '--source', 'manual',
    '--signal', '{"description":"coordinator recovery e2e"}',
    '--evidence', '{"type":"text","value":"operator reported cross-repo work that will recover after a hook failure"}',
    '--json',
  ]), 'intake record');

  const intentId = record.intent.intent_id;

  parseJsonResult(runCli(repoRoot, [
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'cli-tool',
    '--charter', 'Coordinate delivery that will block once and then recover cleanly',
    '--acceptance', 'api and web accept coordinated delivery work',
    '--json',
  ]), 'intake triage');

  parseJsonResult(runCli(repoRoot, [
    'intake', 'approve',
    '--intent', intentId,
    '--approver', 'e2e-operator',
    '--reason', 'cross-repo execution required',
    '--json',
  ]), 'intake approve');

  parseJsonResult(runCli(repoRoot, [
    'intake', 'plan',
    '--intent', intentId,
    '--project-name', 'Recovery E2E',
    '--json',
  ]), 'intake plan');

  gitCommitAll(repoRoot, 'commit planned intake artifacts');
  return intentId;
}

function getActiveTurn(repoRoot) {
  const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));
  const activeTurn = Object.values(state.active_turns || {})[0];
  assert.ok(activeTurn, `expected active turn in ${repoRoot}`);
  return { state, activeTurn };
}

function stageAcceptedTurn(repoRoot, repoId, summary) {
  const { state, activeTurn } = getActiveTurn(repoRoot);
  const changedFile = `src/${repoId}-recovery-e2e.js`;
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, changedFile), `export const ${repoId}RecoveryE2E = "${summary}";\n`);

  const stagingPath = join(repoRoot, getTurnStagingResultPath(activeTurn.turn_id));
  mkdirSync(dirname(stagingPath), { recursive: true });
  writeJson(stagingPath, {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: activeTurn.turn_id,
    role: activeTurn.assigned_role,
    runtime_id: activeTurn.runtime_id,
    status: 'completed',
    summary,
    decisions: [
      {
        id: repoId === 'api' ? 'DEC-401' : 'DEC-402',
        category: 'implementation',
        statement: `${repoId} accepted coordinator-managed recovery work`,
        rationale: 'The recovery path must prove repo-authoritative completion after a coordinator block.',
      },
    ],
    objections: [],
    files_changed: [changedFile],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node --eval "process.exit(0)"'],
      evidence_summary: `Synthetic acceptance proof for ${repoId}.`,
      machine_evidence: [
        { command: 'node --eval "process.exit(0)"', exit_code: 0 },
      ],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: true,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0 },
  });
}

function disableBrokenHook(workspace) {
  const configPath = join(workspace, 'agentxchain-multi.json');
  const config = readJson(configPath);
  delete config.hooks;
  writeJson(configPath, config);
}

describe('E2E intake coordinator blocked recovery path', () => {
  it('AT-MR-REC-E2E-001: blocked coordinator recovers through multi resume and source intent resolves from blocked to completed', () => {
    const { workspace, apiRepo, webRepo } = createWorkspace();

    try {
      const intentId = createPlannedIntent(apiRepo);
      const init = parseJsonResult(runCli(workspace, ['multi', 'init', '--json']), 'multi init');
      assert.ok(init.super_run_id, 'multi init must return super_run_id');

      const handoff = parseJsonResult(runCli(apiRepo, [
        'intake', 'handoff',
        '--intent', intentId,
        '--coordinator-root', '../..',
        '--workstream', 'delivery',
        '--json',
      ]), 'intake handoff');
      assert.equal(handoff.intent.status, 'executing');

      const firstDispatch = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step api dispatch');
      assert.equal(firstDispatch.repo_id, 'api');
      stageAcceptedTurn(apiRepo, 'api', 'API completed work before recovery');
      const apiAccept = runCli(apiRepo, ['accept-turn']);
      assert.equal(apiAccept.exitCode, 0, apiAccept.combined);

      const blockedStep = runCli(workspace, ['multi', 'step', '--json']);
      assert.notEqual(blockedStep.exitCode, 0, 'multi step should fail when hook violation blocks the coordinator');

      const blockedState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
      assert.equal(blockedState.status, 'blocked');
      assert.match(blockedState.blocked_reason, /coordinator_hook_violation/);

      const blockedResolve = parseJsonResult(runCli(apiRepo, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]), 'intake resolve after coordinator block');
      assert.equal(blockedResolve.new_status, 'blocked');

      disableBrokenHook(workspace);

      const resumed = parseJsonResult(runCli(workspace, ['multi', 'resume', '--json']), 'multi resume');
      assert.equal(resumed.ok, true);
      assert.equal(resumed.resumed_status, 'active');
      assert.match(resumed.blocked_reason, /coordinator_hook_violation/);

      const resumedState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
      assert.equal(resumedState.status, 'active');
      assert.ok(!('blocked_reason' in resumedState), 'blocked_reason should be cleared after resume');

      const history = readJsonLines(join(workspace, '.agentxchain', 'multirepo', 'history.jsonl'));
      const recoveryEntry = history.find((entry) => entry.type === 'blocked_resolved');
      assert.ok(recoveryEntry, 'coordinator history must record blocked_resolved');
      assert.equal(recoveryEntry.to, 'active');

      const secondDispatch = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step web dispatch after resume');
      assert.equal(secondDispatch.repo_id, 'web');
      stageAcceptedTurn(webRepo, 'web', 'Web completed work after coordinator recovery');
      const webAccept = runCli(webRepo, ['accept-turn']);
      assert.equal(webAccept.exitCode, 0, webAccept.combined);

      const completionGate = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step completion gate after resume');
      assert.equal(completionGate.action, 'run_completion_requested');

      const approveGate = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approveGate.exitCode, 0, approveGate.combined);

      const finalCoordinatorState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
      assert.equal(finalCoordinatorState.status, 'completed');

      const finalResolve = parseJsonResult(runCli(apiRepo, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]), 'intake resolve after coordinator recovery completion');
      assert.equal(finalResolve.new_status, 'completed');

      const finalIntent = readJson(join(apiRepo, '.agentxchain', 'intake', 'intents', `${intentId}.json`));
      assert.equal(finalIntent.status, 'completed');
      const transitions = finalIntent.history.map((entry) => `${entry.from}->${entry.to}`);
      assert.ok(transitions.includes('executing->blocked'), 'intent must record blocked transition');
      assert.ok(transitions.includes('blocked->completed'), 'intent must record blocked to completed recovery');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function readJsonLines(filePath) {
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return [];
  }
  return raw.split('\n').map((line) => JSON.parse(line));
}
