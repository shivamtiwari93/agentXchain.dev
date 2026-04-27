/**
 * BUG-91 beta-tester scenario:
 * baseline-dirty unchanged files should not block turn acceptance.
 *
 * HUMAN-ROADMAP BUG-91: dev turn blocked because
 * `.planning/dogfood-100-turn-evidence/turn-counter.jsonl` was dirty
 * at dispatch baseline and still dirty (unchanged) at acceptance time.
 * The acceptance check flagged it as "dirty and not classified" even
 * though the turn did not create or modify the file.
 *
 * The framework should exclude files that were dirty at dispatch baseline
 * and have the same SHA marker at acceptance — they are inherited workspace
 * state, not turn-attributed mutations.
 *
 * This test mirrors the tester's exact scenario per Rule #12.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  refreshTurnBaselineSnapshot,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';
import { RUN_EVENTS_PATH } from '../../src/lib/run-events.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const CLI_PATH = join(ROOT, 'cli', 'bin', 'agentxchain.js');
const tempDirs = [];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), `axc-bug91-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug91-test', name: 'BUG-91 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Dev',
        mandate: 'Implement features and run verification.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
        prompt_transport: 'stdin',
      },
    },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
    },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: '.agentxchain/TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

const EVIDENCE_FILE = '.planning/dogfood-100-turn-evidence/turn-counter.jsonl';
const UNTRACKED_EVIDENCE_FILE = '.planning/dogfood-100-turn-evidence/bug-90-reverify-v2.155.44.md';
const NON_EXEMPT_BASELINE_FILE = '.planning/operator-note.md';

/**
 * Seed a project where a non-product evidence file becomes dirty AFTER
 * assignment, then refresh the baseline to include it (simulating the
 * continuous loop's refreshTurnBaselineSnapshot behavior). The file remains
 * unchanged between baseline refresh and acceptance.
 */
