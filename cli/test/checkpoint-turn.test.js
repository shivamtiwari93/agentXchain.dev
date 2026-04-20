import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { checkpointAcceptedTurn, detectPendingCheckpoint } from '../src/lib/turn-checkpoint.js';
import { acceptTurnCommand } from '../src/commands/accept-turn.js';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), `axc-checkpoint-${randomBytes(6).toString('hex')}-`));
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const raw = readFileSync(join(root, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function invokeAcceptTurn(root, opts) {
  const previousCwd = process.cwd();
  const previousLog = console.log;
  const previousExit = process.exit;
  const lines = [];

  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };
  process.exit = ((code = 0) => {
    throw new Error(`EXIT_${code}`);
  });

  try {
    process.chdir(root);
    await acceptTurnCommand(opts);
    return { status: 0, output: lines.join('\n') };
  } catch (err) {
    if (typeof err?.message === 'string' && err.message.startsWith('EXIT_')) {
      return {
        status: Number(err.message.slice('EXIT_'.length)),
        output: lines.join('\n'),
      };
    }
    throw err;
  } finally {
    process.chdir(previousCwd);
    console.log = previousLog;
    process.exit = previousExit;
  }
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'checkpoint-test', name: 'Checkpoint Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Review', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-qa', runtime: 'local-qa' },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.stdin.resume()'], prompt_transport: 'stdin' },
      'local-qa': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.stdin.resume()'], prompt_transport: 'stdin' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

function initGovernedGitRepo(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
  writeFileSync(join(root, 'README.md'), '# Checkpoint test\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "checkpoint@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Checkpoint Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, initResult.error);
  return config;
}

function stageAcceptedDevTurn(root, config) {
  const assign = assignGovernedTurn(root, config, 'dev');
  assert.ok(assign.ok, assign.error);
  const turn = Object.values(assign.state.active_turns)[0];

  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');

  const stagingPath = getTurnStagingResultPath(turn.turn_id);
  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, stagingPath), JSON.stringify({
    schema_version: '1.0',
    run_id: assign.state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Implemented checkpointable change.',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Review follow-up later.', status: 'raised' }],
    files_changed: ['src/app.js'],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  }, null, 2));

  const accept = acceptGovernedTurn(root, config, { turnId: turn.turn_id });
  assert.ok(accept.ok, accept.error);
  return turn.turn_id;
}

