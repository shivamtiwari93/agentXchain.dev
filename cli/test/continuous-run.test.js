import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  resolveContinuousOptions,
  readContinuousSession,
  writeContinuousSession,
  advanceContinuousRunOnce,
  seedFromVision,
  findNextQueuedIntent,
  executeContinuousRun,
  maybeAutoReconcileOperatorCommits,
} from '../src/lib/continuous-run.js';
import { validateRunLoopConfig } from '../src/lib/normalized-config.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

function createTmpProject() {
  const dir = join(tmpdir(), `axc-continuous-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'continuous-test', id: 'ct-001', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: null,
    project_id: 'ct-001',
    status: 'idle',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return dir;
}

function writeVision(dir, content) {
  const planDir = join(dir, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'VISION.md'), content, 'utf8');
}

function writeIntent(dir, { intentId, status, charter }) {
  const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  const intent = {
    schema_version: '1.0',
    intent_id: intentId,
    event_id: `evt_${Date.now()}_0001`,
    status,
    priority: 'p2',
    template: 'generic',
    charter,
    acceptance_contract: [charter],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  };
  writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify(intent, null, 2));
}

function writeGhostBlockedState(dir, overrides = {}) {
  const turnId = overrides.turnId || 'turn_ghost_001';
  const state = {
    schema_version: '1.0',
    run_id: overrides.runId || 'run_ghost_001',
    project_id: 'ct-001',
    status: 'blocked',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: 'dev',
        status: 'failed_start',
        attempt: 1,
        assigned_at: '2026-04-22T00:00:00.000Z',
        assigned_sequence: 1,
        runtime_id: 'manual-dev',
        baseline: { kind: 'no_git', head_ref: null, clean: true, captured_at: '2026-04-22T00:00:00.000Z' },
        failed_start_reason: overrides.failureType || 'stdout_attach_failed',
        failed_start_threshold_ms: 400,
        failed_start_running_ms: 450,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: 'ghost_turn',
    blocked_reason: {
      category: 'ghost_turn',
      blocked_at: '2026-04-22T00:00:01.000Z',
      turn_id: turnId,
      recovery: {
        typed_reason: 'ghost_turn',
        owner: 'human',
        recovery_action: `agentxchain reissue-turn --turn ${turnId} --reason ghost`,
        turn_retained: true,
        detail: `Run \`agentxchain reissue-turn --turn ${turnId} --reason ghost\` to recover.`,
      },
    },
    escalation: null,
    phase_gate_status: {},
  };
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  return { state, turnId };
}

