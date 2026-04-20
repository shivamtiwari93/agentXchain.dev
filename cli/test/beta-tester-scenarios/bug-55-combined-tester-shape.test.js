/**
 * BUG-55 combined operator-shape regression.
 *
 * The tester report described a SINGLE QA turn that exhibited both
 * BUG-55 sub-defects in one repo state:
 *   sub-A: declared files_changed left dirty after checkpoint
 *          (.planning/RELEASE_NOTES.md, .planning/acceptance-matrix.md,
 *           src/cli.js, tests/smoke.mjs)
 *   sub-B: verification commands produced undeclared fixture outputs
 *          (tests/fixtures/fastify-sample/.tusq/scan.json,
 *           tests/fixtures/fastify-sample/tusq.config.json,
 *           tests/fixtures/nest-sample/.tusq/scan.json,
 *           tests/fixtures/nest-sample/tusq.config.json)
 *
 * The two existing scenario tests cover each sub-defect in isolation.
 * Per HUMAN-ROADMAP rule #13 + GPT 5.4 Turn 78 next-action #1, this
 * regression mirrors the tester's exact paths in one repo state and
 * exercises the operator command chain (accept-turn → checkpoint-turn)
 * via separate child-process CLI invocations.
 *
 * Spec: .planning/BUG_55_COMBINED_OPERATOR_SHAPE_SPEC.md
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

// Tester-reported dirty paths from sub-defect A (run_5fa4a26c3973e02d).
const DECLARED_FILES = [
  '.planning/RELEASE_NOTES.md',
  '.planning/acceptance-matrix.md',
  'src/cli.js',
  'tests/smoke.mjs',
];

// Tester-reported undeclared verification outputs from sub-defect B.
const FIXTURE_FILES = [
  'tests/fixtures/fastify-sample/.tusq/scan.json',
  'tests/fixtures/fastify-sample/tusq.config.json',
  'tests/fixtures/nest-sample/.tusq/scan.json',
  'tests/fixtures/nest-sample/tusq.config.json',
];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), `axc-bug55c-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug55c-test', name: 'BUG-55 Combined Test', default_branch: 'main' },
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

/**
 * Seed a project that mirrors the tester's exact combined sub-A + sub-B
 * shape. The QA turn declares the four sub-A dirty paths under
 * `files_changed`, AND its verification commands produce the four
 * sub-B fixture outputs in the working tree. Whether the four fixtures
 * are also declared under `verification.produced_files` is controlled
 * by the `producedFiles` argument so both branches can share the seed.
 */
function seedProject({ producedFiles }) {
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
  git(root, ['config', 'user.email', 'bug55c@test.local']);
  git(root, ['config', 'user.name', 'BUG-55 Combined Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'qa');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // Actor mutations the turn declares under files_changed (sub-A scope).
  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n- qa shipped notes\n');
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\n\n- qa evidence\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');
  writeFileSync(join(root, 'tests', 'smoke.mjs'), 'export const smoke = "qa";\n');

  // Verification side-effects: fixture files written by tusq scans (sub-B scope).
  for (const fixturePath of FIXTURE_FILES) {
    const fullPath = join(root, fixturePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, JSON.stringify({ scan: 'ok', path: fixturePath }, null, 2));
  }

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'QA updated release evidence + smoke; verification scans produced fixture outputs.',
    decisions: [],
    objections: [],
    files_changed: DECLARED_FILES,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node tests/smoke.mjs', 'tusq scan tests/fixtures/fastify-sample', 'tusq scan tests/fixtures/nest-sample'],
      evidence_summary: 'smoke + tusq scans passed',
      machine_evidence: [
        { command: 'node tests/smoke.mjs', exit_code: 0 },
        { command: 'tusq scan tests/fixtures/fastify-sample', exit_code: 0 },
        { command: 'tusq scan tests/fixtures/nest-sample', exit_code: 0 },
      ],
      ...(producedFiles ? { produced_files: producedFiles } : {}),
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'launch',
    phase_transition_request: 'launch',
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  return { root, turnId: turn.turn_id, runId: assign.state.run_id };
}

function readEvents(root) {
  const eventsPath = join(root, RUN_EVENTS_PATH);
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
  });
}

