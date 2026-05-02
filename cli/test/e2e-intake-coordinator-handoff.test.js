/**
 * E2E intake coordinator handoff
 *
 * Validates the real CLI-subprocess path from repo-local intake intent to
 * coordinator-managed execution and back to source-repo resolution.
 *
 * See: .planning/E2E_INTAKE_COORDINATOR_HANDOFF_SPEC.md
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function createWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-e2e-intake-handoff-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  mkdirSync(apiRepo, { recursive: true });
  mkdirSync(webRepo, { recursive: true });

  createGovernedRepo(apiRepo, 'api');
  createGovernedRepo(webRepo, 'web');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'handoff-e2e', name: 'Handoff E2E' },
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
    '--signal', '{"description":"coordinator handoff e2e"}',
    '--evidence', '{"type":"text","value":"operator reported cross-repo work"}',
    '--json',
  ]), 'intake record');

  const intentId = record.intent.intent_id;

  parseJsonResult(runCli(repoRoot, [
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'cli-tool',
    '--charter', 'Coordinate api and web delivery from a repo-local intake signal',
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

  const plan = parseJsonResult(runCli(repoRoot, [
    'intake', 'plan',
    '--intent', intentId,
    '--project-name', 'Handoff E2E',
    '--json',
  ]), 'intake plan');

  assert.ok(Array.isArray(plan.intent.planning_artifacts));
  assert.ok(plan.intent.planning_artifacts.length > 0, 'plan must create planning artifacts');
  for (const relPath of plan.intent.planning_artifacts) {
    assert.ok(existsSync(join(repoRoot, relPath)), `missing planning artifact ${relPath}`);
  }

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
  const changedFile = `src/${repoId}-handoff-e2e.js`;
  const isApi = repoId === 'api';
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, changedFile), `export const ${repoId}HandoffE2E = "${summary}";\n`);

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
        id: isApi ? 'DEC-101' : 'DEC-201',
        category: 'implementation',
        statement: `${repoId} accepted coordinator-managed intake work`,
        rationale: 'The coordinator handoff path must be proven through repo authority.',
      },
    ],
    objections: [
      {
        id: isApi ? 'OBJ-101' : 'OBJ-201',
        severity: 'low',
        statement: 'This proof covers the happy path only.',
        status: 'raised',
      },
    ],
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

  return activeTurn.turn_id;
}

describe('E2E intake coordinator handoff', () => {
  it('AT-HANDOFF-E2E-001 through AT-HANDOFF-E2E-005: handoff drives coordinator execution and source-repo completion through real CLI subprocesses', () => {
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
      assert.equal(handoff.intent.target_workstream.workstream_id, 'delivery');
      assert.equal(handoff.intent.target_workstream.super_run_id, init.super_run_id);

      const earlyResolve = parseJsonResult(runCli(apiRepo, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]), 'intake resolve before coordinator completion');
      assert.equal(earlyResolve.ok, true);
      assert.equal(earlyResolve.no_change, true);
      assert.equal(earlyResolve.run_outcome, 'active');
      const earlyIntent = readJson(join(apiRepo, '.agentxchain', 'intake', 'intents', `${intentId}.json`));
      assert.equal(earlyIntent.status, 'executing');

      const firstDispatch = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step api dispatch');
      assert.equal(firstDispatch.repo_id, 'api');
      assert.equal(firstDispatch.workstream_id, 'delivery');

      const apiContext = readJson(join(firstDispatch.bundle_path, 'COORDINATOR_CONTEXT.json'));
      assert.equal(apiContext.intake_handoffs.length, 1);
      assert.equal(apiContext.intake_handoffs[0].intent_id, intentId);

      stageAcceptedTurn(apiRepo, 'api', 'API completed intake handoff work');
      const apiAccept = runCli(apiRepo, ['accept-turn']);
      assert.equal(apiAccept.exitCode, 0, apiAccept.combined);

      const secondDispatch = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step web dispatch');
      assert.equal(secondDispatch.repo_id, 'web');
      assert.equal(secondDispatch.workstream_id, 'delivery');

      const webContext = readJson(join(secondDispatch.bundle_path, 'COORDINATOR_CONTEXT.json'));
      assert.equal(webContext.upstream_acceptances.length, 1);
      assert.equal(webContext.upstream_acceptances[0].repo_id, 'api');
      assert.equal(webContext.intake_handoffs.length, 1);
      assert.equal(webContext.intake_handoffs[0].intent_id, intentId);

      stageAcceptedTurn(webRepo, 'web', 'Web completed intake handoff work');
      const webAccept = runCli(webRepo, ['accept-turn']);
      assert.equal(webAccept.exitCode, 0, webAccept.combined);

      const completionGate = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step completion gate');
      assert.equal(completionGate.action, 'run_completion_requested');
      assert.equal(completionGate.gate_type, 'run_completion');

      const approveGate = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approveGate.exitCode, 0, approveGate.combined);

      const coordinatorState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
      assert.equal(coordinatorState.status, 'completed');

      const barriers = readJson(join(workspace, '.agentxchain', 'multirepo', 'barriers.json'));
      assert.equal(barriers.delivery_completion.status, 'satisfied');

      const finalResolve = parseJsonResult(runCli(apiRepo, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]), 'intake resolve after coordinator completion');
      assert.equal(finalResolve.ok, true);
      assert.equal(finalResolve.new_status, 'completed');
      assert.equal(finalResolve.run_outcome, 'completed');

      const finalIntent = readJson(join(apiRepo, '.agentxchain', 'intake', 'intents', `${intentId}.json`));
      assert.equal(finalIntent.status, 'completed');
      assert.equal(finalIntent.target_run, null);
      assert.equal(finalIntent.target_workstream.workstream_id, 'delivery');
      assert.equal(finalIntent.target_workstream.super_run_id, init.super_run_id);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