describe('turn checkpointing', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('checkpointAcceptedTurn commits only the accepted turn files_changed paths', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);
    writeFileSync(join(root, 'notes.txt'), 'unrelated dirty file\n');

    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    assert.ok(checkpoint.ok, checkpoint.error);
    assert.ok(checkpoint.checkpoint_sha);

    const state = readJson(root, STATE_PATH);
    assert.equal(state.last_completed_turn.turn_id, turnId);
    assert.equal(state.last_completed_turn.checkpoint_sha, checkpoint.checkpoint_sha);

    const history = readJsonl(root, '.agentxchain/history.jsonl');
    const acceptedEntry = history.find((entry) => entry.turn_id === turnId);
    assert.equal(acceptedEntry.checkpoint_sha, checkpoint.checkpoint_sha);

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    assert.ok(events.some((entry) => entry.event_type === 'turn_checkpointed' && entry.turn?.turn_id === turnId));

    const committedFiles = execSync('git show --name-only --pretty=format:%s HEAD', {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(committedFiles, new RegExp(`^checkpoint: ${turnId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(committedFiles, /src\/app\.js/);
    assert.doesNotMatch(committedFiles, /notes\.txt/);

    const status = execSync('git status --short', { cwd: root, encoding: 'utf8' });
    assert.match(status, /\?\? notes\.txt/);
    assert.doesNotMatch(status, /src\/app\.js/);
  });

  it('checkpointAcceptedTurn fails loudly when declared files_changed paths are genuinely absent from git', () => {
    const config = initGovernedGitRepo(root);
    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, assign.error);
    const turn = Object.values(assign.state.active_turns)[0];

    writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');

    const stagingPath = getTurnStagingResultPath(turn.turn_id);
    mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
    writeFileSync(join(root, stagingPath), JSON.stringify({
      schema_version: '1.0',
      run_id: assign.state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Declared a path that does not exist.',
      decisions: [],
      objections: [],
      files_changed: ['src/app.js', 'src/never-existed.js'],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      run_completion_request: false,
      needs_human_reason: null,
      cost: { usd: 0.01 },
    }, null, 2));

    const accept = acceptGovernedTurn(root, config, { turnId: turn.turn_id });
    assert.ok(accept.ok, accept.error);

    const checkpoint = checkpointAcceptedTurn(root, { turnId: turn.turn_id });
    assert.equal(checkpoint.ok, false);
    // `git add -A -- <never-existed>` fatals before staging completes, which
    // is itself a loud failure consistent with the spec requirement that
    // genuinely missing paths refuse to checkpoint.
    assert.match(checkpoint.error, /Failed to stage accepted files for checkpoint|Checkpoint completeness failure/);
    assert.match(checkpoint.error, /src\/never-existed\.js/);

    const headSubject = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(headSubject, 'initial');

    const status = execSync('git status --short', { cwd: root, encoding: 'utf8' });
    assert.match(status, /src\/app\.js/);
  });

  it('checkpointAcceptedTurn succeeds when a declared path was pre-committed by the actor before checkpoint', () => {
    // BUG-23 historical pattern — dev committed the file itself before
    // checkpoint-turn. The BUG-55A completeness gate must recognise the path
    // as already-in-HEAD rather than missing.
    const config = initGovernedGitRepo(root);
    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, assign.error);
    const turn = Object.values(assign.state.active_turns)[0];

    writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
    execSync('git add src/app.js', { cwd: root, stdio: 'ignore' });
    execSync('git commit -m "dev: app.js"', { cwd: root, stdio: 'ignore' });

    const stagingPath = getTurnStagingResultPath(turn.turn_id);
    mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
    writeFileSync(join(root, stagingPath), JSON.stringify({
      schema_version: '1.0',
      run_id: assign.state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Actor committed the declared file before checkpoint.',
      decisions: [],
      objections: [],
      files_changed: ['src/app.js'],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      run_completion_request: false,
      needs_human_reason: null,
      cost: { usd: 0.01 },
    }, null, 2));

    const accept = acceptGovernedTurn(root, config, { turnId: turn.turn_id });
    assert.ok(accept.ok, accept.error);

    const checkpoint = checkpointAcceptedTurn(root, { turnId: turn.turn_id });
    assert.equal(checkpoint.ok, true, checkpoint.error);
    assert.deepEqual(checkpoint.already_committed_upstream, ['src/app.js']);
  });

  it('accept-turn --checkpoint preserves the accepted turn when checkpoint commit fails', async () => {
    const config = initGovernedGitRepo(root);
    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, assign.error);
    const turn = Object.values(assign.state.active_turns)[0];
    writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
    const stagingPath = getTurnStagingResultPath(turn.turn_id);
    mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
    writeFileSync(join(root, stagingPath), JSON.stringify({
      schema_version: '1.0',
      run_id: assign.state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'CLI checkpoint should fail after acceptance.',
      decisions: [],
      objections: [{ id: 'OBJ-002', severity: 'low', statement: 'Looks fine.', status: 'raised' }],
      files_changed: ['src/app.js'],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      run_completion_request: false,
      needs_human_reason: null,
      cost: { usd: 0.01 },
    }, null, 2));

    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    const preCommitHook = join(root, '.git', 'hooks', 'pre-commit');
    writeFileSync(preCommitHook, '#!/bin/sh\nexit 1\n');
    chmodSync(preCommitHook, 0o755);

    const result = await invokeAcceptTurn(root, { turn: turn.turn_id, checkpoint: true });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Checkpoint:\s+accepted but checkpoint failed/);
    assert.match(result.output, new RegExp(`Retry:\\s+agentxchain checkpoint-turn --turn ${turn.turn_id}`));

    const state = readJson(root, STATE_PATH);
    assert.equal(state.last_completed_turn_id, turn.turn_id);
    assert.equal(state.last_completed_turn?.turn_id, undefined);

    const history = readJsonl(root, '.agentxchain/history.jsonl');
    const acceptedEntry = history.find((entry) => entry.turn_id === turn.turn_id);
    assert.ok(acceptedEntry, 'accepted history entry should exist');
    assert.equal(acceptedEntry.checkpoint_sha ?? null, null);

    const headSubject = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(headSubject, 'initial');

    const status = execSync('git status --short', { cwd: root, encoding: 'utf8' });
    assert.match(status, /src\/app\.js/);
  });

  it('next authoritative assignment points at checkpoint-turn when the latest accepted turn is still dirty', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);

    const assignNext = assignGovernedTurn(root, config, 'qa');
    assert.equal(assignNext.ok, false);
    assert.match(assignNext.error, new RegExp(`checkpoint-turn --turn ${turnId}`));
  });

  it('checkpointAcceptedTurn ignores operational files leaked into history files_changed', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({ poisoned: true }, null, 2));

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const history = readJsonl(root, '.agentxchain/history.jsonl').map((entry) => (
      entry.turn_id === turnId
        ? {
            ...entry,
            files_changed: [
              'src/app.js',
              '.agentxchain/state.json',
              '.agentxchain/staging/turn_fake/result.json',
              '.agentxchain/dispatch/turn_fake/PROMPT.md',
            ],
          }
        : entry
    ));
    writeFileSync(historyPath, `${history.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    assert.ok(checkpoint.ok, checkpoint.error);
    assert.ok(checkpoint.checkpoint_sha);

    const committedFiles = execSync('git show --name-only --pretty=format:%s HEAD', {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(committedFiles, /src\/app\.js/);
    assert.doesNotMatch(committedFiles, /\.agentxchain\/state\.json/);
    assert.equal(readJson(root, '.agentxchain/state.json').poisoned, true);
  });

  it('checkpointAcceptedTurn recovers latest legacy-empty files_changed from actor dirty files', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const history = readJsonl(root, '.agentxchain/history.jsonl').map((entry) => (
      entry.turn_id === turnId
        ? {
            ...entry,
            files_changed: [],
            observed_artifact: {
              ...(entry.observed_artifact || {}),
              files_changed: [],
            },
          }
        : entry
    ));
    writeFileSync(historyPath, `${history.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    assert.ok(checkpoint.ok, checkpoint.error);
    assert.ok(checkpoint.checkpoint_sha);

    const repairedHistory = readJsonl(root, '.agentxchain/history.jsonl');
    const repairedEntry = repairedHistory.find((entry) => entry.turn_id === turnId);
    assert.deepEqual(repairedEntry.files_changed, ['src/app.js']);
    assert.equal(repairedEntry.files_changed_recovery_source, 'legacy_dirty_worktree');
    assert.ok(repairedEntry.files_changed_recovered_at);
    assert.deepEqual(repairedEntry.observed_artifact.files_changed, ['src/app.js']);

    const committedFiles = execSync('git show --name-only --pretty=format:%s HEAD', {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(committedFiles, /src\/app\.js/);
  });

  it('detectPendingCheckpoint ignores operational dirty files when evaluating accepted-turn dirt', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);

    const pending = detectPendingCheckpoint(root, [
      'src/app.js',
      '.agentxchain/state.json',
      '.agentxchain/staging/turn_fake/result.json',
    ]);
    assert.equal(pending.required, true);
    assert.equal(pending.turn_id, turnId);

    const operationalOnly = detectPendingCheckpoint(root, [
      '.agentxchain/state.json',
      '.agentxchain/staging/turn_fake/result.json',
      '.agentxchain/dispatch/turn_fake/PROMPT.md',
    ]);
    assert.equal(operationalOnly.required, false);
  });

  it('detectPendingCheckpoint flags legacy-empty files_changed when latest accepted turn still owns the dirty files', () => {
    const config = initGovernedGitRepo(root);
    const turnId = stageAcceptedDevTurn(root, config);

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const history = readJsonl(root, '.agentxchain/history.jsonl').map((entry) => (
      entry.turn_id === turnId
        ? {
            ...entry,
            files_changed: [],
            observed_artifact: {
              ...(entry.observed_artifact || {}),
              files_changed: [],
            },
          }
        : entry
    ));
    writeFileSync(historyPath, `${history.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const pending = detectPendingCheckpoint(root, ['src/app.js']);
    assert.equal(pending.required, true);
    assert.equal(pending.turn_id, turnId);
    assert.deepEqual(pending.recovered_files_changed, ['src/app.js']);
    assert.match(pending.message, /legacy-empty files_changed history/);
  });
});