afterEach(() => {
  while (tempDirs.length) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-55 combined operator shape — tester paths', () => {
  it('rejects accept-turn when both sub-A actor mutations AND undeclared sub-B fixtures exist together', () => {
    const { root, turnId } = seedProject({ producedFiles: null });

    const accept = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.notEqual(
      accept.status,
      0,
      `accept-turn must reject combined sub-A+sub-B undeclared shape; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    const combined = `${accept.stdout}\n${accept.stderr}`;
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
      `expected error_code 'undeclared_verification_outputs'; got: ${JSON.stringify(failure.payload)}`,
    );

    const unexpected = Array.isArray(failure.payload?.unexpected_dirty_files)
      ? failure.payload.unexpected_dirty_files
      : [];
    for (const fixturePath of FIXTURE_FILES) {
      assert.ok(
        unexpected.includes(fixturePath),
        `acceptance_failed payload must list every undeclared fixture path; missing ${fixturePath}; got: ${JSON.stringify(unexpected)}`,
      );
    }

    // Declared sub-A files should NOT be in the unexpected list — they were
    // declared, so the rejection is purely about the sub-B fixtures.
    for (const declaredPath of DECLARED_FILES) {
      assert.ok(
        !unexpected.includes(declaredPath),
        `declared files_changed path must not be flagged as unexpected; ${declaredPath} leaked into: ${JSON.stringify(unexpected)}`,
      );
    }

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    const failedTurn = state.active_turns?.[turnId];
    assert.ok(failedTurn, 'turn must still be present on state');
    assert.equal(failedTurn.status, 'failed_acceptance');
  });

  it('accept-turn + checkpoint-turn leaves a clean tree when sub-A files_changed AND sub-B produced_files are both declared', () => {
    const { root, turnId } = seedProject({
      producedFiles: FIXTURE_FILES.map((path) => ({ path, disposition: 'ignore' })),
    });

    const accept = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(
      accept.status,
      0,
      `accept-turn must succeed when both contracts are declared; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    // BUG-46 cleanup: ignored verification outputs are removed from the tree.
    for (const fixturePath of FIXTURE_FILES) {
      assert.ok(
        !existsSync(join(root, fixturePath)),
        `ignored verification fixture must be cleaned up after accept-turn; still present: ${fixturePath}`,
      );
    }

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(
      checkpoint.status,
      0,
      `checkpoint-turn must succeed; got stdout:\n${checkpoint.stdout}\nstderr:\n${checkpoint.stderr}`,
    );

    // BUG-55 sub-A: every declared file is in the HEAD commit; nothing else from the four declared paths is dropped.
    const headSha = git(root, ['rev-parse', 'HEAD']);
    const committedFiles = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', headSha])
      .split('\n')
      .filter(Boolean)
      .sort();
    for (const declaredPath of DECLARED_FILES) {
      assert.ok(
        committedFiles.includes(declaredPath),
        `checkpoint must commit every declared files_changed path; missing ${declaredPath} in HEAD tree: ${JSON.stringify(committedFiles)}`,
      );
    }

    // No fixture files leaked into the checkpoint commit.
    for (const fixturePath of FIXTURE_FILES) {
      assert.ok(
        !committedFiles.includes(fixturePath),
        `ignored fixture must not be committed; ${fixturePath} leaked into checkpoint commit ${headSha}`,
      );
    }

    // The full operator-shape closure proof: clean working tree.
    const status = git(root, ['status', '--short']);
    assert.equal(
      status,
      '',
      `git status must be clean after combined accept-turn + checkpoint-turn chain; got:\n${status}`,
    );

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    assert.match(state.accepted_integration_ref, /^git:/);
    assert.equal(state.last_completed_turn_id, turnId);
  });
});
