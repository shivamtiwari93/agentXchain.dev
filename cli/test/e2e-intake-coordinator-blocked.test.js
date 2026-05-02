/**
 * E2E intake coordinator blocked path
 *
 * Proves that when a coordinator enters `blocked` via a real hook violation
 * (not a synthetic state edit), source-repo `intake resolve` transitions
 * the handoff intent to `blocked` — not `failed`, not `completed`.
 *
 * See: .planning/E2E_INTAKE_COORDINATOR_BLOCKED_SPEC.md
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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

/**
 * Build a tamper-trigger hook script that writes to a protected coordinator
 * state file. The hook runner will detect this as tampering, restore the
 * file, and return ok: false — which causes blockCoordinator().
 */
function tamperHookScript(workspacePath) {
  // The hook modifies the coordinator state file (a protected path).
  // The hook runner checksums protected paths before/after execution and
  // detects the tamper, restoring the original content.
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
  const workspace = mkdtempSync(join(tmpdir(), 'axc-e2e-blocked-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  mkdirSync(apiRepo, { recursive: true });
  mkdirSync(webRepo, { recursive: true });

  createGovernedRepo(apiRepo, 'api');
  createGovernedRepo(webRepo, 'web');

  // Coordinator config WITH an after_acceptance hook that tampers with
  // the coordinator state file. This is the hook violation that drives
  // the coordinator into blocked state.
  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'blocked-e2e', name: 'Blocked E2E' },
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
    '--signal', '{"description":"coordinator blocked e2e"}',
    '--evidence', '{"type":"text","value":"operator reported cross-repo work that will hit a hook violation"}',
    '--json',
  ]), 'intake record');

  const intentId = record.intent.intent_id;

  parseJsonResult(runCli(repoRoot, [
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'cli-tool',
    '--charter', 'Coordinate delivery that will be blocked by hook violation',
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
    '--project-name', 'Blocked E2E',
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
  const changedFile = `src/${repoId}-blocked-e2e.js`;
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, changedFile), `export const ${repoId}BlockedE2E = "${summary}";\n`);

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
        id: 'DEC-301',
        category: 'implementation',
        statement: `${repoId} accepted coordinator-managed intake work`,
        rationale: 'Testing the blocked path via hook violation.',
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

  return activeTurn.turn_id;
}

describe('E2E intake coordinator blocked path', () => {
  it('AT-BLOCKED-E2E-001 through 006: hook violation blocks coordinator and intake resolve transitions intent to blocked', () => {
    const { workspace, apiRepo } = createWorkspace();

    try {
      // Step 1: Create a planned intent via the full intake lifecycle
      const intentId = createPlannedIntent(apiRepo);

      // Step 2: Initialize coordinator
      const init = parseJsonResult(runCli(workspace, ['multi', 'init', '--json']), 'multi init');
      assert.ok(init.super_run_id, 'multi init must return super_run_id');

      // Step 3: Handoff intent to coordinator workstream
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

      // Step 4: Dispatch first turn to api (entry repo)
      const dispatch = parseJsonResult(runCli(workspace, ['multi', 'step', '--json']), 'multi step dispatch');
      assert.equal(dispatch.repo_id, 'api');
      assert.equal(dispatch.workstream_id, 'delivery');

      // Step 5: Stage and accept turn in api repo
      stageAcceptedTurn(apiRepo, 'api', 'API completed work before hook violation');
      const acceptResult = runCli(apiRepo, ['accept-turn']);
      assert.equal(acceptResult.exitCode, 0, `accept-turn failed:\n${acceptResult.combined}`);

      // Step 6: multi step triggers resync → after_acceptance hook → tamper → blocked
      // The after_acceptance hook tampers with the coordinator state file.
      // The hook runner detects this, restores the file, and returns ok: false.
      // multi.js then calls blockCoordinator() with coordinator_hook_violation reason.
      const blockedStep = runCli(workspace, ['multi', 'step', '--json']);
      assert.notEqual(blockedStep.exitCode, 0, 'multi step should fail when coordinator is blocked by hook violation');
      assert.ok(
        blockedStep.combined.includes('blocked') || blockedStep.combined.includes('hook'),
        `Expected blocked/hook message in output:\n${blockedStep.combined}`,
      );

      // AT-BLOCKED-E2E-001: Verify coordinator is actually in blocked state
      const coordinatorState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
      assert.equal(coordinatorState.status, 'blocked', 'coordinator must be in blocked state');
      assert.ok(
        coordinatorState.blocked_reason.includes('coordinator_hook_violation'),
        `blocked_reason must reference hook violation, got: ${coordinatorState.blocked_reason}`,
      );

      // Step 7: intake resolve should transition intent to blocked
      const resolve = parseJsonResult(runCli(apiRepo, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]), 'intake resolve after coordinator blocked');

      // AT-BLOCKED-E2E-002: Intent transitions from executing to blocked
      assert.equal(resolve.ok, true);
      assert.equal(resolve.new_status, 'blocked', 'intake resolve must transition to blocked, not failed');
      assert.equal(resolve.run_outcome, 'blocked');

      // AT-BLOCKED-E2E-006: NOT failed — blocked is recoverable, failed is terminal
      assert.notEqual(resolve.new_status, 'failed', 'blocked coordinator must not map to failed intent');
      assert.notEqual(resolve.new_status, 'completed', 'blocked coordinator must not map to completed intent');

      // Read the intent artifact for detailed field assertions
      const intent = readJson(join(apiRepo, '.agentxchain', 'intake', 'intents', `${intentId}.json`));

      // AT-BLOCKED-E2E-003: run_blocked_reason contains hook violation info
      assert.equal(intent.status, 'blocked');
      assert.ok(
        intent.run_blocked_reason.includes('coordinator_hook_violation'),
        `run_blocked_reason must reference hook violation, got: ${intent.run_blocked_reason}`,
      );

      // AT-BLOCKED-E2E-004: run_blocked_recovery provides actionable guidance
      assert.ok(
        intent.run_blocked_on && intent.run_blocked_on.includes('coordinator'),
        `run_blocked_on must reference coordinator, got: ${intent.run_blocked_on}`,
      );
      assert.ok(
        intent.run_blocked_recovery && intent.run_blocked_recovery.length > 0,
        'run_blocked_recovery must provide recovery guidance',
      );

      // AT-BLOCKED-E2E-005: Intent history records the correct transition
      const blockTransition = intent.history.find(h => h.to === 'blocked');
      assert.ok(blockTransition, 'intent history must contain a transition to blocked');
      assert.equal(blockTransition.from, 'executing', 'blocked transition must come from executing');
      assert.equal(blockTransition.run_status, 'blocked', 'history must record coordinator run_status as blocked');
      assert.equal(blockTransition.super_run_id, init.super_run_id, 'history must record the super_run_id');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
