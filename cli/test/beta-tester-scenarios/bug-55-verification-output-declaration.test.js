/**
 * BUG-55 sub-defect B beta-tester scenario:
 * verification output declaration.
 *
 * HUMAN-ROADMAP BUG-55 sub-defect B says when a QA turn's verification
 * command produces untracked fixture files, acceptance must EITHER (a)
 * reject with an actionable error naming the undeclared files, OR (b)
 * succeed cleanly if the turn declared them under verification.produced_files.
 *
 * This test mirrors the tester's exact command chain: spawn `accept-turn`
 * as a child-process CLI invocation, and assert the real behavior both
 * with and without the declaration.
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
  STATE_PATH,
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
  const dir = mkdtempSync(join(tmpdir(), `axc-bug55b-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug55b-test', name: 'BUG-55B Test', default_branch: 'main' },
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

const FIXTURE_PATH = 'tests/fixtures/sample/.tusq/scan.json';

function seedProject({ producedFiles }) {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');
  writeFileSync(join(root, 'tests', 'smoke.mjs'), 'export const smoke = true;\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug55b@test.local']);
  git(root, ['config', 'user.name', 'BUG-55B Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'qa');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // Simulate the QA subprocess work: it mutated a declared file AND produced
  // a fixture output via its verification command.
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');
  mkdirSync(join(root, 'tests', 'fixtures', 'sample', '.tusq'), { recursive: true });
  writeFileSync(join(root, FIXTURE_PATH), JSON.stringify({ scan: 'ok' }, null, 2));

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'QA ran smoke tests and updated cli.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node tests/smoke.mjs'],
      evidence_summary: 'smoke tests passed',
      machine_evidence: [{ command: 'node tests/smoke.mjs', exit_code: 0 }],
      ...(producedFiles ? { produced_files: producedFiles } : {}),
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'launch',
    phase_transition_request: 'launch',
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id };
}

function readEvents(root) {
  const eventsPath = join(root, RUN_EVENTS_PATH);
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  while (tempDirs.length) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-55 sub-defect B — verification output declaration', () => {
  it('rejects acceptance when verification commands produced undeclared files, with actionable error', () => {
    const { root, turnId } = seedProject({ producedFiles: null });

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.notEqual(accept.status, 0, `accept-turn must reject; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`);

    const combined = `${accept.stdout}\n${accept.stderr}`;
    assert.ok(
      combined.includes(FIXTURE_PATH),
      `acceptance output must name the undeclared fixture file; got:\n${combined}`,
    );
    assert.ok(
      combined.includes('verification.produced_files'),
      `acceptance output must reference verification.produced_files as the remediation; got:\n${combined}`,
    );

    const events = readEvents(root);
    const failure = events.find((e) => e.event_type === 'acceptance_failed');
    assert.ok(failure, `acceptance_failed event must exist in ${RUN_EVENTS_PATH}`);
    assert.equal(
      failure.payload?.error_code,
      'undeclared_verification_outputs',
      `expected error_code 'undeclared_verification_outputs' for verification-output rejection; got: ${JSON.stringify(failure.payload)}`,
    );
    assert.ok(
      Array.isArray(failure.payload?.unexpected_dirty_files)
        && failure.payload.unexpected_dirty_files.includes(FIXTURE_PATH),
      `acceptance_failed event payload must list the undeclared fixture file in unexpected_dirty_files; got: ${JSON.stringify(failure.payload)}`,
    );

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    const failedTurn = state.active_turns?.[turnId];
    assert.ok(failedTurn, 'turn must still be present on state');
    assert.equal(failedTurn.status, 'failed_acceptance');
  });

  it('accepts cleanly when verification.produced_files declares the ignored fixture', () => {
    const { root, turnId } = seedProject({
      producedFiles: [{ path: FIXTURE_PATH, disposition: 'ignore' }],
    });

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(
      accept.status,
      0,
      `accept-turn must succeed when verification.produced_files declares the fixture; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    // The ignored fixture must have been cleaned up (BUG-46 cleanup path).
    assert.ok(
      !existsSync(join(root, FIXTURE_PATH)),
      'ignored verification-produced file must be cleaned up after acceptance',
    );

    // Working tree: src/cli.js remains as the declared files_changed mutation
    // (not yet checkpointed), and the fixture is gone.
    const status = git(root, ['status', '--short']);
    assert.ok(
      status.includes('src/cli.js'),
      `src/cli.js should remain as a declared uncheckpointed mutation; got:\n${status}`,
    );
    assert.ok(
      !status.includes(FIXTURE_PATH),
      `fixture file should NOT appear in git status after acceptance cleanup; got:\n${status}`,
    );

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    assert.equal(state.last_completed_turn_id, turnId);
  });
});
