/**
 * BUG-92 beta-tester scenario:
 * a full-auto run resumed after a substrate fix must reattempt acceptance of
 * an active failed_acceptance turn before assigning any new turn.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  refreshTurnBaselineSnapshot,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const CLI_PATH = join(ROOT, 'cli', 'bin', 'agentxchain.js');
const EVIDENCE_FILE = '.planning/dogfood-100-turn-evidence/turn-counter.jsonl';
const tempDirs = [];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), `axc-bug92-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug92-test', name: 'BUG-92 Test', default_branch: 'main' },
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

function seedFailedAcceptance({ withStaging }) {
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
  git(root, ['config', 'user.email', 'bug92@test.local']);
  git(root, ['config', 'user.name', 'BUG-92 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);
  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  writeFileSync(join(root, EVIDENCE_FILE), '{"counter_value":0}\n{"counter_value":1}\n');
  const refresh = refreshTurnBaselineSnapshot(root, turn.turn_id);
  assert.ok(refresh.ok, refresh.error);
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');

  if (withStaging) {
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
  }

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.active_turns[turn.turn_id].status = 'failed_acceptance';
  state.active_turns[turn.turn_id].failure_reason = 'previous substrate version rejected baseline-dirty unchanged file';
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  return { root, turnId: turn.turn_id };
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

describe('BUG-92: run resumes failed_acceptance turns by reattempting staged acceptance', () => {
  it('command-chain: run reaccepts failed_acceptance staged result before assigning', () => {
    const { root, turnId } = seedFailedAcceptance({ withStaging: true });

    const result = spawnSync(process.execPath, [CLI_PATH, 'run', '--max-turns', '1', '--auto-approve', '--auto-checkpoint'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const combined = `${result.stdout || ''}${result.stderr || ''}`;

    assert.equal(result.status, 0, combined);
    assert.doesNotMatch(combined, /Turn already assigned/);
    assert.match(combined, new RegExp(`Turn accepted: ${turnId}`));
  });

  it('missing staged result blocks with missing-staging guidance, not duplicate assignment', () => {
    const { root } = seedFailedAcceptance({ withStaging: false });

    const result = spawnSync(process.execPath, [CLI_PATH, 'run', '--max-turns', '1', '--auto-approve'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const combined = `${result.stdout || ''}${result.stderr || ''}`;

    assert.notEqual(result.status, 0, combined);
    assert.match(combined, /missing staged result/);
    assert.doesNotMatch(combined, /Turn already assigned/);
  });
});
