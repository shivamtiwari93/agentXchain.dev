/**
 * BUG-46 beta-tester scenario: acceptance/checkpoint/resume must agree when
 * reproducible-verification replay commands generate repo side effects.
 *
 * Exact deadlock class reproduced:
 *   1. Authoritative QA turn stages `files_changed: []`
 *   2. Acceptance observes a clean actor diff
 *   3. Acceptance replays `verification.machine_evidence` in the live repo
 *   4. Replay command writes actor-owned files (.planning + fixture outputs)
 *   5. Acceptance succeeds, checkpoint-turn skips (no files_changed), resume blocks
 *
 * The fix requirement is NOT "make checkpoint-turn smarter." The accepted turn
 * must never leave replay-only workspace dirt stranded in the live repo.
 *
 * Proof surface:
 *   - real CLI `accept-turn`
 *   - real CLI `checkpoint-turn`
 *   - real CLI `resume --role qa`
 *   - authoritative + local_cli QA role
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { checkCleanBaseline } from '../../src/lib/repo-observer.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

const REPLAY_SIDE_EFFECT_PATHS = [
  '.planning/RELEASE_NOTES.md',
  '.planning/acceptance-matrix.md',
  '.planning/ship-verdict.md',
  'tests/fixtures/express-sample/tusq.manifest.json',
  'tests/fixtures/express-sample/tusq-tools/get_users_users.json',
  'tests/fixtures/express-sample/tusq-tools/index.json',
  'tests/fixtures/express-sample/tusq-tools/post_users_users.json',
];

const REPLAY_SIDE_EFFECT_SCRIPT = [
  "const { mkdirSync, writeFileSync } = require('node:fs');",
  "mkdirSync('.planning', { recursive: true });",
  "mkdirSync('tests/fixtures/express-sample/tusq-tools', { recursive: true });",
  "writeFileSync('.planning/RELEASE_NOTES.md', '# replay release notes\\n');",
  "writeFileSync('.planning/acceptance-matrix.md', '# replay acceptance matrix\\n');",
  "writeFileSync('.planning/ship-verdict.md', '# replay ship verdict\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq.manifest.json', '{\\\"ok\\\":true}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/get_users_users.json', '{\\\"name\\\":\\\"get_users_users\\\"}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/index.json', '{\\\"name\\\":\\\"index\\\"}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/post_users_users.json', '{\\\"name\\\":\\\"post_users_users\\\"}\\n');",
].join(' ');

const REPLAY_COMMAND = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(REPLAY_SIDE_EFFECT_SCRIPT)}`;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeConfig({
  roleId = 'qa',
  roleTitle = 'QA',
  roleMandate = 'Verify and ship.',
  runtimeId = `local-${roleId}`,
} = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug46-test', name: 'BUG-46 Test', default_branch: 'main' },
    roles: {
      [roleId]: {
        title: roleTitle,
        mandate: roleMandate,
        write_authority: 'authoritative',
        runtime: runtimeId,
      },
    },
    runtimes: {
      [runtimeId]: {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      [roleId]: { entry_role: roleId, allowed_next_roles: [roleId], exit_gate: `${roleId}_complete` },
    },
    gates: {
      [`${roleId}_complete`]: {},
    },
    policies: [
      { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' },
    ],
  };
}

function createProject(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug46-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-46\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(options), null, 2) + '\n');

  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', 'README.md', 'agentxchain.json']);
  git(root, ['commit', '-m', 'init']);

  const config = makeConfig(options);
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);

  const roleId = options.roleId || 'qa';
  const assign = assignGovernedTurn(root, config, roleId);
  assert.ok(assign.ok, assign.error);

  return { root, config, turnId: assign.turn.turn_id, runId: init.state.run_id };
}

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
}

function materializeReplaySideEffects(root) {
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools'), { recursive: true });
  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# replay release notes\n');
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# replay acceptance matrix\n');
  writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# replay ship verdict\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq.manifest.json'), '{"ok":true}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'get_users_users.json'), '{"name":"get_users_users"}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'index.json'), '{"name":"index"}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'post_users_users.json'), '{"name":"post_users_users"}\n');
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-46: post-acceptance replay side effects do not deadlock checkpoint-turn and resume', () => {
  it('accept-turn rejects workspace artifact with empty files_changed for authoritative completed turns', () => {
    const { root, turnId, runId } = createProject();

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'QA verified the release candidate and replayed machine evidence.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: REPLAY_COMMAND, exit_code: 0 },
        ],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.notEqual(accept.status, 0,
      `accept-turn must reject workspace artifact with empty files_changed:\n${accept.stdout}\n${accept.stderr}`);
    assert.match(accept.stdout + accept.stderr,
      /artifact\.type: "workspace" but files_changed is empty/,
      'rejection message must explain the workspace/files_changed mismatch');
  });

  it('accept-turn rejects undeclared actor-owned dirt using the same contract resume enforces', () => {
    const { root, turnId, runId } = createProject();

    mkdirSync(join(root, '.planning'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# ship verdict\n');
    writeFileSync(join(root, 'src', 'rogue.js'), 'export const rogue = true;\n');

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'QA updated the ship verdict but left unrelated workspace dirt behind.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/ship-verdict.md'],
      verification: {
        status: 'pass',
        machine_evidence: [],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.notEqual(accept.status, 0,
      `accept-turn must reject unexpected dirty actor files:\n${accept.stdout}\n${accept.stderr}`);
    assert.match(accept.stdout + accept.stderr, /Resume would block on the same files/);
    assert.match(accept.stdout + accept.stderr, /src\/rogue\.js/);
  });

  it('authoritative QA turn can explicitly ignore verification-produced files and proceed cleanly', () => {
    const { root, turnId, runId } = createProject();
    materializeReplaySideEffects(root);

    // The correct fix for verification-only side effects: declare them
    // explicitly as ignored produced files so acceptance restores them.
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'QA verified the release candidate — review only, no repo mutations.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'ignore',
        })),
      },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'qa',
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `accept-turn should succeed for review artifact with empty files_changed:\n${accept.stdout}\n${accept.stderr}`);

    for (const relPath of REPLAY_SIDE_EFFECT_PATHS) {
      assert.equal(existsSync(join(root, relPath)), false,
        `ignored verification-produced file must be cleaned: ${relPath}`);
    }

    const checkpoint = spawnSync('node', [CLI_PATH, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `checkpoint-turn should skip cleanly for review turns:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const resume = spawnSync('node', [CLI_PATH, 'resume', '--role', 'qa'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `resume must succeed after review acceptance:\n${resume.stdout}\n${resume.stderr}`);
  });

  it('verification.produced_files artifact entries are promoted into files_changed and checkpointed', () => {
    const { root, turnId, runId } = createProject();
    materializeReplaySideEffects(root);

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'QA produced fixture outputs during verification and wants them checkpointed.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'artifact',
        })),
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `accept-turn should accept explicit artifact verification outputs:\n${accept.stdout}\n${accept.stderr}`);

    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const accepted = history.find((entry) => entry.turn_id === turnId);
    assert.ok(accepted, 'accepted turn in history');
    for (const relPath of REPLAY_SIDE_EFFECT_PATHS) {
      assert.ok(accepted.files_changed.includes(relPath),
        `history must promote verification artifact path into files_changed: ${relPath}`);
    }

    const checkpoint = spawnSync('node', [CLI_PATH, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `checkpoint-turn should commit promoted verification artifact files:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    assert.doesNotMatch(checkpoint.stdout, /no writable files_changed/i,
      'checkpoint-turn should not skip explicit artifact verification outputs');

    const resume = spawnSync('node', [CLI_PATH, 'resume', '--role', 'qa'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `resume must succeed after checkpointing verification artifact outputs:\n${resume.stdout}\n${resume.stderr}`);
  });

  it('replay side effects are cleaned while preserving real turn-owned files_changed', () => {
    const { root, turnId, runId } = createProject();

    // The turn declares a real file change — this must survive replay cleanup.
    const turnOwnedFile = 'src/app.js';
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, turnOwnedFile), 'export default function app() { return "v2"; }\n');

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'QA modified app.js and replayed verification commands that produce side effects.',
      decisions: [],
      objections: [],
      files_changed: [turnOwnedFile],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: REPLAY_COMMAND, exit_code: 0 },
        ],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `accept-turn should succeed:\n${accept.stdout}\n${accept.stderr}`);

    // Replay-only side effects must be cleaned
    for (const relPath of REPLAY_SIDE_EFFECT_PATHS) {
      assert.equal(existsSync(join(root, relPath)), false,
        `replay-only side effect must not remain: ${relPath}`);
    }

    // Turn-owned file must survive
    assert.equal(existsSync(join(root, turnOwnedFile)), true,
      'turn-owned file must NOT be cleaned by replay guard');
    assert.equal(readFileSync(join(root, turnOwnedFile), 'utf8'),
      'export default function app() { return "v2"; }\n',
      'turn-owned file content must be preserved');

    // History must record the real files_changed
    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const accepted = history.find((entry) => entry.turn_id === turnId);
    assert.ok(accepted, 'accepted turn in history');
    assert.ok(accepted.files_changed.includes(turnOwnedFile),
      'history must include the turn-owned file in files_changed');
    assert.equal(accepted.verification_replay?.overall, 'match',
      'replay result must still be recorded');

    // Checkpoint must work with the real files_changed
    const checkpoint = spawnSync('node', [CLI_PATH, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `checkpoint-turn should commit the turn-owned file:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    assert.doesNotMatch(checkpoint.stdout, /no writable files_changed/i,
      'checkpoint-turn should NOT skip — the turn has real files_changed');
  });

  it('arbitrary authoritative local_cli roles follow the same replay cleanup contract', () => {
    const roleId = 'product_marketing';
    const runtimeId = 'local-product-marketing';
    const { root, turnId, runId } = createProject({
      roleId,
      roleTitle: 'Product Marketing',
      roleMandate: 'Ship evidence-backed release communication.',
      runtimeId,
    });
    materializeReplaySideEffects(root);

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: roleId,
      runtime_id: runtimeId,
      status: 'completed',
      summary: 'Product marketing verified release artifacts without owning repo mutations.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'ignore',
        })),
      },
      artifact: { type: 'review', ref: null },
      proposed_next_role: roleId,
    });

    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `accept-turn should succeed for arbitrary authoritative review artifact:\n${accept.stdout}\n${accept.stderr}`);

    for (const relPath of REPLAY_SIDE_EFFECT_PATHS) {
      assert.equal(existsSync(join(root, relPath)), false,
        `ignored verification-produced file must be cleaned for ${roleId}: ${relPath}`);
    }

    const checkpoint = spawnSync('node', [CLI_PATH, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `checkpoint-turn should skip cleanly for arbitrary review turn:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const resume = spawnSync('node', [CLI_PATH, 'resume', '--role', roleId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `resume must succeed after arbitrary-role review acceptance:\n${resume.stdout}\n${resume.stderr}`);
  });
});
