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
  ingestAcceptedIdleExpansion,
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

function writeProductiveTimeoutBlockedState(dir, overrides = {}) {
  const turnId = overrides.turnId || 'turn_timeout_001';
  const firstOutputAt = overrides.firstOutputAt === undefined
    ? '2026-04-28T00:00:10.000Z'
    : overrides.firstOutputAt;
  const turn = {
    turn_id: turnId,
    run_id: overrides.runId || 'run_timeout_001',
    assigned_role: 'dev',
    status: 'failed',
    attempt: 2,
    assigned_at: '2026-04-28T00:00:00.000Z',
    started_at: '2026-04-28T00:00:00.000Z',
    deadline_at: '2026-04-28T00:20:00.000Z',
    assigned_sequence: 1,
    runtime_id: 'manual-dev',
    baseline: { kind: 'no_git', head_ref: null, clean: true, captured_at: '2026-04-28T00:00:00.000Z' },
    last_rejection: {
      turn_id: turnId,
      attempt: 2,
      rejected_at: '2026-04-28T00:20:00.000Z',
      reason: overrides.reason || `Subprocess exited (code 143) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`,
      validation_errors: [
        overrides.reason || `Subprocess exited (code 143) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`,
      ],
      failed_stage: 'dispatch',
    },
  };
  if (firstOutputAt) {
    turn.first_output_at = firstOutputAt;
    turn.first_output_stream = 'stdout';
  }
  const state = {
    schema_version: '1.0',
    run_id: overrides.runId || 'run_timeout_001',
    project_id: 'ct-001',
    status: 'blocked',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: { [turnId]: turn },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: 'escalation:retries-exhausted:dev',
    blocked_reason: {
      category: 'retries_exhausted',
      blocked_at: '2026-04-28T00:20:00.000Z',
      turn_id: turnId,
      recovery: {
        typed_reason: 'retries_exhausted',
        owner: 'human',
        recovery_action: 'Resolve the escalation, then run agentxchain step --resume',
        turn_retained: true,
        detail: 'escalation:retries-exhausted:dev',
      },
    },
    escalation: {
      from_role: 'dev',
      from_turn_id: turnId,
      reason: 'Turn rejected 2 times. Retries exhausted.',
      validation_errors: turn.last_rejection.validation_errors,
      escalated_at: '2026-04-28T00:20:00.000Z',
    },
    phase_gate_status: {},
  };
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  return { state, turnId };
}

function writeClaudeAuthEscalationState(dir, overrides = {}) {
  const turnId = overrides.turnId || 'turn_claude_auth_001';
  const runtimeId = overrides.runtimeId || 'local-qa';
  const turn = {
    turn_id: turnId,
    run_id: 'run_claude_auth_001',
    assigned_role: 'qa',
    status: 'failed',
    attempt: 2,
    assigned_at: '2026-04-29T15:46:30.000Z',
    started_at: '2026-04-29T15:46:31.000Z',
    deadline_at: '2026-04-29T16:06:31.000Z',
    assigned_sequence: 5,
    runtime_id: runtimeId,
    baseline: { kind: 'no_git', head_ref: null, clean: true, captured_at: '2026-04-29T15:46:30.000Z' },
    last_rejection: {
      turn_id: turnId,
      attempt: 2,
      rejected_at: '2026-04-29T15:46:32.000Z',
      reason: `Subprocess exited (code 1) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`,
      validation_errors: [
        `Subprocess exited (code 1) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`,
      ],
      failed_stage: 'dispatch',
    },
    first_output_at: '2026-04-29T15:46:32.000Z',
    first_output_stream: 'stdout',
  };
  const state = {
    schema_version: '1.0',
    run_id: 'run_claude_auth_001',
    project_id: 'ct-001',
    status: 'blocked',
    phase: 'qa',
    accepted_integration_ref: null,
    active_turns: { [turnId]: turn },
    turn_sequence: 5,
    last_completed_turn_id: 'turn_dev_001',
    blocked_on: 'escalation:retries-exhausted:qa',
    blocked_reason: {
      category: 'retries_exhausted',
      blocked_at: '2026-04-29T15:46:32.000Z',
      turn_id: turnId,
      recovery: {
        typed_reason: 'retries_exhausted',
        owner: 'human',
        recovery_action: 'Resolve the escalation, then run agentxchain step --resume',
        turn_retained: true,
        detail: 'escalation:retries-exhausted:qa',
      },
    },
    escalation: {
      from_role: 'qa',
      from_turn_id: turnId,
      reason: 'Turn rejected 2 times. Retries exhausted.',
      validation_errors: turn.last_rejection.validation_errors,
      escalated_at: '2026-04-29T15:46:32.000Z',
    },
    phase_gate_status: {},
  };
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  const dispatchDir = join(dir, '.agentxchain', 'dispatch', 'turns', turnId);
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, 'stdout.log'), overrides.logText ?? [
    '[adapter:diag] spawn_prepare {"command":"claude"}\n',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Failed to authenticate. API Error: 401 {\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"authentication_error\\",\\"message\\":\\"Invalid authentication credentials\\"}}"}]},"error":"authentication_failed"}\n',
    '[adapter:diag] process_exit {"exit_code":1,"staged_result_ready":false}\n',
  ].join(''), 'utf8');
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