function seedBaselineDirtyUnchanged() {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning', 'dogfood-100-turn-evidence'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');
  // Commit the evidence file initially so modifying it makes it dirty (tracked)
  writeFileSync(join(root, NON_EXEMPT_BASELINE_FILE), 'operator note v0\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug91@test.local']);
  git(root, ['config', 'user.name', 'BUG-91 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  // Initialize governed run on clean tree
  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  // Assign turn on clean tree
  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // NOW make the evidence file dirty (simulates dogfood writes between turns)
  writeFileSync(join(root, EVIDENCE_FILE), '{"counter_value":0}\n{"counter_value":1}\n');

  // Refresh the baseline to capture the newly dirty evidence file
  // (mirrors what the continuous loop does via refreshTurnBaselineSnapshot)
  const refresh = refreshTurnBaselineSnapshot(root, turn.turn_id);
  assert.ok(refresh.ok, refresh.error);
  assert.ok(refresh.refreshed_files.includes(EVIDENCE_FILE),
    `Expected ${EVIDENCE_FILE} to be refreshed into baseline, got: ${JSON.stringify(refresh.refreshed_files)}`);

  // Simulate the dev subprocess work: modify a declared file but NOT the evidence file
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');

  // Stage the turn result — declares src/cli.js but NOT the evidence file
  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Dev implemented feature.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node -e "console.log(1)"'],
      evidence_summary: 'Test passed.',
      machine_evidence: [{ command: 'node -e "console.log(1)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id, config };
}

function seedUntrackedDogfoodEvidenceDuringRecovery() {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning', 'dogfood-100-turn-evidence'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug91@test.local']);
  git(root, ['config', 'user.name', 'BUG-91 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // Dogfood bug-fix evidence may be created while the same failed turn is
  // retained across patch releases. It is proof metadata, not turn work.
  writeFileSync(join(root, UNTRACKED_EVIDENCE_FILE), '# BUG-90 reverify\n');

  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Dev implemented feature.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node -e "console.log(1)"'],
      evidence_summary: 'Test passed.',
      machine_evidence: [{ command: 'node -e "console.log(1)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id };
}

/**
 * Seed a project where a file is dirty at baseline but CHANGES during the turn
 * without being declared. This should still fail acceptance.
 */
function seedBaselineDirtyChanged() {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning', 'dogfood-100-turn-evidence'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');
  writeFileSync(join(root, EVIDENCE_FILE), '{"counter_value":0}\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug91@test.local']);
  git(root, ['config', 'user.name', 'BUG-91 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // Make a non-exempt planning file dirty and refresh baseline.
  writeFileSync(join(root, NON_EXEMPT_BASELINE_FILE), 'operator note v1\n');
  const refresh = refreshTurnBaselineSnapshot(root, turn.turn_id);
  assert.ok(refresh.ok, refresh.error);

  // Simulate dev work
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');

  // NOW CHANGE the non-exempt file AGAIN during the turn (unauthorized mutation)
  // The SHA will differ from what was captured in the refreshed baseline
  writeFileSync(join(root, NON_EXEMPT_BASELINE_FILE), 'operator note v2\n');

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Dev implemented feature.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node -e "console.log(1)"'],
      evidence_summary: 'Test passed.',
      machine_evidence: [{ command: 'node -e "console.log(1)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id, config };
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

describe('BUG-91: baseline-dirty unchanged files do not block acceptance', () => {
  it('accepts turn when evidence file is dirty at baseline and unchanged', () => {
    const { root, turnId } = seedBaselineDirtyUnchanged();

    // Run accept-turn via CLI — should succeed
    const result = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId, '--checkpoint'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Should not fail on the evidence file
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    const combined = stderr + stdout;
    assert.ok(
      !combined.includes('turn-counter.jsonl'),
      `Acceptance should not mention turn-counter.jsonl as dirty: ${combined.slice(0, 500)}`,
    );
    assert.strictEqual(result.status, 0, `accept-turn should exit 0, got ${result.status}. Output: ${combined.slice(0, 500)}`);

    // Verify the baseline_dirty_unchanged_excluded event was emitted
    const eventsPath = join(root, RUN_EVENTS_PATH);
    if (existsSync(eventsPath)) {
      const eventsContent = readFileSync(eventsPath, 'utf8');
      assert.ok(
        eventsContent.includes('baseline_dirty_unchanged_excluded'),
        'Expected baseline_dirty_unchanged_excluded audit event',
      );
    }
  });

  it('rejects turn when baseline-dirty file was modified during turn without being declared', () => {
    const { root, turnId } = seedBaselineDirtyChanged();

    const result = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId, '--checkpoint'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Should fail because the non-exempt baseline-dirty file changed since
    // baseline (different SHA)
    // The file is still dirty and not declared, so it should be flagged
    const combined = (result.stderr || '') + (result.stdout || '');
    // Accept either: non-zero exit code, or the file mentioned in output
    const failed = result.status !== 0;
    const mentionsFile = combined.includes('operator-note.md');
    assert.ok(
      failed || mentionsFile,
      `Expected acceptance to fail or mention the modified evidence file. Exit: ${result.status}. Output: ${combined.slice(0, 500)}`,
    );
  });

  it('command-chain: accept-turn succeeds via shipped CLI with baseline-dirty unchanged file', () => {
    const { root, turnId } = seedBaselineDirtyUnchanged();

    // Rule #12: command-chain test using the actual CLI binary
    const result = execFileSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId, '--checkpoint'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.ok(
      !result.includes('turn-counter.jsonl'),
      'CLI accept-turn should not mention turn-counter.jsonl',
    );
  });

  it('command-chain: accepts with untracked DOGFOOD-100 evidence present during recovery', () => {
    const { root, turnId } = seedUntrackedDogfoodEvidenceDuringRecovery();

    const result = execFileSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId, '--checkpoint'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.ok(
      !result.includes('bug-90-reverify-v2.155.44.md'),
      'CLI accept-turn should not blame dogfood recovery evidence',
    );
  });
});
