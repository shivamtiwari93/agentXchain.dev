import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');

const dirs = [];

after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJsonl(path) {
  const raw = readFileSync(path, 'utf8').trim();
  return raw ? raw.split('\n').map((line) => JSON.parse(line)) : [];
}

function setupGovernedGitProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug62-'));
  dirs.push(dir);
  scaffoldGoverned(dir, 'BUG-62 Fixture', 'bug-62-fixture');

  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = {
    ...readJson(statePath),
    run_id: 'run_bug62',
    status: 'active',
    phase: 'implementation',
    current_phase: 'implementation',
    last_completed_turn_id: 'turn_checkpointed',
    active_turns: {},
    current_turn: null,
  };
  writeJson(statePath, state);

  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'checkpoint baseline']);
  const baseline = git(dir, ['rev-parse', 'HEAD']);

  writeJson(statePath, {
    ...state,
    accepted_integration_ref: `git:${baseline}`,
    last_completed_turn: {
      turn_id: 'turn_checkpointed',
      role: 'dev',
      phase: 'implementation',
      checkpoint_sha: baseline,
      checkpointed_at: '2026-04-22T00:00:00Z',
      intent_id: 'intent_bug62',
    },
  });
  writeJson(join(dir, '.agentxchain', 'session.json'), {
    session_id: 'session_bug62',
    run_id: 'run_bug62',
    started_at: '2026-04-22T00:00:00Z',
    last_checkpoint_at: '2026-04-22T00:00:00Z',
    checkpoint_reason: 'turn_checkpointed',
    run_status: 'active',
    phase: 'implementation',
    last_phase: 'implementation',
    last_turn_id: 'turn_checkpointed',
    last_completed_turn_id: 'turn_checkpointed',
    active_turn_ids: [],
    last_role: 'dev',
    baseline_ref: {
      git_head: baseline,
      git_branch: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      workspace_dirty: false,
    },
  });

  return {
    dir,
    baseline,
  };
}

describe('BUG-62 operator commit reconcile command-chain', () => {
  it('AT-BUG62-001 accepts safe fast-forward operator commits as the new baseline', () => {
    const { dir, baseline } = setupGovernedGitProject();

    writeFileSync(join(dir, 'src-bug62.txt'), 'operator recovery work\n');
    git(dir, ['add', 'src-bug62.txt']);
    git(dir, ['commit', '-m', 'operator: add recovery artifact']);
    const operatorHead = git(dir, ['rev-parse', 'HEAD']);
    assert.notEqual(operatorHead, baseline);

    const drift = runCli(dir, ['status']);
    assert.equal(drift.status, 0, `status failed: ${drift.stdout}\n${drift.stderr}`);
    assert.match(drift.stdout, /Git HEAD has moved since checkpoint/);
    assert.match(drift.stdout, /agentxchain reconcile-state --accept-operator-head/);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 0, `reconcile failed: ${reconcile.stdout}\n${reconcile.stderr}`);
    assert.match(reconcile.stdout, /Reconciled 1 operator commit/);
    assert.match(reconcile.stdout, /src-bug62\.txt/);

    const state = readJson(join(dir, '.agentxchain', 'state.json'));
    assert.equal(state.accepted_integration_ref, `git:${operatorHead}`);
    assert.equal(state.operator_commit_reconciliation.previous_baseline, baseline);
    assert.equal(state.operator_commit_reconciliation.accepted_head, operatorHead);

    const session = readJson(join(dir, '.agentxchain', 'session.json'));
    assert.equal(session.checkpoint_reason, 'operator_commit_reconciled');
    assert.equal(session.baseline_ref.git_head, operatorHead);

    const events = readJsonl(join(dir, '.agentxchain', 'events.jsonl'));
    const event = events.find((entry) => entry.event_type === 'state_reconciled_operator_commits');
    assert.ok(event, 'expected state_reconciled_operator_commits event');
    assert.equal(event.payload.previous_baseline, baseline);
    assert.equal(event.payload.accepted_head, operatorHead);
    assert.deepEqual(event.payload.paths_touched, ['src-bug62.txt']);
    assert.equal(event.payload.accepted_commits[0].sha, operatorHead);

    const statusJson = runCli(dir, ['status', '--json']);
    assert.equal(statusJson.status, 0, `status --json failed: ${statusJson.stdout}\n${statusJson.stderr}`);
    const payload = JSON.parse(statusJson.stdout);
    assert.equal(payload.continuity.drift_detected, false);
  });

  it('AT-BUG62-002 refuses operator commits that modify governed state files', () => {
    const { dir } = setupGovernedGitProject();

    const statePath = join(dir, '.agentxchain', 'state.json');
    writeJson(statePath, {
      ...readJson(statePath),
      unsafe_operator_edit: true,
    });
    git(dir, ['add', '-f', '.agentxchain/state.json']);
    git(dir, ['commit', '-m', 'operator: edit governed state']);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 1, `reconcile unexpectedly succeeded: ${reconcile.stdout}`);
    assert.match(reconcile.stdout, /governance_state_modified/);
    assert.match(reconcile.stdout, /\.agentxchain\/state\.json/);
  });

  it('AT-BUG62-003 refuses history rewrites where checkpoint baseline is not an ancestor of HEAD', () => {
    const { dir } = setupGovernedGitProject();

    git(dir, ['checkout', '--orphan', 'rewritten']);
    writeFileSync(join(dir, 'rewritten.txt'), 'replacement history\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'operator: rewritten history']);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 1, `reconcile unexpectedly succeeded: ${reconcile.stdout}`);
    assert.match(reconcile.stdout, /history_rewrite/);
    assert.match(reconcile.stdout, /baseline .* is not an ancestor of current HEAD/);
  });
});