function initContinuousGitProject(dir) {
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  writeFileSync(join(dir, 'product.txt'), 'baseline\n');
  git(['add', 'agentxchain.json', '.agentxchain/state.json', '.agentxchain/history.jsonl', '.agentxchain/decision-ledger.jsonl', 'product.txt']);
  git(['commit', '-q', '-m', 'baseline']);
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

  describe('BUG-60: on_idle and idle_expansion config resolution', () => {
    it('defaults on_idle to exit with no idle_expansion block', () => {
      const opts = resolveContinuousOptions({}, {});
      assert.equal(opts.onIdle, 'exit');
      assert.equal(opts.idleExpansion, null);
    });

    it('reads on_idle from config', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: { continuous: { on_idle: 'perpetual' } },
      });
      assert.equal(opts.onIdle, 'perpetual');
      assert.notEqual(opts.idleExpansion, null);
    });

    it('CLI --on-idle overrides config', () => {
      const opts = resolveContinuousOptions(
        { onIdle: 'exit' },
        { run_loop: { continuous: { on_idle: 'perpetual' } } },
      );
      assert.equal(opts.onIdle, 'exit');
      assert.equal(opts.idleExpansion, null);
    });

    it('perpetual mode resolves default idle_expansion block', () => {
      const opts = resolveContinuousOptions(
        { onIdle: 'perpetual' },
        {},
      );
      assert.equal(opts.onIdle, 'perpetual');
      assert.deepEqual(opts.idleExpansion.sources, [
        '.planning/VISION.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md',
      ]);
      assert.equal(opts.idleExpansion.maxExpansions, 5);
      assert.equal(opts.idleExpansion.role, 'pm');
      assert.equal(opts.idleExpansion.malformedRetryLimit, 1);
    });

    it('perpetual mode reads custom idle_expansion config', () => {
      const opts = resolveContinuousOptions(
        { onIdle: 'perpetual' },
        {
          run_loop: {
            continuous: {
              idle_expansion: {
                sources: ['.planning/VISION.md'],
                max_expansions: 3,
                role: 'architect',
                malformed_retry_limit: 0,
                pm_prompt_path: '.agentxchain/prompts/custom-idle.md',
              },
            },
          },
        },
      );
      assert.deepEqual(opts.idleExpansion.sources, ['.planning/VISION.md']);
      assert.equal(opts.idleExpansion.maxExpansions, 3);
      assert.equal(opts.idleExpansion.role, 'architect');
      assert.equal(opts.idleExpansion.malformedRetryLimit, 0);
      assert.equal(opts.idleExpansion.pmPromptPath, '.agentxchain/prompts/custom-idle.md');
    });

    it('exit mode ignores idle_expansion config', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: {
          continuous: {
            on_idle: 'exit',
            idle_expansion: { max_expansions: 10 },
          },
        },
      });
      assert.equal(opts.onIdle, 'exit');
      assert.equal(opts.idleExpansion, null);
    });

    it('human_review mode pauses instead of resolving idle_expansion config', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: {
          continuous: {
            on_idle: 'human_review',
            idle_expansion: { max_expansions: 10 },
          },
        },
      });
      assert.equal(opts.onIdle, 'human_review');
      assert.equal(opts.idleExpansion, null);
    });

    it('ignores invalid on_idle values and defaults to exit', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: { continuous: { on_idle: 'banana' } },
      });
      assert.equal(opts.onIdle, 'exit');
      assert.equal(opts.idleExpansion, null);
    });

    it('validates on_idle rejects non-string values', () => {
      const errors = validateRunLoopConfig({
        continuous: { on_idle: 42 },
      });
      assert.ok(errors.some(e => e.includes('on_idle must be one of: exit, perpetual, human_review')));
    });

    it('validates on_idle rejects unknown string values', () => {
      const errors = validateRunLoopConfig({
        continuous: { on_idle: 'auto_decide' },
      });
      assert.ok(errors.some(e => e.includes('on_idle must be one of: exit, perpetual, human_review')));
    });

    it('validates on_idle accepts valid values without errors', () => {
      assert.deepEqual(
        validateRunLoopConfig({ continuous: { on_idle: 'exit' } }),
        [],
      );
      assert.deepEqual(
        validateRunLoopConfig({ continuous: { on_idle: 'perpetual' } }),
        [],
      );
      assert.deepEqual(
        validateRunLoopConfig({ continuous: { on_idle: 'human_review' } }),
        [],
      );
    });

    it('validates idle_expansion.max_expansions rejects non-positive values', () => {
      const errors = validateRunLoopConfig({
        continuous: {
          on_idle: 'perpetual',
          idle_expansion: { max_expansions: 0 },
        },
      });
      assert.ok(errors.some(e => e.includes('max_expansions must be a positive integer')));
    });

    it('validates idle_expansion.malformed_retry_limit rejects negative values', () => {
      const errors = validateRunLoopConfig({
        continuous: {
          on_idle: 'perpetual',
          idle_expansion: { malformed_retry_limit: -1 },
        },
      });
      assert.ok(errors.some(e => e.includes('malformed_retry_limit must be a non-negative integer')));
    });

    it('validates idle_expansion accepts valid config without errors', () => {
      assert.deepEqual(
        validateRunLoopConfig({
          continuous: {
            on_idle: 'perpetual',
            idle_expansion: {
              max_expansions: 3,
              malformed_retry_limit: 0,
              pm_prompt_path: '.agentxchain/prompts/pm-idle-expansion.md',
            },
          },
        }),
        [],
      );
    });

    it('validates idle_expansion.pm_prompt_path rejects non-string values', () => {
      const errors = validateRunLoopConfig({
        continuous: {
          on_idle: 'perpetual',
          idle_expansion: { pm_prompt_path: 12 },
        },
      });
      assert.ok(errors.some(e => e.includes('pm_prompt_path must be a string')));
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
    it('BUG-100 auto-reissues productive deadline-killed retries-exhausted turns in continuous mode', async () => {
      const { turnId } = writeProductiveTimeoutBlockedState(tmpDir);
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const session = {
        session_id: 'cont-timeout',
        status: 'paused',
        current_run_id: 'run_timeout_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(
        context,
        session,
        contOpts,
        async () => assert.fail('productive timeout auto-retry should not execute a governed run in the same step'),
        () => {},
      );

      assert.equal(step.status, 'running');
      assert.equal(step.action, 'auto_retried_productive_timeout');
      assert.equal(step.old_turn_id, turnId);
      assert.equal(step.attempt, 1);

      const savedSession = readContinuousSession(tmpDir);
      assert.equal(savedSession.status, 'running');
      assert.equal(savedSession.productive_timeout_retry.attempts, 1);
      assert.equal(savedSession.productive_timeout_retry.last_old_turn_id, turnId);
      assert.equal(savedSession.productive_timeout_retry.last_new_turn_id, step.new_turn_id);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'active');
      assert.equal(state.blocked_on, null);
      assert.equal(state.blocked_reason, null);
      assert.equal(state.active_turns[turnId], undefined);
      const newTurn = state.active_turns[step.new_turn_id];
      assert.equal(newTurn.status, 'assigned');
      assert.equal(newTurn.reissued_from, turnId);
      assert.equal(newTurn.timeout_recovery_context.reason, 'productive_timeout');
      assert.equal(newTurn.timeout_recovery_context.extended_deadline_minutes, 60);
      assert.ok(new Date(newTurn.deadline_at).getTime() > Date.now() + 50 * 60 * 1000);

      const events = readEvents(tmpDir);
      const retryEvents = events.filter((entry) => entry.event_type === 'auto_retried_productive_timeout');
      assert.equal(retryEvents.length, 1);
      assert.equal(retryEvents[0].payload.old_turn_id, turnId);
      assert.equal(retryEvents[0].payload.new_turn_id, step.new_turn_id);
      assert.equal(retryEvents[0].payload.extended_deadline_minutes, 60);
    });

    it('BUG-100 leaves silent retries-exhausted subprocess failures blocked', async () => {
      const { turnId } = writeProductiveTimeoutBlockedState(tmpDir, { firstOutputAt: null });
      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const session = {
        session_id: 'cont-timeout',
        status: 'paused',
        current_run_id: 'run_timeout_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('silent blocked timeout should not execute governed run');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'blocked');
      assert.ok(state.active_turns[turnId]);
      const events = readEvents(tmpDir);
      assert.equal(events.some((entry) => entry.event_type === 'auto_retried_productive_timeout'), false);
    });

    it('BUG-111 reclassifies retained Claude auth retries-exhausted escalation as typed dispatch blocker', async () => {
      const { turnId } = writeClaudeAuthEscalationState(tmpDir);
      const config = readTestConfig(tmpDir);
      config.runtimes['local-qa'] = { type: 'local_cli', command: 'claude --print' };
      const context = { root: tmpDir, config };
      const session = {
        session_id: 'cont-claude-auth',
        status: 'paused',
        current_run_id: 'run_claude_auth_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('retained auth escalation should not execute governed run');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      assert.equal(step.blocked_category, 'dispatch_error');
      assert.match(step.recovery_action, /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN/);
      assert.match(step.recovery_action, /step --resume/);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'blocked');
      assert.equal(state.blocked_on, 'dispatch:claude_auth_failed');
      assert.equal(state.blocked_reason.category, 'dispatch_error');
      assert.equal(state.blocked_reason.turn_id, turnId);
      assert.equal(state.blocked_reason.reclassified_from.blocked_on, 'escalation:retries-exhausted:qa');
      assert.equal(state.blocked_reason.recovery.turn_retained, true);
      assert.match(state.blocked_reason.recovery.detail, /claude_auth_failed/);
      assert.equal(state.escalation, null);

      const events = readEvents(tmpDir);
      const reclassified = events.filter((entry) => entry.event_type === 'retained_claude_auth_escalation_reclassified');
      assert.equal(reclassified.length, 1);
      assert.equal(reclassified[0].payload.turn_id, turnId);
      assert.equal(reclassified[0].payload.previous_blocked_on, 'escalation:retries-exhausted:qa');
      assert.equal(reclassified[0].payload.blocked_on, 'dispatch:claude_auth_failed');
    });

    it('BUG-111 preserves retained retries-exhausted escalation when Claude auth markers are absent', async () => {
      writeClaudeAuthEscalationState(tmpDir, {
        logText: '[adapter:diag] process_exit {"exit_code":1,"staged_result_ready":false}\nregular subprocess failure\n',
      });
      const config = readTestConfig(tmpDir);
      config.roles.qa = { title: 'QA', mandate: 'Verify.', write_authority: 'authoritative', runtime: 'local-qa' };
      config.runtimes['local-qa'] = { type: 'local_cli', command: 'claude --print' };
      const context = { root: tmpDir, config };
      const session = {
        session_id: 'cont-claude-auth',
        status: 'paused',
        current_run_id: 'run_claude_auth_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('retained generic escalation should not execute governed run');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      assert.equal(step.blocked_category, 'retries_exhausted');
      assert.equal(step.recovery_action, 'Resolve the escalation, then run agentxchain step --resume');

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.blocked_on, 'escalation:retries-exhausted:qa');
      assert.equal(state.blocked_reason.category, 'retries_exhausted');
      assert.equal(readEvents(tmpDir).some((entry) => entry.event_type === 'retained_claude_auth_escalation_reclassified'), false);
    });

    it('BUG-112 auto-reissues retained Claude provider request timeouts instead of human escalation', async () => {
      const { turnId } = writeClaudeAuthEscalationState(tmpDir, {
        turnId: 'turn_claude_timeout_001',
        logText: [
          '[adapter:diag] spawn_prepare {"command":"claude"}\n',
          '{"type":"system","subtype":"api_retry","attempt":10,"max_retries":10,"error":"unknown"}\n',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Request timed out"}]},"error":"unknown"}\n',
          '{"type":"result","is_error":true,"result":"Request timed out"}\n',
          '[adapter:diag] process_exit {"exit_code":1,"staged_result_ready":false}\n',
        ].join(''),
      });
      const config = readTestConfig(tmpDir);
      config.roles.qa = { title: 'QA', mandate: 'Verify.', write_authority: 'authoritative', runtime: 'local-qa' };
      config.runtimes['local-qa'] = { type: 'local_cli', command: 'claude --print' };
      const context = { root: tmpDir, config };
      const session = {
        session_id: 'cont-claude-timeout',
        status: 'paused',
        current_run_id: 'run_claude_auth_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('retained provider timeout should be auto-reissued before executing a governed run');
      }, () => {});

      assert.equal(step.status, 'running');
      assert.equal(step.action, 'auto_retried_productive_timeout');
      assert.equal(step.old_turn_id, turnId);
      assert.notEqual(step.new_turn_id, turnId);

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'active');
      assert.equal(state.blocked_on, null);
      assert.equal(state.blocked_reason, null);
      assert.equal(state.escalation, null);
      assert.equal(state.active_turns[turnId], undefined);
      const newTurn = state.active_turns[step.new_turn_id];
      assert.equal(newTurn.status, 'assigned');
      assert.equal(newTurn.reissued_from, turnId);
      assert.equal(newTurn.timeout_recovery_context.reason, 'productive_timeout');

      const events = readEvents(tmpDir);
      assert.equal(events.some((entry) => entry.event_type === 'retained_claude_auth_escalation_reclassified'), false);
      const retryEvents = events.filter((entry) => entry.event_type === 'auto_retried_productive_timeout');
      assert.equal(retryEvents.length, 1);
      assert.equal(retryEvents[0].payload.old_turn_id, turnId);
      assert.equal(retryEvents[0].payload.new_turn_id, step.new_turn_id);
    });

    it('BUG-112 does not treat Claude api_retry events alone as a provider timeout', async () => {
      const { turnId } = writeClaudeAuthEscalationState(tmpDir, {
        turnId: 'turn_claude_retry_unknown_001',
        logText: [
          '[adapter:diag] spawn_prepare {"command":"claude"}\n',
          '{"type":"system","subtype":"api_retry","attempt":10,"max_retries":10,"error":"unknown"}\n',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Unexpected provider failure"}]},"error":"unknown"}\n',
          '[adapter:diag] process_exit {"exit_code":1,"staged_result_ready":false}\n',
        ].join(''),
      });
      const config = readTestConfig(tmpDir);
      config.runtimes['local-qa'] = { type: 'local_cli', command: 'claude --print' };
      const context = { root: tmpDir, config };
      const session = {
        session_id: 'cont-claude-retry-unknown',
        status: 'paused',
        current_run_id: 'run_claude_auth_001',
        runs_completed: 0,
      };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true }, context.config),
        cooldownSeconds: 0,
      };

      const step = await advanceContinuousRunOnce(context, session, contOpts, async () => {
        assert.fail('unknown provider retry should stay blocked');
      }, () => {});

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'still_blocked');
      assert.equal(step.blocked_category, 'retries_exhausted');

      const state = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.blocked_on, 'escalation:retries-exhausted:qa');
      assert.ok(state.active_turns[turnId]);
      const events = readEvents(tmpDir);
      assert.equal(events.some((entry) => entry.event_type === 'auto_retried_productive_timeout'), false);
    });

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
      const { git } = initContinuousGitProject(tmpDir);
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
      assert.equal(nextState.blocked_reason.category, 'operator_commit_reconcile_refused');
      assert.match(nextState.blocked_reason.blocked_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(nextState.blocked_reason.turn_id, null);
      assert.equal(nextState.blocked_reason.recovery.typed_reason, 'operator_commit_reconcile_refused');
      assert.equal(nextState.blocked_reason.recovery.owner, 'human');
      assert.equal(nextState.blocked_reason.recovery.turn_retained, false);
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
    it('BUG-76: seeds unchecked roadmap work before falling back to vision derivation', () => {
      writeVision(tmpDir, `## Vision Scope

- broad future scope
`);
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M28: Static Sensitivity Class Inference from Manifest Evidence (~0.5 day)
- [ ] Add classifySensitivity(capability) pure deterministic function
`);

      const visionPath = join(tmpDir, '.planning', 'VISION.md');
      const result = seedFromVision(tmpDir, visionPath);
      assert.ok(result.ok);
      assert.ok(!result.idle);
      assert.equal(result.source, 'roadmap_open_work');
      assert.match(result.section, /^M28:/);
      assert.equal(result.goal, 'Add classifySensitivity(capability) pure deterministic function');

      const intent = JSON.parse(readFileSync(join(tmpDir, '.agentxchain', 'intake', 'intents', `${result.intentId}.json`), 'utf8'));
      assert.match(intent.charter, /^\[roadmap\] M28:/);
      assert.equal(intent.status, 'approved');
      assert.ok(intent.acceptance_contract.some((line) => line.includes('Unchecked roadmap item completed')));
    });

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

      assert.equal(exitCode, 0, logs.join('\n'));
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

      assert.equal(exitCode, 0, logs.join('\n'));
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

    it('AT-BUG107-001: executeContinuousRun resumes an existing paused active session without replacing its session id', async () => {
      writeVision(tmpDir, `## Recovery

- continue stranded active QA phase
`);
      const statePath = join(tmpDir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.run_id = 'run_bug107_existing';
      state.status = 'active';
      state.phase = 'implementation';
      state.active_turns = {};
      state.blocked_on = null;
      state.blocked_reason = null;
      state.escalation = null;
      state.pending_phase_transition = null;
      state.pending_run_completion = null;
      state.queued_phase_transition = null;
      state.queued_run_completion = null;
      state.next_recommended_role = 'dev';
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      writeContinuousSession(tmpDir, {
        session_id: 'cont-bug107-existing',
        started_at: '2026-04-29T11:02:12.407Z',
        vision_path: '.planning/VISION.md',
        runs_completed: 0,
        max_runs: 1,
        idle_cycles: 0,
        max_idle_cycles: 3,
        current_run_id: 'run_bug107_existing',
        current_vision_objective: 'continue stranded active QA phase',
        status: 'paused',
        cumulative_spent_usd: 0,
      });

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true, maxRuns: 1, maxIdleCycles: 3 }, context.config), cooldownSeconds: 0 };
      let executeCount = 0;
      const logs = [];
      const { exitCode, session } = await executeContinuousRun(
        context,
        contOpts,
        async () => {
          executeCount += 1;
          const current = JSON.parse(readFileSync(statePath, 'utf8'));
          current.status = 'completed';
          current.completed_at = new Date().toISOString();
          current.last_completed_turn_id = null;
          current.active_turns = {};
          writeFileSync(statePath, JSON.stringify(current, null, 2));
          return {
            exitCode: 0,
            result: { stop_reason: 'completed', state: { run_id: current.run_id, status: 'completed' } },
          };
        },
        (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0);
      assert.equal(executeCount, 1);
      assert.equal(session.session_id, 'cont-bug107-existing');
      assert.equal(readContinuousSession(tmpDir).session_id, 'cont-bug107-existing');
      assert.ok(logs.some((line) => line.includes('Resuming existing continuous session cont-bug107-existing')));
    });

    it('AT-BUG108-001: executeContinuousRun does not re-recover after a terminal blocked step', async () => {
      writeVision(tmpDir, `## Recovery

- continue stranded active QA phase
`);
      const statePath = join(tmpDir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.run_id = 'run_bug108_existing';
      state.status = 'active';
      state.phase = 'qa';
      state.active_turns = {};
      state.blocked_on = null;
      state.blocked_reason = null;
      state.escalation = null;
      state.pending_phase_transition = null;
      state.pending_run_completion = null;
      state.queued_phase_transition = null;
      state.queued_run_completion = null;
      state.next_recommended_role = 'qa';
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      writeContinuousSession(tmpDir, {
        session_id: 'cont-bug108-existing',
        started_at: '2026-04-29T12:40:00.000Z',
        vision_path: '.planning/VISION.md',
        runs_completed: 0,
        max_runs: 1,
        idle_cycles: 0,
        max_idle_cycles: 3,
        current_run_id: 'run_bug108_existing',
        current_vision_objective: 'continue stranded active QA phase',
        status: 'paused',
        cumulative_spent_usd: 0,
      });

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true, maxRuns: 1, maxIdleCycles: 3 }, context.config), cooldownSeconds: 0 };
      let executeCount = 0;
      const logs = [];
      const { exitCode, session } = await executeContinuousRun(
        context,
        contOpts,
        async () => {
          executeCount += 1;
          const current = JSON.parse(readFileSync(statePath, 'utf8'));
          current.status = 'active';
          current.active_turns = {};
          writeFileSync(statePath, JSON.stringify(current, null, 2));
          return {
            exitCode: 1,
            result: {
              stop_reason: 'blocked',
              state: { run_id: current.run_id, status: 'active' },
              errors: ['assignTurn(qa): Working tree has uncommitted changes in actor-owned files'],
            },
          };
        },
        (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0);
      assert.equal(executeCount, 1);
      assert.equal(session.session_id, 'cont-bug108-existing');
      assert.equal(readContinuousSession(tmpDir).session_id, 'cont-bug108-existing');
      assert.equal(
        logs.filter((line) => line.includes('Continuous session was paused while run run_bug108_existing remained active')).length,
        0,
      );
    });

    it('BUG-109: auto-checkpoint recovers supplemental accepted-turn dirt before QA dispatch retry', async () => {
      writeVision(tmpDir, `## Recovery

- continue stranded active QA phase
`);
      const { baseline, git } = initContinuousGitProject(tmpDir);
      git(['add', '.planning/VISION.md']);
      git(['commit', '-q', '-m', 'add vision']);
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(join(tmpDir, 'src', 'declared.js'), 'export const declared = 1;\n');
      writeFileSync(join(tmpDir, 'src', 'supplemental.js'), 'export const supplemental = 1;\n');
      git(['add', 'src/declared.js', 'src/supplemental.js']);
      git(['commit', '-q', '-m', 'seed accepted files']);
      const checkpointSha = git(['rev-parse', 'HEAD']);

      const statePath = join(tmpDir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.run_id = 'run_bug109_existing';
      state.status = 'active';
      state.phase = 'qa';
      state.active_turns = {};
      state.blocked_on = null;
      state.blocked_reason = null;
      state.escalation = null;
      state.pending_phase_transition = null;
      state.pending_run_completion = null;
      state.queued_phase_transition = null;
      state.queued_run_completion = null;
      state.next_recommended_role = 'qa';
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      writeFileSync(join(tmpDir, '.agentxchain', 'history.jsonl'), `${JSON.stringify({
        turn_id: 'turn_bug109_dev',
        run_id: 'run_bug109_existing',
        role: 'dev',
        status: 'accepted',
        artifact: { type: 'workspace', ref: null },
        files_changed: ['src/declared.js'],
        observed_artifact: {
          baseline_ref: baseline,
          files_changed: ['src/declared.js'],
          diff_summary: ' src/declared.js     | 1 +\n src/supplemental.js | 1 +\n',
        },
        checkpoint_sha: checkpointSha,
        checkpointed_at: '2026-04-29T15:30:00.000Z',
        accepted_at: '2026-04-29T15:30:00.000Z',
      })}\n`);

      writeFileSync(join(tmpDir, 'src', 'supplemental.js'), 'export const supplemental = 2;\n');

      writeContinuousSession(tmpDir, {
        session_id: 'cont-bug109-existing',
        started_at: '2026-04-29T15:30:00.000Z',
        vision_path: '.planning/VISION.md',
        runs_completed: 0,
        max_runs: 1,
        idle_cycles: 0,
        max_idle_cycles: 3,
        current_run_id: 'run_bug109_existing',
        current_vision_objective: 'continue stranded active QA phase',
        status: 'paused',
        cumulative_spent_usd: 0,
      });

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { ...resolveContinuousOptions({ continuous: true, maxRuns: 1, maxIdleCycles: 3 }, context.config), cooldownSeconds: 0 };
      let executeCount = 0;
      const logs = [];
      const { exitCode } = await executeContinuousRun(
        context,
        contOpts,
        async () => {
          executeCount += 1;
          const current = JSON.parse(readFileSync(statePath, 'utf8'));
          if (executeCount === 1) {
            return {
              exitCode: 1,
              result: {
                stop_reason: 'blocked',
                state: { run_id: current.run_id, status: 'active', phase: current.phase },
                errors: [
                  'assignTurn(qa): Accepted turn turn_bug109_dev is checkpointed but still owns 1 dirty actor file(s) from its observed diff summary. Run agentxchain checkpoint-turn --turn turn_bug109_dev to create a supplemental checkpoint before assigning the next code-writing turn.',
                ],
              },
            };
          }
          current.status = 'completed';
          current.completed_at = new Date().toISOString();
          current.active_turns = {};
          writeFileSync(statePath, JSON.stringify(current, null, 2));
          return {
            exitCode: 0,
            result: { stop_reason: 'completed', state: { run_id: current.run_id, status: 'completed', phase: current.phase } },
          };
        },
        (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0, logs.join('\n'));
      assert.equal(executeCount, 2, 'continuous loop should retry the active run after auto-checkpoint');
      assert.ok(logs.some((line) => line.includes('Auto-checkpoint recovered accepted turn turn_bug109_dev')));
      assert.equal(git(['status', '--short', 'src/supplemental.js']), '');
      const headSubject = git(['log', '-1', '--pretty=%s']);
      assert.match(headSubject, /^checkpoint: turn_bug109_dev/);
      const history = readFileSync(join(tmpDir, '.agentxchain', 'history.jsonl'), 'utf8');
      assert.ok(history.includes('"src/supplemental.js"'));
      assert.ok(readEvents(tmpDir).some((entry) => entry.event_type === 'continuous_auto_checkpoint_recovered'));
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
      assert.equal(typeof mod.ingestAcceptedIdleExpansion, 'function');
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
      assert.ok(content.includes("'--on-idle <mode>'"));
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

  // -------------------------------------------------------------------
  // BUG-60 Slice 3: Session vision snapshot persistence
  // -------------------------------------------------------------------
  describe('BUG-60 Slice 3: session vision snapshot persistence', () => {
    it('executeContinuousRun captures vision_headings_snapshot in session', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Human Role\n- sovereignty at boundaries\n## Protocol\n- durable spec\n', 'utf8');

        const context = { root: dir, config: { schema_version: '1.0' } };
        const contOpts = resolveContinuousOptions({
          continuous: true,
          vision: '.planning/VISION.md',
          maxRuns: 1,
          maxIdleCycles: 1,
          pollSeconds: 0,
          cooldownSeconds: 0,
        }, context.config);

        let callCount = 0;
        const fakeExecutor = async () => {
          callCount++;
          return { exitCode: 1, result: null };
        };

        await executeContinuousRun(context, contOpts, fakeExecutor, () => {});

        const session = readContinuousSession(dir);
        assert.ok(session, 'session should be written');
        assert.ok(Array.isArray(session.vision_headings_snapshot), 'vision_headings_snapshot should be an array');
        assert.ok(session.vision_headings_snapshot.includes('Human Role'));
        assert.ok(session.vision_headings_snapshot.includes('Protocol'));
        assert.ok(typeof session.vision_sha_at_snapshot === 'string');
        assert.equal(session.vision_sha_at_snapshot.length, 64);
        assert.equal(session.expansion_iteration, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('advanceContinuousRunOnce emits vision_snapshot_stale when VISION.md changes', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        const visionPath = join(planDir, 'VISION.md');
        writeFileSync(visionPath, '## Goals\n- build it\n', 'utf8');

        const context = { root: dir, config: { schema_version: '1.0' } };
        const contOpts = resolveContinuousOptions({
          continuous: true,
          vision: '.planning/VISION.md',
          maxRuns: 1,
          maxIdleCycles: 1,
        }, context.config);

        // Create a session with the original snapshot
        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const originalContent = '## Goals\n- build it\n';
        const session = {
          session_id: 'cont-test1234',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 0,
          max_runs: 1,
          idle_cycles: 0,
          max_idle_cycles: 1,
          current_run_id: null,
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(originalContent),
          vision_sha_at_snapshot: computeVisionContentSha(originalContent),
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        // Now change VISION.md
        writeFileSync(visionPath, '## Goals\n- build something else\n## New Section\n- extra\n', 'utf8');

        const logs = [];
        const fakeExecutor = async () => ({ exitCode: 1, result: null });

        await advanceContinuousRunOnce(context, session, contOpts, fakeExecutor, (msg) => logs.push(msg));

        // Check that the stale warning was logged
        const staleLog = logs.find(l => l.includes('VISION.md has changed since session started'));
        assert.ok(staleLog, `Expected stale warning in logs: ${JSON.stringify(logs)}`);

        // Check that event was emitted
        const eventsPath = join(dir, '.agentxchain', 'events.jsonl');
        assert.ok(existsSync(eventsPath), 'events.jsonl should exist');
        const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        const staleEvent = events.find(e => e.event_type === 'vision_snapshot_stale');
        assert.ok(staleEvent, 'vision_snapshot_stale event should be emitted');
        assert.equal(staleEvent.payload.session_id, 'cont-test1234');
        assert.equal(staleEvent.payload.snapshot_sha, session.vision_sha_at_snapshot);

        // Check dedup: calling again with same changed content should NOT re-emit
        const logs2 = [];
        const session2 = readContinuousSession(dir);
        await advanceContinuousRunOnce(context, session2, contOpts, fakeExecutor, (msg) => logs2.push(msg));
        const staleLog2 = logs2.find(l => l.includes('VISION.md has changed since session started'));
        assert.ok(!staleLog2, 'stale warning should NOT repeat for same SHA');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('budget fires before idle-expansion dispatch (dual-cap regression)', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        // Complete the goal so idle cycles accumulate
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 2, onIdle: 'perpetual' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
          perSessionMaxUsd: 1.00,
        };

        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const visionContent = readFileSync(join(planDir, 'VISION.md'), 'utf8');
        const session = {
          session_id: 'cont-budget-first',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 2, // At the idle threshold
          max_idle_cycles: 2,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: 1.00,
          cumulative_spent_usd: 1.50, // Over budget
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(visionContent),
          vision_sha_at_snapshot: computeVisionContentSha(visionContent),
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('should not execute run when budget exhausted'),
          () => {},
        );

        // Budget must fire BEFORE idle-expansion, even though idle_cycles >= maxIdleCycles
        assert.equal(step.status, 'session_budget');
        assert.equal(step.action, 'session_budget_exhausted');
        assert.equal(step.stop_reason, 'session_budget');
        assert.equal(readContinuousSession(dir).status, 'session_budget');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('perpetual mode dispatches idle expansion when idle cycles reached', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'perpetual' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
        };

        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const visionContent = readFileSync(join(planDir, 'VISION.md'), 'utf8');
        const session = {
          session_id: 'cont-perpetual',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(visionContent),
          vision_sha_at_snapshot: computeVisionContentSha(visionContent),
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const logs = [];
        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('should not execute run during dispatch step'),
          (msg) => logs.push(msg),
        );

        assert.equal(step.status, 'running');
        assert.equal(step.action, 'idle_expansion_dispatched');
        assert.equal(step.expansion_iteration, 1);
        assert.ok(step.intent_id);

        // Session should have incremented expansion_iteration and reset idle_cycles
        const savedSession = readContinuousSession(dir);
        assert.equal(savedSession.expansion_iteration, 1);
        assert.equal(savedSession.idle_cycles, 0);

        // Event should have been emitted
        const events = readEvents(dir);
        const dispatched = events.find(e => e.event_type === 'idle_expansion_dispatched');
        assert.ok(dispatched, 'idle_expansion_dispatched event expected');
        assert.equal(dispatched.payload.expansion_iteration, 1);
        assert.ok(dispatched.payload.intent_id);

        // The intent should exist in the intake pipeline
        const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${step.intent_id}.json`);
        assert.ok(existsSync(intentPath), 'PM idle-expansion intent should be created');
        const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
        assert.equal(intent.status, 'approved');
        assert.ok(intent.charter.includes('[idle-expansion #1]'));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('BUG-68: loads pm-idle-expansion.md into the dispatched intake charter', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const promptDir = join(dir, '.agentxchain', 'prompts');
        mkdirSync(promptDir, { recursive: true });
        writeFileSync(
          join(promptDir, 'pm-idle-expansion.md'),
          'CUSTOM BUG-68 PROMPT: prefer roadmap-backed intake titles.\n',
          'utf8',
        );

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'perpetual' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
        };

        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const visionContent = readFileSync(join(planDir, 'VISION.md'), 'utf8');
        const session = {
          session_id: 'cont-bug68',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(visionContent),
          vision_sha_at_snapshot: computeVisionContentSha(visionContent),
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context,
          session,
          contOpts,
          async () => assert.fail('should not execute run during dispatch step'),
          () => {},
        );

        assert.equal(step.action, 'idle_expansion_dispatched');
        const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${step.intent_id}.json`);
        const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
        assert.ok(intent.charter.includes('PM idle-expansion prompt from .agentxchain/prompts/pm-idle-expansion.md'));
        assert.ok(intent.charter.includes('CUSTOM BUG-68 PROMPT: prefer roadmap-backed intake titles.'));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('BUG-63: perpetual mode does not dispatch idle expansion into an inherited blocked run', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
          schema_version: '1.0',
          run_id: 'run_blocked_001',
          project_id: 'ct-001',
          status: 'blocked',
          phase: 'implementation',
          accepted_integration_ref: null,
          active_turns: {},
          turn_sequence: 1,
          last_completed_turn_id: 'turn_pm_001',
          blocked_on: 'human:planning_signoff requires approval',
          blocked_reason: {
            category: 'needs_human',
            blocked_at: '2026-04-24T00:00:00.000Z',
            turn_id: 'turn_pm_001',
            recovery: {
              typed_reason: 'needs_human',
              owner: 'human',
              recovery_action: 'agentxchain unblock hesc_blocked_001',
              turn_retained: false,
              detail: 'planning_signoff requires approval',
            },
          },
          escalation: null,
          phase_gate_status: {},
        }, null, 2));

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'perpetual' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
        };

        const session = {
          session_id: 'cont-bug63-blocked',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_blocked_001',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('blocked startup must not execute governed run'),
          () => {},
        );

        assert.equal(step.status, 'blocked');
        assert.equal(step.action, 'still_blocked');
        assert.equal(step.recovery_action, 'agentxchain unblock hesc_blocked_001');
        assert.equal(step.blocked_category, 'needs_human');
        assert.equal(readContinuousSession(dir).status, 'paused');

        const events = readEvents(dir);
        assert.equal(events.some(e => e.event_type === 'idle_expansion_dispatched'), false);
        const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
        const intentFiles = existsSync(intentsDir) ? readdirSync(intentsDir) : [];
        assert.deepEqual(intentFiles.sort(), ['intent_done.json']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('BUG-63: operator-commit reconcile refusal wins over idle-expansion mutation at idle threshold', async () => {
      const { git } = initContinuousGitProject(tmpDir);
      writeVision(tmpDir, '## Goals\n- build it\n');
      writeIntent(tmpDir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });
      const statePath = join(tmpDir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, JSON.stringify({ ...state, unsafe_edit: true }, null, 2));
      git(['add', '-f', '.agentxchain/state.json']);
      git(['commit', '-q', '-m', 'operator: edit governed state']);

      const context = { root: tmpDir, config: readTestConfig(tmpDir) };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'perpetual' }, context.config),
        reconcileOperatorCommits: 'auto_safe_only',
        pollSeconds: 0,
        cooldownSeconds: 0,
      };
      const session = {
        session_id: 'cont-bug63-drift',
        status: 'running',
        current_run_id: 'run_bug62',
        runs_completed: 1,
        idle_cycles: 1,
        max_idle_cycles: 1,
        expansion_iteration: 0,
        cumulative_spent_usd: 0,
      };
      writeContinuousSession(tmpDir, session);

      const step = await advanceContinuousRunOnce(
        context, session, contOpts,
        async () => assert.fail('unsafe reconcile must stop before execution'),
        () => {},
      );

      assert.equal(step.status, 'blocked');
      assert.equal(step.action, 'operator_commit_reconcile_refused');
      assert.equal(step.error_class, 'governance_state_modified');
      assert.equal(readContinuousSession(tmpDir).status, 'paused');

      const events = readEvents(tmpDir);
      assert.ok(events.some(e => e.event_type === 'operator_commit_reconcile_refused'));
      assert.equal(events.some(e => e.event_type === 'idle_expansion_dispatched'), false);
      const intentsDir = join(tmpDir, '.agentxchain', 'intake', 'intents');
      const intentFiles = existsSync(intentsDir) ? readdirSync(intentsDir) : [];
      assert.deepEqual(intentFiles.sort(), ['intent_done.json']);
    });

    it('human_review mode pauses when idle cycles reached', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'human_review' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
        };

        const session = {
          session_id: 'cont-human-review',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('should not execute run while pausing for human review'),
          () => {},
        );

        assert.equal(step.status, 'blocked');
        assert.equal(step.action, 'idle_human_review_required');
        assert.equal(step.stop_reason, 'human_review');
        assert.equal(step.blocked_category, 'idle_human_review');
        assert.match(step.recovery_action, /continuous-session\.json/);

        const savedSession = readContinuousSession(dir);
        assert.equal(savedSession.status, 'paused');

        const events = readEvents(dir);
        const reviewEvent = events.find(e => e.event_type === 'idle_human_review_required');
        assert.ok(reviewEvent, 'idle_human_review_required event expected');
        assert.equal(reviewEvent.payload.session_id, 'cont-human-review');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('expansion cap returns vision_expansion_exhausted', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'perpetual' }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
          idleExpansion: {
            sources: ['.planning/VISION.md'],
            maxExpansions: 2,
            role: 'pm',
            malformedRetryLimit: 1,
          },
        };

        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const visionContent = readFileSync(join(planDir, 'VISION.md'), 'utf8');
        const session = {
          session_id: 'cont-cap',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(visionContent),
          vision_sha_at_snapshot: computeVisionContentSha(visionContent),
          expansion_iteration: 2, // Already at cap
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('should not execute run when expansion cap reached'),
          () => {},
        );

        assert.equal(step.status, 'vision_expansion_exhausted');
        assert.equal(step.action, 'idle_expansion_cap_reached');
        assert.equal(readContinuousSession(dir).status, 'vision_expansion_exhausted');

        // Event should be emitted
        const events = readEvents(dir);
        const capEvent = events.find(e => e.event_type === 'idle_expansion_cap_reached');
        assert.ok(capEvent, 'idle_expansion_cap_reached event expected');
        assert.equal(capEvent.payload.max_expansions, 2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('exit mode falls through to idle_exit (backward compat)', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');
        writeIntent(dir, { intentId: 'intent_done', status: 'completed', charter: 'build it implementation' });

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxIdleCycles: 1, onIdle: 'exit' }, context.config),
          pollSeconds: 0,
        };

        const { computeVisionContentSha, captureVisionHeadingsSnapshot } = await import('../src/lib/vision-reader.js');
        const visionContent = readFileSync(join(planDir, 'VISION.md'), 'utf8');
        const session = {
          session_id: 'cont-exit',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 10,
          idle_cycles: 1,
          max_idle_cycles: 1,
          current_run_id: 'run_prev',
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: captureVisionHeadingsSnapshot(visionContent),
          vision_sha_at_snapshot: computeVisionContentSha(visionContent),
          expansion_iteration: 0,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context, session, contOpts,
          async () => assert.fail('should not execute run in idle exit'),
          () => {},
        );

        assert.equal(step.status, 'idle_exit');
        assert.equal(step.action, 'max_idle_reached');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('session persists expansion_iteration field defaulting to 0', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- do things\n', 'utf8');

        const context = { root: dir, config: { schema_version: '1.0' } };
        const contOpts = resolveContinuousOptions({
          continuous: true,
          vision: '.planning/VISION.md',
          maxRuns: 1,
          maxIdleCycles: 1,
          pollSeconds: 0,
          cooldownSeconds: 0,
        }, context.config);

        await executeContinuousRun(context, contOpts, async () => ({ exitCode: 1, result: null }), () => {});

        const session = readContinuousSession(dir);
        assert.equal(session.expansion_iteration, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------
  // BUG-60 Slice 5: ingestAcceptedIdleExpansion
  // -------------------------------------------------------------------
  describe('BUG-60 Slice 5: ingestAcceptedIdleExpansion', () => {
    it('ingests new_intake_intent and records a new intake intent through pipeline', () => {
      const dir = createTmpProject();
      try {
        const context = { root: dir, config: readTestConfig(dir) };
        const session = {
          session_id: 'cont-ingest',
          current_run_id: 'run_ingest',
          expansion_iteration: 1,
          status: 'running',
        };
        writeContinuousSession(dir, session);

        const turnResult = {
          idle_expansion_result: {
            kind: 'new_intake_intent',
            new_intake_intent: {
              charter: 'Implement caching layer for API responses',
              acceptance_contract: ['API responses are cached with configurable TTL'],
              priority: 'p1',
            },
            vision_traceability: [{ heading: 'Protocol', citation: 'durable spec' }],
          },
        };

        const result = ingestAcceptedIdleExpansion(context, session, {
          turnResult,
          historyEntry: {},
          state: {},
        });

        assert.equal(result.ingested, true);
        assert.equal(result.kind, 'new_intake_intent');
        assert.ok(result.intentId);

        // Verify the intent was created in the intake pipeline
        const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${result.intentId}.json`);
        assert.ok(existsSync(intentPath), 'PM-derived intent should exist');
        const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
        assert.equal(intent.status, 'approved');
        assert.ok(intent.charter.includes('[pm-derived]'));
        assert.ok(intent.charter.includes('caching layer'));

        // Verify event emitted
        const events = readEvents(dir);
        const ingested = events.find(e => e.event_type === 'idle_expansion_ingested');
        assert.ok(ingested, 'idle_expansion_ingested event expected');
        assert.equal(ingested.payload.kind, 'new_intake_intent');
        assert.equal(ingested.payload.intent_id, result.intentId);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ingests vision_exhausted and sets session to completed', () => {
      const dir = createTmpProject();
      try {
        const context = { root: dir, config: readTestConfig(dir) };
        const session = {
          session_id: 'cont-exhausted',
          current_run_id: 'run_exhausted',
          expansion_iteration: 3,
          status: 'running',
        };
        writeContinuousSession(dir, session);

        const turnResult = {
          idle_expansion_result: {
            kind: 'vision_exhausted',
            expansion_iteration: 3,
            vision_traceability: [],
            vision_exhausted: {
              classification: [
                { vision_heading: 'Protocol', status: 'complete', reason: 'All vision goals have been fully addressed by prior increments.' },
              ],
            },
          },
        };

        const result = ingestAcceptedIdleExpansion(context, session, {
          turnResult,
          historyEntry: {},
          state: {},
        });

        assert.equal(result.ingested, true);
        assert.equal(result.kind, 'vision_exhausted');

        // Session should be completed
        const savedSession = readContinuousSession(dir);
        assert.equal(savedSession.status, 'vision_exhausted');

        // Event should be emitted
        const events = readEvents(dir);
        const ingested = events.find(e => e.event_type === 'idle_expansion_ingested');
        assert.ok(ingested, 'idle_expansion_ingested event expected');
        assert.equal(ingested.payload.kind, 'vision_exhausted');
        assert.ok(ingested.payload.reason_excerpt.includes('fully addressed'));
        assert.equal(ingested.payload.classification[0].vision_heading, 'Protocol');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('advanceContinuousRunOnce ingests accepted idle-expansion results from execution output', async () => {
      const dir = createTmpProject();
      try {
        writeVision(dir, '## Goals\n- build it\n');
        writeIntent(dir, {
          intentId: 'intent_idle_expansion',
          status: 'approved',
          charter: '[idle-expansion #1] derive next increment',
        });
        const intentPath = join(dir, '.agentxchain', 'intake', 'intents', 'intent_idle_expansion.json');
        const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
        const eventsDir = join(dir, '.agentxchain', 'intake', 'events');
        mkdirSync(eventsDir, { recursive: true });
        writeFileSync(join(eventsDir, `${intent.event_id}.json`), JSON.stringify({
          schema_version: '1.0',
          event_id: intent.event_id,
          source: 'vision_idle_expansion',
          category: 'idle_expansion',
          created_at: new Date().toISOString(),
          signal: { expansion_key: 'a'.repeat(64), expansion_iteration: 1, accepted_turn_id: 'pre_dispatch_test' },
          evidence: [{ type: 'text', value: 'idle expansion test event' }],
          dedup_key: 'vision_idle_expansion:test',
          idle_expansion_context: {
            expansion_iteration: 1,
            vision_headings_snapshot: ['Goals'],
          },
        }, null, 2));

        const context = { root: dir, config: readTestConfig(dir) };
        const contOpts = {
          ...resolveContinuousOptions({ continuous: true, maxRuns: 5, maxIdleCycles: 1 }, context.config),
          pollSeconds: 0,
          cooldownSeconds: 0,
        };
        const session = {
          session_id: 'cont-exec-ingest',
          started_at: new Date().toISOString(),
          vision_path: '.planning/VISION.md',
          runs_completed: 1,
          max_runs: 5,
          idle_cycles: 0,
          max_idle_cycles: 1,
          current_run_id: null,
          current_vision_objective: null,
          status: 'running',
          per_session_max_usd: null,
          cumulative_spent_usd: 0,
          budget_exhausted: false,
          startup_reconciled_run_id: null,
          vision_headings_snapshot: ['Goals'],
          vision_sha_at_snapshot: 'abc',
          expansion_iteration: 1,
          _vision_stale_warned_shas: [],
        };
        writeContinuousSession(dir, session);

        const step = await advanceContinuousRunOnce(
          context,
          session,
          contOpts,
          async () => ({
            exitCode: 0,
            result: {
              ok: true,
              stop_reason: 'completed',
              state: { run_id: 'run_idle_expansion', status: 'completed' },
              accepted_turn_results: [
                {
                  turn_id: 'turn_idle_expansion',
                  accepted: { turn_id: 'turn_idle_expansion' },
                  turn_result: {
                    idle_expansion_result: {
                      kind: 'new_intake_intent',
                      expansion_iteration: 1,
                      vision_traceability: [
                        { vision_heading: 'Goals', goal: 'build it', kind: 'advances' },
                      ],
                      new_intake_intent: {
                        title: 'Implement next build increment',
                        charter: 'Implement the next build increment derived from the idle-expansion PM turn.',
                        acceptance_contract: ['The next build increment has executable proof.'],
                        priority: 'p1',
                        template: 'generic',
                      },
                    },
                  },
                },
              ],
            },
          }),
          () => {},
        );

        assert.equal(step.status, 'running');
        assert.equal(step.action, 'idle_expansion_ingested');
        assert.ok(step.intent_id);

        const savedSession = readContinuousSession(dir);
        assert.equal(savedSession.runs_completed, 1, 'PM idle-expansion turn must not count as a completed product run');

        const createdIntentPath = join(dir, '.agentxchain', 'intake', 'intents', `${step.intent_id}.json`);
        assert.ok(existsSync(createdIntentPath), 'PM-derived intake intent should be created');
        const createdIntent = JSON.parse(readFileSync(createdIntentPath, 'utf8'));
        assert.equal(createdIntent.status, 'approved');
        assert.equal(createdIntent.priority, 'p1');
        assert.ok(createdIntent.charter.includes('[pm-derived]'));

        const events = readEvents(dir);
        assert.ok(events.find(e => e.event_type === 'idle_expansion_ingested'), 'idle_expansion_ingested event expected');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects malformed result (missing idle_expansion_result)', () => {
      const dir = createTmpProject();
      try {
        const context = { root: dir, config: readTestConfig(dir) };
        const session = {
          session_id: 'cont-malformed',
          current_run_id: 'run_malformed',
          expansion_iteration: 1,
          status: 'running',
        };

        const result = ingestAcceptedIdleExpansion(context, session, {
          turnResult: {},
          historyEntry: {},
          state: {},
        });

        assert.equal(result.ingested, false);
        assert.ok(result.error.includes('Missing or invalid'));

        // Event should be emitted
        const events = readEvents(dir);
        const malformed = events.find(e => e.event_type === 'idle_expansion_malformed');
        assert.ok(malformed, 'idle_expansion_malformed event expected');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects unknown kind', () => {
      const dir = createTmpProject();
      try {
        const context = { root: dir, config: readTestConfig(dir) };
        const session = {
          session_id: 'cont-unknown',
          current_run_id: 'run_unknown',
          expansion_iteration: 1,
          status: 'running',
        };

        const result = ingestAcceptedIdleExpansion(context, session, {
          turnResult: {
            idle_expansion_result: {
              kind: 'do_something_random',
            },
          },
          historyEntry: {},
          state: {},
        });

        assert.equal(result.ingested, false);
        assert.ok(result.error.includes('do_something_random'));

        const events = readEvents(dir);
        const malformed = events.find(e => e.event_type === 'idle_expansion_malformed');
        assert.ok(malformed);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects new_intake_intent with missing charter', () => {
      const dir = createTmpProject();
      try {
        const context = { root: dir, config: readTestConfig(dir) };
        const session = {
          session_id: 'cont-no-charter',
          current_run_id: 'run_no_charter',
          expansion_iteration: 1,
          status: 'running',
        };

        const result = ingestAcceptedIdleExpansion(context, session, {
          turnResult: {
            idle_expansion_result: {
              kind: 'new_intake_intent',
              new_intake_intent: {
                acceptance_contract: ['test'],
                // missing charter
              },
            },
          },
          historyEntry: {},
          state: {},
        });

        assert.equal(result.ingested, false);
        assert.ok(result.error.includes('missing required fields'));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------
  // BUG-60 Slice 5: terminal state descriptions
  // -------------------------------------------------------------------
  describe('BUG-60 Slice 5: terminal state descriptions', () => {
    it('executeContinuousRun treats vision_exhausted as terminal', async () => {
      const dir = createTmpProject();
      try {
        const planDir = join(dir, '.planning');
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, 'VISION.md'), '## Goals\n- build it\n', 'utf8');

        // The main loop checks step.status against a set of terminal states.
        // Verify new terminal states are in the set by checking the source.
        const content = readFileSync(join(cliRoot, 'src', 'lib', 'continuous-run.js'), 'utf8');
        assert.ok(content.includes("step.status === 'vision_exhausted'"), 'vision_exhausted must be a terminal state');
        assert.ok(content.includes("step.status === 'vision_expansion_exhausted'"), 'vision_expansion_exhausted must be a terminal state');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('describeContinuousTerminalStep produces messages for new terminal states', () => {
      const content = readFileSync(join(cliRoot, 'src', 'lib', 'continuous-run.js'), 'utf8');
      assert.ok(content.includes('PM idle-expansion declared vision exhausted. Stopping.'), 'vision_exhausted description');
      assert.ok(content.includes('Idle-expansion cap reached'), 'vision_expansion_exhausted description');
    });
  });
});