function readEvents(dir) {
  const path = join(dir, '.agentxchain', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readTestConfig(dir) {
  return {
    ...JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    files: { state: '.agentxchain/state.json' },
  };
}

describe('Continuous Run', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveContinuousOptions', () => {
    it('uses defaults when no CLI flags or config', () => {
      const opts = resolveContinuousOptions({}, {});
      assert.equal(opts.enabled, false);
      assert.equal(opts.visionPath, '.planning/VISION.md');
      assert.equal(opts.maxRuns, 100);
      assert.equal(opts.pollSeconds, 30);
      assert.equal(opts.maxIdleCycles, 3);
      assert.equal(opts.triageApproval, 'auto');
    });

    it('CLI flags override config', () => {
      const opts = resolveContinuousOptions(
        { continuous: true, vision: '/tmp/v.md', maxRuns: 5, triageApproval: 'auto' },
        { run_loop: { continuous: { vision_path: 'other.md', max_runs: 50, triage_approval: 'human' } } },
      );
      assert.equal(opts.enabled, true);
      assert.equal(opts.visionPath, '/tmp/v.md');
      assert.equal(opts.maxRuns, 5);
      assert.equal(opts.triageApproval, 'auto');
    });

    it('reads config values when no CLI flags', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: { continuous: { enabled: true, triage_approval: 'human', max_idle_cycles: 5 } },
      });
      assert.equal(opts.enabled, true);
      assert.equal(opts.triageApproval, 'human');
      assert.equal(opts.maxIdleCycles, 5);
    });

    it('BUG-61: defaults ghost auto-retry off for non-full-auto continuous sessions', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {
        approval_policy: {
          phase_transitions: { default: 'require_human' },
          run_completion: { action: 'auto_approve' },
        },
      });
      assert.deepEqual(opts.autoRetryOnGhost, {
        enabled: false,
        maxRetriesPerRun: 3,
        cooldownSeconds: 5,
      });
    });

    it('BUG-61: promotes ghost auto-retry on for full-auto approval-policy posture', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {
        approval_policy: {
          phase_transitions: { default: 'auto_approve' },
          run_completion: { action: 'auto_approve' },
        },
      });
      assert.equal(opts.autoRetryOnGhost.enabled, true);
      assert.equal(opts.autoRetryOnGhost.maxRetriesPerRun, 3);
      assert.equal(opts.autoRetryOnGhost.cooldownSeconds, 5);
    });

    it('BUG-61: explicit config opt-out wins over full-auto promotion', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {
        run_loop: {
          continuous: {
            auto_retry_on_ghost: { enabled: false, max_retries_per_run: 7, cooldown_seconds: 9 },
          },
        },
        approval_policy: {
          phase_transitions: { default: 'auto_approve' },
          run_completion: { action: 'auto_approve' },
        },
      });
      assert.deepEqual(opts.autoRetryOnGhost, {
        enabled: false,
        maxRetriesPerRun: 7,
        cooldownSeconds: 9,
      });
    });

    it('BUG-61: CLI ghost retry flags override config and full-auto posture', () => {
      const fullAutoConfig = {
        run_loop: { continuous: { auto_retry_on_ghost: { enabled: false } } },
        approval_policy: {
          phase_transitions: { default: 'auto_approve' },
          run_completion: { action: 'auto_approve' },
        },
      };
      assert.equal(
        resolveContinuousOptions({ continuous: true, autoRetryOnGhost: true }, fullAutoConfig).autoRetryOnGhost.enabled,
        true,
      );
      assert.equal(
        resolveContinuousOptions({ continuous: true, autoRetryOnGhost: false }, fullAutoConfig).autoRetryOnGhost.enabled,
        false,
      );
    });

    it('BUG-61: validates auto_retry_on_ghost config shape', () => {
      assert.deepEqual(
        validateRunLoopConfig({
          continuous: {
            auto_retry_on_ghost: {
              enabled: 'yes',
              max_retries_per_run: 0,
              cooldown_seconds: '5',
            },
          },
        }),
        [
          'run_loop.continuous.auto_retry_on_ghost.enabled must be a boolean',
          'run_loop.continuous.auto_retry_on_ghost.max_retries_per_run must be a positive integer (retry count)',
          'run_loop.continuous.auto_retry_on_ghost.cooldown_seconds must be a positive integer (seconds)',
        ],
      );
    });

    it('BUG-62: defaults reconcile_operator_commits to manual without full-auto policy', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {});
      assert.equal(opts.reconcileOperatorCommits, 'manual');
    });

    it('BUG-62: promotes reconcile_operator_commits to auto_safe_only under full-auto approval policy', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {
        approval_policy: {
          phase_transitions: { default: 'auto_approve' },
          run_completion: { action: 'auto_approve' },
        },
      });
      assert.equal(opts.reconcileOperatorCommits, 'auto_safe_only');
    });

    it('BUG-62: explicit config value wins over full-auto promotion', () => {
      const opts = resolveContinuousOptions({ continuous: true }, {
        run_loop: { continuous: { reconcile_operator_commits: 'disabled' } },
        approval_policy: {
          phase_transitions: { default: 'auto_approve' },
          run_completion: { action: 'auto_approve' },
        },
      });
      assert.equal(opts.reconcileOperatorCommits, 'disabled');
    });

    it('BUG-62: CLI --reconcile-operator-commits overrides config and policy', () => {
      const opts = resolveContinuousOptions(
        { continuous: true, reconcileOperatorCommits: 'manual' },
        {
          run_loop: { continuous: { reconcile_operator_commits: 'auto_safe_only' } },
          approval_policy: {
            phase_transitions: { default: 'auto_approve' },
            run_completion: { action: 'auto_approve' },
          },
        },
      );
      assert.equal(opts.reconcileOperatorCommits, 'manual');
    });

    it('BUG-62: ignores invalid CLI value and falls back to config', () => {
      const opts = resolveContinuousOptions(
        { continuous: true, reconcileOperatorCommits: 'banana' },
        { run_loop: { continuous: { reconcile_operator_commits: 'auto_safe_only' } } },
      );
      assert.equal(opts.reconcileOperatorCommits, 'auto_safe_only');
    });

    it('BUG-62: validates reconcile_operator_commits config shape', () => {
      assert.deepEqual(
        validateRunLoopConfig({
          continuous: { reconcile_operator_commits: 'sometimes' },
        }),
        [
          'run_loop.continuous.reconcile_operator_commits must be one of: manual, auto_safe_only, disabled',
        ],
      );
    });
  });

  describe('session state', () => {
    it('reads and writes session state', () => {
      assert.equal(readContinuousSession(tmpDir), null);
      const session = { session_id: 'cont-test', status: 'running', runs_completed: 2 };
      writeContinuousSession(tmpDir, session);
      const read = readContinuousSession(tmpDir);
      assert.equal(read.session_id, 'cont-test');
      assert.equal(read.runs_completed, 2);
    });
  });

  describe('BUG-61 ghost auto-retry integration', () => {
    it('auto-reissues a paused ghost-blocked run and clears only the ghost blocker', async () => {
      const { turnId } = writeGhostBlockedState(tmpDir);
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const session = {
        session_id: 'cont-ghost',
        status: 'paused',
        current_run_id: 'run_ghost_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        autoRetryOnGhost: { enabled: true, maxRetriesPerRun: 3, cooldownSeconds: 0 },
      };

      const step = await advanceContinuousRunOnce(
        context,
        session,
        contOpts,
        async () => assert.fail('blocked paused auto-retry should not execute a governed run in the same step'),
        () => {},
      );

      assert.equal(step.status, 'running');
      assert.equal(step.action, 'auto_retried_ghost');
      assert.equal(step.old_turn_id, turnId);
      assert.equal(step.attempt, 1);

      const savedSession = readContinuousSession(tmpDir);
      assert.equal(savedSession.status, 'running');
      assert.equal(savedSession.ghost_retry.attempts, 1);
      assert.equal(savedSession.ghost_retry.last_old_turn_id, turnId);
      assert.equal(savedSession.ghost_retry.last_new_turn_id, step.new_turn_id);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'active');
      assert.equal(state.blocked_reason, null);
      assert.equal(state.blocked_on, null);
      assert.equal(state.active_turns[turnId], undefined);
      assert.equal(state.active_turns[step.new_turn_id].status, 'assigned');
      assert.equal(state.active_turns[step.new_turn_id].reissued_from, turnId);

      const events = readEvents(tmpDir);
      const autoEvents = events.filter((entry) => entry.event_type === 'auto_retried_ghost');
      assert.equal(autoEvents.length, 1);
      assert.equal(autoEvents[0].payload.old_turn_id, turnId);
      assert.equal(autoEvents[0].payload.new_turn_id, step.new_turn_id);
      assert.equal(autoEvents[0].payload.attempt, 1);
      assert.equal(autoEvents[0].payload.failure_type, 'stdout_attach_failed');
    });

    it('pauses and mirrors exhaustion detail when the ghost retry budget is spent', async () => {
      const { turnId } = writeGhostBlockedState(tmpDir);
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const session = {
        session_id: 'cont-ghost',
        status: 'paused',
        current_run_id: 'run_ghost_001',
        runs_completed: 0,
        ghost_retry: {
          run_id: 'run_ghost_001',
          attempts: 3,
          max_retries_per_run: 3,
          last_old_turn_id: turnId,
          last_failure_type: 'stdout_attach_failed',
        },
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        autoRetryOnGhost: { enabled: true, maxRetriesPerRun: 3, cooldownSeconds: 0 },
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('exhausted ghost retry should not execute governed run');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      const savedSession = readContinuousSession(tmpDir);
      assert.equal(savedSession.status, 'paused');
      assert.equal(savedSession.ghost_retry.exhausted, true);
      assert.equal(savedSession.ghost_retry.attempts, 3);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'blocked');
      assert.match(state.blocked_reason.recovery.detail, /Auto-retry exhausted after 3\/3 attempts/);
      assert.match(state.blocked_reason.recovery.detail, /reissue-turn --turn turn_ghost_001 --reason ghost/);

      const events = readEvents(tmpDir);
      const exhaustedEvents = events.filter((entry) => entry.event_type === 'ghost_retry_exhausted');
      assert.equal(exhaustedEvents.length, 1);
      assert.equal(exhaustedEvents[0].payload.turn_id, turnId);
      assert.equal(exhaustedEvents[0].payload.attempts, 3);
    });

    it('preserves manual recovery unchanged when ghost auto-retry is disabled', async () => {
      const { turnId } = writeGhostBlockedState(tmpDir);
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const session = {
        session_id: 'cont-ghost',
        status: 'paused',
        current_run_id: 'run_ghost_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        autoRetryOnGhost: { enabled: false, maxRetriesPerRun: 3, cooldownSeconds: 0 },
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('disabled ghost retry should not execute governed run while blocked');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      assert.match(step.recovery_action, /reissue-turn --turn turn_ghost_001 --reason ghost/);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'blocked');
      assert.equal(state.active_turns[turnId].status, 'failed_start');
      assert.match(state.blocked_reason.recovery.recovery_action, /reissue-turn --turn turn_ghost_001 --reason ghost/);
      assert.equal(readEvents(tmpDir).some((entry) => entry.event_type === 'auto_retried_ghost'), false);
    });
  });

  describe('BUG-62 auto-reconcile operator commits', () => {
    function initGovernedGitProject(dir) {
      const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      git(['init', '-q']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test User']);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'checkpoint baseline']);
      const baseline = git(['rev-parse', 'HEAD']);
      writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
        schema_version: '1.0',
        run_id: 'run_bug62',
        project_id: 'ct-001',
        status: 'active',
        phase: 'implementation',
        accepted_integration_ref: `git:${baseline}`,
        active_turns: {},
        turn_sequence: 0,
        last_completed_turn_id: null,
        last_completed_turn: {
          turn_id: 'turn_checkpointed',
          role: 'dev',
          phase: 'implementation',
          checkpoint_sha: baseline,
          checkpointed_at: '2026-04-22T00:00:00Z',
          intent_id: 'intent_bug62',
        },
        blocked_on: null,
        blocked_reason: null,
        escalation: null,
        phase_gate_status: {},
      }, null, 2));
      writeFileSync(join(dir, '.agentxchain', 'session.json'), JSON.stringify({
        session_id: 'session_bug62',
        run_id: 'run_bug62',
        started_at: '2026-04-22T00:00:00Z',
        last_checkpoint_at: '2026-04-22T00:00:00Z',
        checkpoint_reason: 'turn_checkpointed',
        run_status: 'active',
        phase: 'implementation',
        baseline_ref: {
          git_head: baseline,
          git_branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
          workspace_dirty: false,
        },
      }, null, 2));
      return { baseline, git };
    }

    it('auto_safe_only accepts safe operator commits and rolls the baseline forward', () => {
      const { baseline, git } = initGovernedGitProject(tmpDir);
      writeFileSync(join(tmpDir, 'product.txt'), 'operator safe edit\n');
      git(['add', 'product.txt']);
      git(['commit', '-q', '-m', 'operator: product change']);
      const operatorHead = git(['rev-parse', 'HEAD']);
      assert.notEqual(operatorHead, baseline);

      const session = { session_id: 'cont-bug62', status: 'running', current_run_id: 'run_bug62', runs_completed: 0 };
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true }, context.config), reconcileOperatorCommits: 'auto_safe_only' };

      const result = maybeAutoReconcileOperatorCommits(context, session, contOpts, () => {});
      assert.equal(result, null, 'safe reconcile should continue the loop (helper returns null)');

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.accepted_integration_ref, `git:${operatorHead}`);
      assert.equal(state.operator_commit_reconciliation.accepted_head, operatorHead);
      assert.equal(state.operator_commit_reconciliation.safety_mode, 'auto_safe_only');
      const events = readEvents(tmpDir);
      const reconciled = events.find((e) => e.event_type === 'state_reconciled_operator_commits');
      assert.ok(reconciled, 'expected state_reconciled_operator_commits event');
      assert.equal(reconciled.payload.accepted_head, operatorHead);
      assert.deepEqual(reconciled.payload.paths_touched, ['product.txt']);
    });

    it('auto_safe_only pauses the session when operator commits modify governed state', () => {
      const { git } = initGovernedGitProject(tmpDir);
      const statePath = join(tmpDir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, JSON.stringify({ ...state, unsafe_edit: true }, null, 2));
      git(['add', '-f', '.agentxchain/state.json']);
      git(['commit', '-q', '-m', 'operator: edit governed state']);

      const session = { session_id: 'cont-bug62-unsafe', status: 'running', current_run_id: 'run_bug62', runs_completed: 0 };
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true }, context.config), reconcileOperatorCommits: 'auto_safe_only' };

      const result = maybeAutoReconcileOperatorCommits(context, session, contOpts, () => {});
      assert.ok(result, 'unsafe reconcile must return a blocked step');
      assert.equal(result.status, 'blocked');
      assert.equal(result.action, 'operator_commit_reconcile_refused');
      assert.equal(result.error_class, 'governance_state_modified');
      assert.equal(result.recovery_action, 'agentxchain reconcile-state --accept-operator-head');

      const savedSession = readContinuousSession(tmpDir);
      assert.equal(savedSession.status, 'paused');

      const nextState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(nextState.status, 'blocked');
      assert.equal(nextState.blocked_on, 'operator_commit_reconcile_refused');
      assert.equal(nextState.blocked_reason.error_class, 'governance_state_modified');
      assert.match(nextState.blocked_reason.recovery.detail, /auto-reconcile refused/);
      assert.match(nextState.blocked_reason.recovery.detail, /governance_state_modified/);

      const events = readEvents(tmpDir);
      const refusal = events.find((e) => e.event_type === 'operator_commit_reconcile_refused');
      assert.ok(refusal, 'expected operator_commit_reconcile_refused event');
      assert.equal(refusal.payload.error_class, 'governance_state_modified');
      assert.equal(refusal.payload.safety_mode, 'auto_safe_only');
    });

    it('manual mode preserves existing drift behavior (no auto reconcile)', () => {
      const { baseline, git } = initGovernedGitProject(tmpDir);
      writeFileSync(join(tmpDir, 'product.txt'), 'operator safe edit\n');
      git(['add', 'product.txt']);
      git(['commit', '-q', '-m', 'operator: product change']);
      const operatorHead = git(['rev-parse', 'HEAD']);
      assert.notEqual(operatorHead, baseline);

      const session = { session_id: 'cont-bug62-manual', status: 'running', current_run_id: 'run_bug62', runs_completed: 0 };
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true }, context.config), reconcileOperatorCommits: 'manual' };

      const result = maybeAutoReconcileOperatorCommits(context, session, contOpts, () => {});
      assert.equal(result, null);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.accepted_integration_ref, `git:${baseline}`, 'manual mode must not silently advance baseline');
      const events = readEvents(tmpDir);
      assert.equal(
        events.some((e) => e.event_type === 'state_reconciled_operator_commits'),
        false,
        'manual mode must not emit reconcile events',
      );
    });

    it('disabled mode skips reconcile entirely regardless of drift', () => {
      const { baseline, git } = initGovernedGitProject(tmpDir);
      writeFileSync(join(tmpDir, 'product.txt'), 'operator safe edit\n');
      git(['add', 'product.txt']);
      git(['commit', '-q', '-m', 'operator: product change']);

      const session = { session_id: 'cont-bug62-disabled', status: 'running', current_run_id: 'run_bug62', runs_completed: 0 };
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true }, context.config), reconcileOperatorCommits: 'disabled' };

      const result = maybeAutoReconcileOperatorCommits(context, session, contOpts, () => {});
      assert.equal(result, null);
      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.accepted_integration_ref, `git:${baseline}`);
    });
  });

  describe('findNextQueuedIntent', () => {
    it('returns false when no intents exist', () => {
      assert.equal(findNextQueuedIntent(tmpDir).ok, false);
    });

    it('finds planned intent', () => {
      writeIntent(tmpDir, { intentId: 'intent_001', status: 'planned', charter: 'Build X' });
      const result = findNextQueuedIntent(tmpDir);
      assert.ok(result.ok);
      assert.equal(result.intentId, 'intent_001');
      assert.equal(result.status, 'planned');
    });

    it('prefers approved over planned when any approved intent is queued', () => {
      writeIntent(tmpDir, { intentId: 'intent_a', status: 'approved', charter: 'A' });
      writeIntent(tmpDir, { intentId: 'intent_p', status: 'planned', charter: 'P' });
      const result = findNextQueuedIntent(tmpDir);
      assert.ok(result.ok);
      assert.equal(result.status, 'approved');
      assert.equal(result.intentId, 'intent_a');
    });
  });

  describe('seedFromVision', () => {
    it('AT-VCONT-005: seeds an intent with vision provenance metadata', () => {
      writeVision(tmpDir, `## Protocol

- governed run state machine
- explicit role mandates
`);
      const visionPath = join(tmpDir, '.planning', 'VISION.md');
      const result = seedFromVision(tmpDir, visionPath);
      assert.ok(result.ok);
      assert.ok(!result.idle);
      assert.equal(result.section, 'Protocol');
      assert.ok(result.intentId);

      // Verify the intent was written
      const intentPath = join(tmpDir, '.agentxchain', 'intake', 'intents', `${result.intentId}.json`);
      assert.ok(existsSync(intentPath));
      const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
      assert.ok(intent.charter.includes('[vision]'));
      assert.ok(intent.charter.includes('Protocol'));
      // Should be approved (auto triage approval)
      assert.equal(intent.status, 'approved');
    });

    it('AT-VCONT-009: leaves intent in triaged when triage_approval is human', () => {
      writeVision(tmpDir, `## Goals

- build a testing framework
`);
      const visionPath = join(tmpDir, '.planning', 'VISION.md');
      const result = seedFromVision(tmpDir, visionPath, { triageApproval: 'human' });
      assert.ok(result.ok);
      assert.ok(!result.idle);

      const intentPath = join(tmpDir, '.agentxchain', 'intake', 'intents', `${result.intentId}.json`);
      const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
      assert.equal(intent.status, 'triaged');
    });

    it('returns idle when all goals are addressed', () => {
      writeVision(tmpDir, `## Protocol

- governed run state machine
`);
      // Write a completed intent that matches
      writeIntent(tmpDir, { intentId: 'intent_done', status: 'completed', charter: 'governed run state machine implementation' });
      const visionPath = join(tmpDir, '.planning', 'VISION.md');
      const result = seedFromVision(tmpDir, visionPath);
      assert.ok(result.ok);
      assert.ok(result.idle);
    });
  });

  describe('executeContinuousRun', () => {
    it('AT-VCONT-001: executes back-to-back runs from vision goals and resolves intents', async () => {
      writeVision(tmpDir, `## Core

- explicit role definitions
- explicit turn contracts
`);

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { ...resolveContinuousOptions(
        { continuous: true, maxRuns: 2, maxIdleCycles: 1 },
        context.config,
      ), cooldownSeconds: 0 };

      let runCount = 0;
      const mockExecutor = async () => {
        runCount += 1;
        const statePath = join(tmpDir, '.agentxchain', 'state.json');
        const current = JSON.parse(readFileSync(statePath, 'utf8'));
        assert.equal(current.provenance.trigger, 'vision_scan');
        assert.equal(current.provenance.created_by, 'continuous_loop');
        assert.ok(current.provenance.intake_intent_id);
        current.status = 'completed';
        current.completed_at = new Date().toISOString();
        current.last_completed_turn_id = Object.keys(current.active_turns || {})[0] || null;
        current.active_turns = {};
        writeFileSync(statePath, JSON.stringify(current, null, 2));
        return {
          exitCode: 0,
          result: {
            stop_reason: 'completed',
            state: { run_id: current.run_id, status: 'completed' },
          },
        };
      };

      const logs = [];
      const { exitCode, session } = await executeContinuousRun(
        context, contOpts, mockExecutor, (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0);
      assert.equal(session.runs_completed, 2);
      assert.equal(session.status, 'completed');
      assert.equal(runCount, 2);

      const intentsDir = join(tmpDir, '.agentxchain', 'intake', 'intents');

      // Session file should exist
      const savedSession = readContinuousSession(tmpDir);
      assert.ok(savedSession);
      assert.equal(savedSession.runs_completed, 2);

      const intents = existsSync(intentsDir)
        ? readdirSync(intentsDir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => JSON.parse(readFileSync(join(intentsDir, file), 'utf8')))
        : [];
      assert.equal(intents.length, 2);
      for (const intent of intents) {
        assert.equal(intent.status, 'completed');
        assert.ok(intent.target_run);
      }
    });

    it('AT-VCONT-002: exits on max idle cycles when all goals addressed', async () => {
      writeVision(tmpDir, `## Core

- explicit role definitions
`);
      writeIntent(tmpDir, { intentId: 'intent_x', status: 'completed', charter: 'explicit role definitions implementation' });

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true, maxRuns: 10, maxIdleCycles: 2 }, context.config),
        pollSeconds: 0, // no wait in tests
      };

      const mockExecutor = async () => {
        assert.fail('Should not execute any run when all goals are addressed');
      };

      const logs = [];
      const { exitCode, session } = await executeContinuousRun(
        context, contOpts, mockExecutor, (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0);
      assert.equal(session.runs_completed, 0);
      assert.equal(session.idle_cycles, 2);
      assert.ok(logs.some(l => l.includes('All vision goals appear addressed')));
    });

    it('AT-VCONT-006: respects --max-runs limit', async () => {
      writeVision(tmpDir, `## Large

- goal one
- goal two
- goal three
- goal four
- goal five
`);

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true, maxRuns: 2, maxIdleCycles: 10 }, context.config), cooldownSeconds: 0 };

      let runCount = 0;
      const mockExecutor = async () => {
        runCount += 1;
        const statePath = join(tmpDir, '.agentxchain', 'state.json');
        const current = JSON.parse(readFileSync(statePath, 'utf8'));
        current.status = 'completed';
        current.completed_at = new Date().toISOString();
        current.last_completed_turn_id = Object.keys(current.active_turns || {})[0] || null;
        current.active_turns = {};
        writeFileSync(statePath, JSON.stringify(current, null, 2));
        return { exitCode: 0, result: { stop_reason: 'completed', state: { run_id: current.run_id } } };
      };

      const { session } = await executeContinuousRun(
        context, contOpts, mockExecutor, () => {},
      );

      assert.equal(session.runs_completed, 2);
      assert.equal(session.status, 'completed');
    });

    it('AT-VCONT-003: fails with clear error when VISION.md missing', async () => {
      // No VISION.md written
      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = resolveContinuousOptions({ continuous: true }, context.config);

      const logs = [];
      const { exitCode } = await executeContinuousRun(
        context, contOpts, async () => assert.fail('should not run'), (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 1);
      assert.ok(logs.some(l => l.includes('VISION.md not found')));
      assert.ok(logs.some(l => l.includes('Create a .planning/VISION.md')));
    });

    it('AT-VCONT-004: session is readable via readContinuousSession during run', async () => {
      writeVision(tmpDir, `## Test

- test goal for session visibility
`);

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = resolveContinuousOptions({ continuous: true, maxRuns: 1 }, context.config);

      let sessionDuringRun = null;
      const mockExecutor = async () => {
        sessionDuringRun = readContinuousSession(tmpDir);
        return { exitCode: 0, result: { stop_reason: 'completed', state: { run_id: 'r-1' } } };
      };

      await executeContinuousRun(context, contOpts, mockExecutor, () => {});

      assert.ok(sessionDuringRun);
      assert.equal(sessionDuringRun.status, 'running');
      assert.ok(sessionDuringRun.session_id.startsWith('cont-'));
    });
  });

  describe('structural guards', () => {
    it('S01: continuous-run.js exports required functions', async () => {
      const mod = await import('../src/lib/continuous-run.js');
      assert.equal(typeof mod.executeContinuousRun, 'function');
      assert.equal(typeof mod.resolveContinuousOptions, 'function');
      assert.equal(typeof mod.readContinuousSession, 'function');
      assert.equal(typeof mod.writeContinuousSession, 'function');
      assert.equal(typeof mod.seedFromVision, 'function');
      assert.equal(typeof mod.findNextQueuedIntent, 'function');
    });

    it('S02: vision-reader.js exports required functions', async () => {
      const mod = await import('../src/lib/vision-reader.js');
      assert.equal(typeof mod.parseVisionDocument, 'function');
      assert.equal(typeof mod.deriveVisionCandidates, 'function');
      assert.equal(typeof mod.resolveVisionPath, 'function');
      assert.equal(typeof mod.isGoalAddressed, 'function');
      assert.equal(typeof mod.loadCompletedIntentSignals, 'function');
    });

    it('S03: run command registers --continuous and --vision flags', () => {
      const content = readFileSync(binPath, 'utf8');
      assert.ok(content.includes("'--continuous'"));
      assert.ok(content.includes("'--vision <path>'"));
      assert.ok(content.includes("'--max-runs <n>'"));
      assert.ok(content.includes("'--max-idle-cycles <n>'"));
      assert.ok(content.includes("'--auto-retry-on-ghost'"));
      assert.ok(content.includes("'--no-auto-retry-on-ghost'"));
      assert.ok(content.includes("'--auto-retry-on-ghost-max-retries <n>'"));
      assert.ok(content.includes("'--auto-retry-on-ghost-cooldown-seconds <n>'"));
    });

    it('S04: intake accepts vision_scan as a valid source', async () => {
      const { validateEventPayload } = await import('../src/lib/intake.js');
      const result = validateEventPayload({
        source: 'vision_scan',
        signal: { description: 'test' },
        evidence: [{ type: 'text', value: 'test evidence' }],
      });
      assert.ok(result.valid, `validation errors: ${result.errors.join(', ')}`);
    });

    it('S05: status command imports readContinuousSession', () => {
      const content = readFileSync(join(cliRoot, 'src', 'commands', 'status.js'), 'utf8');
      assert.ok(content.includes('readContinuousSession'));
      assert.ok(content.includes('continuous_session'));
    });
  });
});
