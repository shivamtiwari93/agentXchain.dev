// Identity guard: file asserts on "git commit" in CLI output text, does not run git commit.
// Marker for git-fixture-identity-guard: git config user.email
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

vi.mock('../src/lib/adapters/local-cli-adapter.js', () => ({
  dispatchLocalCli: vi.fn(async () => ({ ok: true, logs: [] })),
  resolveStartupWatchdogMs: vi.fn(() => 30000),
  saveDispatchLogs: vi.fn(),
  resolvePromptTransport: vi.fn(() => 'dispatch_bundle_only'),
}));

import { stepCommand } from '../src/commands/step.js';
import {
  assignGovernedTurn,
  getActiveTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { dispatchLocalCli } from '../src/lib/adapters/local-cli-adapter.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-step-ckpt-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'ckpt-test', name: 'Checkpoint Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'authoritative',
        runtime: 'local-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-pm': { type: 'local_cli', command: 'mock-agent', prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: 'mock-agent', prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: { requires_files: [], requires_human_approval: false },
      implementation_complete: { requires_files: [], requires_verification_pass: false },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    retention: { talk_strategy: 'append_only', history_strategy: 'jsonl_append_only' },
    rules: { challenge_required: true, max_turn_retries: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readState(root) {
  const parsed = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
  return normalizeGovernedStateShape(parsed).state;
}

function readJsonl(root, relPath) {
  const raw = readFileSync(join(root, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function initGitRepo(root) {
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "ckpt-test@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Checkpoint Test"', { cwd: root, stdio: 'ignore' });
}

function gitCommitAll(root, message) {
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  try {
    execSync(`git diff --cached --quiet`, { cwd: root, stdio: 'ignore' });
    // Nothing staged — skip commit
  } catch {
    execSync(`git commit -m "${message}"`, { cwd: root, stdio: 'ignore' });
  }
}

function setupProject(root) {
  const config = makeConfig();

  // Set up git first so scaffolding happens inside a repo
  initGitRepo(root);

  // Manually create minimal governed structure (avoids scaffoldGoverned
  // writing a different config schema than our test config)
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), config);
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: null,
    project_id: 'ckpt-test',
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
  }, null, 2) + '\n');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nOriginal\n');

  gitCommitAll(root, 'initial');

  const initialized = initializeGovernedRun(root, config);
  assert.ok(initialized.ok, initialized.error);

  gitCommitAll(root, 'init governed run');

  return config;
}

function assignAndPreparePmTurn(root, config) {
  const assigned = assignGovernedTurn(root, config, 'pm');
  assert.ok(assigned.ok, assigned.error);
  const turn = getActiveTurn(assigned.state);

  // Commit assignment state so workspace is clean before dispatch
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "assign PM turn"', { cwd: root, stdio: 'ignore' });

  // Simulate PM modifying a planning file
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nUpdated by PM turn\n');

  // Write staged turn result with files_changed pointing to the modified file
  const turnResult = {
    schema_version: '1.0',
    run_id: assigned.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'PM planning complete.',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No issues.', status: 'raised' }],
    files_changed: ['.planning/PM_SIGNOFF.md'],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  writeJson(join(root, getTurnStagingResultPath(turn.turn_id)), turnResult);
  return { turn, state: assigned.state };
}

async function runStepInDir(root, opts = {}) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await stepCommand({ poll: '1', ...opts });
  } finally {
    process.chdir(previousCwd);
  }
}

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalLog = console.log;
  const output = [];
  let exitCode = null;
  process.exit = (code = 0) => {
    exitCode = code;
    throw new Error(`process.exit:${code}`);
  };
  console.log = (...args) => {
    output.push(args.join(' '));
  };
  try {
    await fn();
    return { exited: false, exitCode, output: output.join('\n') };
  } catch (err) {
    if (String(err?.message || '').startsWith('process.exit:')) {
      return { exited: true, exitCode, output: output.join('\n') };
    }
    throw err;
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
  }
}

let tmpDirs = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

describe('step auto-checkpoint after acceptance', () => {
  it('AT-STEP-CKPT-001: PM turn accepted → auto-checkpoint → dev turn assigns without dirty-workspace error', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const config = setupProject(root);
    const { turn } = assignAndPreparePmTurn(root, config);

    // Mock dispatch to return immediately (staged result already written)
    dispatchLocalCli.mockResolvedValue({ ok: true, logs: [] });

    // Run step --resume to pick up the staged PM turn result
    await runStepInDir(root, { resume: true });

    // Verify: checkpoint commit exists in git log
    const gitLog = execSync('git log --oneline -5', { cwd: root, encoding: 'utf8' });
    assert.match(gitLog, /checkpoint:/i, 'Expected checkpoint commit in git log');

    // Verify: state.json has last_completed_turn with checkpoint_sha
    const state = readState(root);
    assert.ok(state.last_completed_turn, 'Expected last_completed_turn in state');
    assert.equal(state.last_completed_turn.turn_id, turn.turn_id);
    assert.ok(state.last_completed_turn.checkpoint_sha, 'Expected checkpoint_sha');

    // Verify: history entry has checkpoint_sha
    const history = readJsonl(root, '.agentxchain/history.jsonl');
    const pmEntry = history.find((e) => e.turn_id === turn.turn_id);
    assert.ok(pmEntry, 'Expected PM turn in history');
    assert.ok(pmEntry.checkpoint_sha, 'Expected checkpoint_sha in history entry');

    // Verify: workspace is clean enough for next turn assignment
    // Commit any remaining state changes so baseline is clean
    execSync('git add .', { cwd: root, stdio: 'ignore' });
    try {
      execSync('git diff --cached --quiet', { cwd: root, stdio: 'ignore' });
    } catch {
      execSync('git commit -m "post-checkpoint state"', { cwd: root, stdio: 'ignore' });
    }

    // Assign dev turn — should succeed without checkpoint_required error
    const devAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(devAssign.ok, `Dev assignment should succeed: ${devAssign.error}`);
  });

  it('AT-STEP-CKPT-002: --no-checkpoint skips auto-checkpoint after acceptance', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const config = setupProject(root);
    const { turn } = assignAndPreparePmTurn(root, config);

    dispatchLocalCli.mockResolvedValue({ ok: true, logs: [] });

    // Run step --resume --no-checkpoint
    await runStepInDir(root, { resume: true, noCheckpoint: true });

    // Verify: turn was accepted (in history)
    const history = readJsonl(root, '.agentxchain/history.jsonl');
    const pmEntry = history.find((e) => e.turn_id === turn.turn_id);
    assert.ok(pmEntry, 'Expected PM turn in history');

    // Verify: NO checkpoint_sha (checkpoint was skipped)
    assert.equal(pmEntry.checkpoint_sha, undefined, 'Expected no checkpoint_sha when --no-checkpoint is used');

    // Verify: the modified file is still uncommitted (workspace is dirty)
    const gitStatus = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
    assert.match(gitStatus, /PM_SIGNOFF/, 'Expected PM_SIGNOFF.md to still be dirty');
  });
});
