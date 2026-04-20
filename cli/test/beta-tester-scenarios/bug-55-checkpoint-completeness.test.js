/**
 * BUG-55 beta-tester scenario: checkpoint-turn completeness.
 *
 * HUMAN-ROADMAP BUG-55 sub-defect A says checkpoint-turn must commit the
 * entire declared `files_changed` set and leave the worktree clean after
 * `accept-turn` + `checkpoint-turn`.
 *
 * This test mirrors that exact command chain with separate CLI invocations.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  STATE_PATH,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

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
  const dir = mkdtempSync(join(tmpdir(), `axc-bug55-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug55-test', name: 'BUG-55 Test', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Verify and prepare launch signoff.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
      launch: {
        title: 'Launch',
        mandate: 'Ship.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-qa': {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
        prompt_transport: 'stdin',
      },
    },
    routing: {
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'launch', 'human'] },
      launch: { entry_role: 'launch', allowed_next_roles: ['launch', 'human'] },
    },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: '.agentxchain/TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

function seedProject() {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n');
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');
  writeFileSync(join(root, 'tests', 'smoke.mjs'), 'export const smoke = true;\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug55@test.local']);
  git(root, ['config', 'user.name', 'BUG-55 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'qa');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n- qa shipped notes\n');
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\n\n- qa evidence\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');
  writeFileSync(join(root, 'tests', 'smoke.mjs'), 'export const smoke = "qa";\n');

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'QA updated release evidence and smoke coverage.',
    decisions: [],
    objections: [],
    files_changed: [
      '.planning/RELEASE_NOTES.md',
      '.planning/acceptance-matrix.md',
      'src/cli.js',
      'tests/smoke.mjs',
    ],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'launch',
    phase_transition_request: 'launch',
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id };
}

afterEach(() => {
  while (tempDirs.length) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-55 checkpoint completeness', () => {
  it('accept-turn + checkpoint-turn commits every declared file and leaves the tree clean', () => {
    const { root, turnId } = seedProject();

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0, `accept-turn must succeed:\n${accept.stdout}\n${accept.stderr}`);

    const checkpoint = spawnSync(process.execPath, [CLI_PATH, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0, `checkpoint-turn must succeed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const headSha = git(root, ['rev-parse', 'HEAD']);
    const committedFiles = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', headSha])
      .split('\n')
      .filter(Boolean)
      .sort();
    assert.deepEqual(committedFiles, [
      '.planning/RELEASE_NOTES.md',
      '.planning/acceptance-matrix.md',
      'src/cli.js',
      'tests/smoke.mjs',
    ]);

    const status = git(root, ['status', '--short']);
    assert.equal(status, '', `git status must be clean after checkpoint; got:\n${status}`);

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    assert.match(state.accepted_integration_ref, /^git:/);
  });
});
