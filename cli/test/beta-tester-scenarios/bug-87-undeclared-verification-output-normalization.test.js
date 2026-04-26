/**
 * BUG-87 beta-tester scenario:
 * undeclared verification-produced file auto-normalization.
 *
 * HUMAN-ROADMAP BUG-87: dev turn blocked because `.tusq/plan.json`
 * was dirty and not classified under `verification.produced_files`,
 * even though the turn declared verification commands that produced it.
 *
 * The framework should auto-normalize: classify turn-produced dirty
 * files as verification.produced_files with disposition "ignore",
 * clean them up, and proceed with acceptance — instead of hard-erroring
 * the continuous loop.
 *
 * This test mirrors the tester's exact command chain per Rule #12.
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
  const dir = mkdtempSync(join(tmpdir(), `axc-bug87-${randomBytes(6).toString('hex')}-`));
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug87-test', name: 'BUG-87 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Dev',
        mandate: 'Implement features and run verification.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify.',
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
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: '.agentxchain/TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

const TOOL_OUTPUT_PATH = '.tusq/plan.json';

function seedProject({ toolOutputPath, preExistingDirty }) {
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

  // If testing pre-existing dirty file, create it before initial commit
  // so it's tracked and then modify it after init
  if (preExistingDirty) {
    const dirPath = join(root, toolOutputPath.split('/').slice(0, -1).join('/'));
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(root, toolOutputPath), JSON.stringify({ pre: 'existing' }));
  }

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug87@test.local']);
  git(root, ['config', 'user.name', 'BUG-87 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  // Simulate the dev subprocess work: modify a declared file
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');

  // Create the tool output file (verification side effect)
  const toolDir = join(root, toolOutputPath.split('/').slice(0, -1).join('/'));
  mkdirSync(toolDir, { recursive: true });
  if (preExistingDirty) {
    // Modify the pre-existing tracked file
    writeFileSync(join(root, toolOutputPath), JSON.stringify({ modified: 'by-verification' }));
  } else {
    // Create a NEW untracked file (verification produced it)
    writeFileSync(join(root, toolOutputPath), JSON.stringify({ plan: 'generated' }));
  }

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Dev implemented M30 with 16 smoke test assertions + eval scenario.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['npm test', 'node bin/tusq.js surface plan --help'],
      evidence_summary: 'npm test exits 0. CLI surface confirmed.',
      machine_evidence: [
        { command: 'npm test', exit_code: 0 },
        { command: 'node bin/tusq.js surface plan --help', exit_code: 0 },
      ],
      // Intentionally NO produced_files — this is the BUG-87 shape
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.05 },
  }, null, 2));

  return { root, turnId: turn.turn_id };
}

function seedProjectNoVerification() {
  const root = makeTmpDir();
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug87@test.local']);
  git(root, ['config', 'user.name', 'BUG-87 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);

  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');
  mkdirSync(join(root, '.tusq'), { recursive: true });
  writeFileSync(join(root, '.tusq/plan.json'), JSON.stringify({ plan: 'generated' }));

  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Dev implemented M30.',
    decisions: [],
    objections: [],
    files_changed: ['src/cli.js'],
    artifacts_created: [],
    // No verification declared at all
    verification: {
      status: 'skipped',
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.05 },
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

describe('BUG-87 — undeclared verification output auto-normalization', () => {
  it('auto-normalizes turn-produced .tusq/plan.json and accepts cleanly (command-chain)', () => {
    const { root, turnId } = seedProject({
      toolOutputPath: TOOL_OUTPUT_PATH,
      preExistingDirty: false,
    });

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(
      accept.status,
      0,
      `accept-turn must succeed via auto-normalization; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    // The tool output must have been cleaned up
    assert.ok(
      !existsSync(join(root, TOOL_OUTPUT_PATH)),
      'auto-normalized verification output must be cleaned up after acceptance',
    );

    // src/cli.js must remain as declared files_changed
    const status = git(root, ['status', '--short']);
    assert.ok(
      status.includes('src/cli.js'),
      `src/cli.js should remain as uncheckpointed mutation; got:\n${status}`,
    );
    assert.ok(
      !status.includes(TOOL_OUTPUT_PATH),
      `tool output should NOT appear in git status; got:\n${status}`,
    );

    // State must show completed turn
    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    assert.equal(state.last_completed_turn_id, turnId);

    // Auto-normalization event must be emitted
    const events = readEvents(root);
    const normalizeEvent = events.find(
      (e) => e.event_type === 'verification_output_auto_normalized',
    );
    assert.ok(
      normalizeEvent,
      `verification_output_auto_normalized event must exist; events: ${events.map((e) => e.event_type).join(', ')}`,
    );
    assert.ok(
      Array.isArray(normalizeEvent.payload?.auto_classified_files)
        && normalizeEvent.payload.auto_classified_files.includes(TOOL_OUTPUT_PATH),
      `event payload must list the auto-classified file; got: ${JSON.stringify(normalizeEvent.payload)}`,
    );
  });

  it('does NOT auto-normalize when verification is not declared (dirty tree mismatch)', () => {
    const { root, turnId } = seedProjectNoVerification();

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.notEqual(
      accept.status,
      0,
      `accept-turn must reject without verification; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    const events = readEvents(root);
    const failure = events.find((e) => e.event_type === 'acceptance_failed');
    assert.ok(failure, 'acceptance_failed event must exist');
    assert.equal(
      failure.payload?.error_code,
      'artifact_dirty_tree_mismatch',
      `error_code must be artifact_dirty_tree_mismatch (not undeclared_verification_outputs) when no verification declared; got: ${failure.payload?.error_code}`,
    );
  });

  it('auto-normalizes multiple tool-output files under different directories', () => {
    const root = makeTmpDir();
    const config = makeConfig();

    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });

    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
    writeFileSync(join(root, '.gitignore'), '.agentxchain/\nTALK.md\n');
    writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 1;\n');

    git(root, ['init']);
    git(root, ['config', 'user.email', 'bug87@test.local']);
    git(root, ['config', 'user.name', 'BUG-87 Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'initial']);

    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, initResult.error);

    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, assign.error);
    const turn = Object.values(assign.state.active_turns)[0];

    writeFileSync(join(root, 'src', 'cli.js'), 'export const version = 2;\n');
    mkdirSync(join(root, '.tusq'), { recursive: true });
    writeFileSync(join(root, '.tusq/plan.json'), '{}');
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'coverage/lcov.info'), 'TN:\n');

    mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
    writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
      schema_version: '1.0',
      run_id: assign.state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Dev implemented + ran tests.',
      decisions: [],
      objections: [],
      files_changed: ['src/cli.js'],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['npm test'],
        evidence_summary: 'tests passed',
        machine_evidence: [{ command: 'npm test', exit_code: 0 }],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      run_completion_request: false,
      needs_human_reason: null,
      cost: { usd: 0.01 },
    }, null, 2));

    const accept = spawnSync(process.execPath, [CLI_PATH, 'accept-turn', '--turn', turn.turn_id], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(
      accept.status,
      0,
      `accept-turn must succeed with multiple tool outputs; got stdout:\n${accept.stdout}\nstderr:\n${accept.stderr}`,
    );

    assert.ok(!existsSync(join(root, '.tusq/plan.json')), '.tusq/plan.json must be cleaned up');
    assert.ok(!existsSync(join(root, 'coverage/lcov.info')), 'coverage/lcov.info must be cleaned up');

    const state = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    assert.equal(state.last_completed_turn_id, turn.turn_id);
  });
});
