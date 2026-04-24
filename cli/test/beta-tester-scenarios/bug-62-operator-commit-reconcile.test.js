import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../../src/commands/init.js';
import { loadProjectContext } from '../../src/lib/config.js';
import { maybeAutoReconcileOperatorCommits } from '../../src/lib/continuous-run.js';

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

  it('surfaces auto-reconcile refusal class and recovery action through status', () => {
    const { dir } = setupGovernedGitProject();

    const statePath = join(dir, '.agentxchain', 'state.json');
    writeJson(statePath, {
      ...readJson(statePath),
      unsafe_operator_edit: true,
    });
    git(dir, ['add', '-f', '.agentxchain/state.json']);
    git(dir, ['commit', '-m', 'operator: edit governed state for auto refusal']);

    const context = loadProjectContext(dir);
    assert.ok(context, 'expected governed project context');
    const session = {
      session_id: 'cont-bug62-status',
      status: 'running',
      current_run_id: 'run_bug62',
      runs_completed: 0,
    };
    const result = maybeAutoReconcileOperatorCommits(
      context,
      session,
      { reconcileOperatorCommits: 'auto_safe_only' },
      () => {}
    );

    assert.equal(result.status, 'blocked');
    assert.equal(result.action, 'operator_commit_reconcile_refused');
    assert.equal(result.error_class, 'governance_state_modified');
    assert.equal(result.recovery_action, 'agentxchain reconcile-state --accept-operator-head');

    const humanStatus = runCli(dir, ['status']);
    assert.equal(humanStatus.status, 0, `status failed: ${humanStatus.stdout}\n${humanStatus.stderr}`);
    assert.match(humanStatus.stdout, /BLOCKED/);
    assert.match(humanStatus.stdout, /Operator-commit auto-reconcile refused \(governance_state_modified\)/);
    assert.match(humanStatus.stdout, /agentxchain reconcile-state --accept-operator-head/);

    const jsonStatus = runCli(dir, ['status', '--json']);
    assert.equal(jsonStatus.status, 0, `status --json failed: ${jsonStatus.stdout}\n${jsonStatus.stderr}`);
    const payload = JSON.parse(jsonStatus.stdout);
    assert.equal(payload.state.status, 'blocked');
    assert.equal(payload.state.blocked_on, 'operator_commit_reconcile_refused');
    assert.equal(payload.state.blocked_reason.error_class, 'governance_state_modified');
    assert.equal(
      payload.state.blocked_reason.recovery.recovery_action,
      'agentxchain reconcile-state --accept-operator-head'
    );
    assert.match(payload.state.blocked_reason.recovery.detail, /governance_state_modified/);
  });

  it('surfaces auto-reconcile refusal for critical_artifact_deleted through status', () => {
    const { dir } = setupGovernedGitProject();

    rmSync(join(dir, '.planning', 'acceptance-matrix.md'), { force: true });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'operator: delete critical acceptance matrix']);

    const context = loadProjectContext(dir);
    assert.ok(context, 'expected governed project context');
    const session = {
      session_id: 'cont-bug62-critical',
      status: 'running',
      current_run_id: 'run_bug62',
      runs_completed: 0,
    };
    const result = maybeAutoReconcileOperatorCommits(
      context,
      session,
      { reconcileOperatorCommits: 'auto_safe_only' },
      () => {}
    );

    assert.equal(result.status, 'blocked');
    assert.equal(result.action, 'operator_commit_reconcile_refused');
    assert.equal(result.error_class, 'critical_artifact_deleted');
    assert.equal(result.recovery_action, 'agentxchain reconcile-state --accept-operator-head');

    const humanStatus = runCli(dir, ['status']);
    assert.equal(humanStatus.status, 0, `status failed: ${humanStatus.stdout}\n${humanStatus.stderr}`);
    assert.match(humanStatus.stdout, /BLOCKED/);
    assert.match(humanStatus.stdout, /Operator-commit auto-reconcile refused \(critical_artifact_deleted\)/);
    assert.match(humanStatus.stdout, /agentxchain reconcile-state --accept-operator-head/);

    const jsonStatus = runCli(dir, ['status', '--json']);
    assert.equal(jsonStatus.status, 0, `status --json failed: ${jsonStatus.stdout}\n${jsonStatus.stderr}`);
    const payload = JSON.parse(jsonStatus.stdout);
    assert.equal(payload.state.status, 'blocked');
    assert.equal(payload.state.blocked_on, 'operator_commit_reconcile_refused');
    assert.equal(payload.state.blocked_reason.error_class, 'critical_artifact_deleted');
    assert.equal(
      payload.state.blocked_reason.recovery.typed_reason,
      'operator_commit_reconcile_refused'
    );
    assert.equal(
      payload.state.blocked_reason.recovery.recovery_action,
      'agentxchain reconcile-state --accept-operator-head'
    );
    assert.match(payload.state.blocked_reason.recovery.detail, /critical_artifact_deleted/);
  });

  it('AT-BUG62-004 accepts operator commits that only modify reconcile-safe .agentxchain paths (SESSION_RECOVERY.md)', () => {
    const { dir, baseline } = setupGovernedGitProject();

    // Operator modifies SESSION_RECOVERY.md — this is a recovery documentation file, not core state
    const recoveryPath = join(dir, '.agentxchain', 'SESSION_RECOVERY.md');
    writeFileSync(recoveryPath, '# Recovery\nOperator updated recovery notes.\n');
    git(dir, ['add', '-f', '.agentxchain/SESSION_RECOVERY.md']);
    git(dir, ['commit', '-m', 'operator: update recovery documentation']);
    const operatorHead = git(dir, ['rev-parse', 'HEAD']);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 0, `reconcile should succeed for SESSION_RECOVERY.md: ${reconcile.stdout}\n${reconcile.stderr}`);
    assert.match(reconcile.stdout, /Reconciled 1 operator commit/);

    const state = readJson(join(dir, '.agentxchain', 'state.json'));
    assert.equal(state.accepted_integration_ref, `git:${operatorHead}`);

    const events = readJsonl(join(dir, '.agentxchain', 'events.jsonl'));
    const event = events.find((entry) => entry.event_type === 'state_reconciled_operator_commits');
    assert.ok(event, 'expected state_reconciled_operator_commits event');
    assert.ok(event.payload.safety_checks.reconcile_safe_paths.includes('.agentxchain/SESSION_RECOVERY.md'));
  });

  it('AT-BUG62-005 accepts operator commits that only modify reconcile-safe .agentxchain/prompts/ paths', () => {
    const { dir } = setupGovernedGitProject();

    // Operator adds/modifies a prompt override — this is operator-customizable configuration
    const promptsDir = join(dir, '.agentxchain', 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, 'pm-idle-expansion.md'), '# Custom PM idle-expansion\nOperator override.\n');
    git(dir, ['add', '-f', '.agentxchain/prompts/pm-idle-expansion.md']);
    git(dir, ['commit', '-m', 'operator: customize PM idle-expansion prompt']);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 0, `reconcile should succeed for prompts/: ${reconcile.stdout}\n${reconcile.stderr}`);
    assert.match(reconcile.stdout, /Reconciled 1 operator commit/);
  });

  it('AT-BUG62-006 still blocks when operator commit modifies both safe and unsafe .agentxchain paths', () => {
    const { dir } = setupGovernedGitProject();

    // Operator modifies SESSION_RECOVERY.md (safe) AND state.json (unsafe) in the same commit
    writeFileSync(join(dir, '.agentxchain', 'SESSION_RECOVERY.md'), '# Recovery\nModified.\n');
    const statePath = join(dir, '.agentxchain', 'state.json');
    writeJson(statePath, { ...readJson(statePath), unsafe_edit: true });
    git(dir, ['add', '-f', '.agentxchain/SESSION_RECOVERY.md', '.agentxchain/state.json']);
    git(dir, ['commit', '-m', 'operator: mixed safe and unsafe edits']);

    const reconcile = runCli(dir, ['reconcile-state', '--accept-operator-head']);
    assert.equal(reconcile.status, 1, `reconcile should refuse mixed edits: ${reconcile.stdout}`);
    assert.match(reconcile.stdout, /governance_state_modified/);
    assert.match(reconcile.stdout, /\.agentxchain\/state\.json/);
  });
});
