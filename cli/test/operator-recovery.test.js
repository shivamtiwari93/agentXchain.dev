import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createGovernedProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-recovery-test-'));

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  // Create turn-scoped staging directory if state has a turn
  const turnId = (overrides.state?.current_turn || overrides.state?.active_turns)
    ? (overrides.state?.current_turn?.turn_id || Object.keys(overrides.state?.active_turns || {})[0])
    : null;
  if (turnId) {
    mkdirSync(join(dir, '.agentxchain', 'staging', turnId), { recursive: true });
  }

  const config = {
    schema_version: '1.0',
    project: {
      id: 'baby-tracker',
      name: 'Baby Tracker',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'review_only',
        runtime: 'api-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['claude', '--print'], cwd: '.' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'], requires_human_approval: true },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'], requires_human_approval: true },
    },
    prompts: {
      pm: '.agentxchain/prompts/pm.md',
      dev: '.agentxchain/prompts/dev.md',
      qa: '.agentxchain/prompts/qa.md',
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
    ...overrides.config,
  };

  const state = {
    schema_version: '1.0',
    run_id: 'run_01H',
    project_id: 'baby-tracker',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: null,
    last_completed_turn_id: 'turn_01G',
    blocked_on: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
    },
    budget_status: {
      spent_usd: 1.25,
      remaining_usd: 48.75,
    },
    ...overrides.state,
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), `${JSON.stringify({ turn_id: 'turn_01G', role: 'pm', status: 'completed' })}\n`);
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), '# pm\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'dev.md'), '# dev\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), '# qa\n');
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# roadmap\n');
  writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), '# acceptance\n');
  writeFileSync(join(dir, '.planning', 'ship-verdict.md'), '# ship verdict\n');
  writeFileSync(join(dir, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n');

  return dir;
}

function runCli(dir, args, extra = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: extra.env || process.env,
  });
}

function makeValidTurnResult(state, overrides = {}) {
  const turn = state.current_turn;
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Completed the assigned work.',
    decisions: [],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Initial review captured the main risk.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Validated manually.',
    },
    artifact: {
      type: 'review',
      ref: null,
    },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    },
    ...overrides,
  };
}

function initGitRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'AgentXchain Test'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md', 'agentxchain.json', '.agentxchain/state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
}

describe('operator recovery surfaces', () => {
  it('status shows approve-transition recovery details for pending phase transitions', () => {
    const dir = createGovernedProject({
      state: {
        status: 'paused',
        blocked_on: 'human_approval:planning_signoff',
        pending_phase_transition: {
          from: 'planning',
          to: 'implementation',
          gate: 'planning_signoff',
          requested_by_turn: 'turn_01H',
        },
      },
    });

    try {
      const result = runCli(dir, ['status']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason:\s+pending_phase_transition/);
      assert.match(result.stdout, /Action:\s+agentxchain approve-transition/);
      assert.match(result.stdout, /Turn:\s+cleared/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('status shows approve-completion recovery details for pending run completion', () => {
    const dir = createGovernedProject({
      state: {
        status: 'paused',
        phase: 'qa',
        blocked_on: 'human_approval:qa_ship_verdict',
        pending_run_completion: {
          gate: 'qa_ship_verdict',
          requested_by_turn: 'turn_qa_01',
          requested_at: '2026-04-01T21:00:00Z',
        },
      },
    });

    try {
      const result = runCli(dir, ['status']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason:\s+pending_run_completion/);
      assert.match(result.stdout, /Action:\s+agentxchain approve-completion/);
      assert.match(result.stdout, /Turn:\s+cleared/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('approve-transition succeeds after a hook-blocked approval leaves pending transition intact', () => {
    const dir = createGovernedProject({
      state: {
        status: 'blocked',
        phase: 'planning',
        blocked_on: 'hook:before_gate:compliance-gate',
        blocked_reason: {
          category: 'hook_block',
          blocked_at: '2026-04-02T13:00:00Z',
          turn_id: 'turn_01H',
          recovery: {
            typed_reason: 'pending_phase_transition',
            owner: 'human',
            recovery_action: 'agentxchain approve-transition',
            turn_retained: false,
            detail: 'planning_signoff',
          },
        },
        pending_phase_transition: {
          from: 'planning',
          to: 'implementation',
          gate: 'planning_signoff',
          requested_by_turn: 'turn_01H',
        },
      },
    });

    try {
      const result = runCli(dir, ['approve-transition']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Phase advanced: planning → implementation/);

      const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'active');
      assert.equal(state.phase, 'implementation');
      assert.equal(state.pending_phase_transition, null);
      assert.equal(state.blocked_on, null);
      assert.equal(state.blocked_reason, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('approve-completion succeeds after a hook-blocked approval leaves pending completion intact', () => {
    const dir = createGovernedProject({
      state: {
        status: 'blocked',
        phase: 'qa',
        blocked_on: 'hook:before_gate:final-audit',
        blocked_reason: {
          category: 'hook_block',
          blocked_at: '2026-04-02T13:00:00Z',
          turn_id: 'turn_qa_01',
          recovery: {
            typed_reason: 'pending_run_completion',
            owner: 'human',
            recovery_action: 'agentxchain approve-completion',
            turn_retained: false,
            detail: 'qa_ship_verdict',
          },
        },
        pending_run_completion: {
          gate: 'qa_ship_verdict',
          requested_by_turn: 'turn_qa_01',
          requested_at: '2026-04-02T12:50:00Z',
        },
      },
    });

    try {
      const result = runCli(dir, ['approve-completion']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Run completed/);

      const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.status, 'completed');
      assert.equal(state.pending_run_completion, null);
      assert.equal(state.blocked_on, null);
      assert.equal(state.blocked_reason, null);
      assert.ok(state.completed_at);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('status shows needs_human recovery details', () => {
    const dir = createGovernedProject({
      state: {
        status: 'paused',
        current_turn: null,
        blocked_on: 'human:scope clarification needed',
      },
    });

    try {
      const result = runCli(dir, ['status']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason:\s+needs_human/);
      assert.match(result.stdout, /Action:\s+Resolve the stated issue, then run agentxchain step --resume/);
      assert.match(result.stdout, /Turn:\s+cleared/);

      const migratedState = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(migratedState.status, 'blocked');
      assert.equal(migratedState.blocked_reason.category, 'needs_human');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('status shows escalation recovery details', () => {
    const dir = createGovernedProject({
      state: {
        status: 'paused',
        blocked_on: 'escalation:retries-exhausted:dev',
        current_turn: {
          turn_id: 'turn_retry_01',
          assigned_role: 'dev',
          status: 'failed',
          attempt: 2,
          started_at: '2026-04-01T20:00:00Z',
          deadline_at: '2026-04-01T20:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      const result = runCli(dir, ['status']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason:\s+retries_exhausted/);
      assert.match(result.stdout, /Action:\s+Resolve the escalation, then run agentxchain step/);
      assert.match(result.stdout, /Turn:\s+retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step suggests --resume when a turn is already assigned', () => {
    const dir = createGovernedProject({
      state: {
        current_turn: {
          turn_id: 'turn_01H',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          started_at: '2026-03-31T14:00:00Z',
          deadline_at: '2026-03-31T14:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      const result = runCli(dir, ['step']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /agentxchain step --resume/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step does not bypass paused approval gates', () => {
    const dir = createGovernedProject({
      state: {
        status: 'paused',
        current_turn: null,
        blocked_on: 'human_approval:planning_signoff',
        pending_phase_transition: {
          from: 'planning',
          to: 'implementation',
          gate: 'planning_signoff',
          requested_by_turn: 'turn_01H',
        },
      },
    });

    try {
      const result = runCli(dir, ['step']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /paused for approval/i);
      assert.match(result.stdout, /agentxchain approve-transition/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step reports clean baseline recovery instructions for dirty authoritative trees', () => {
    const dir = createGovernedProject({
      state: {
        current_turn: null,
        phase: 'implementation',
      },
    });

    try {
      initGitRepo(dir);
      writeFileSync(join(dir, 'README.md'), 'dirty change\n');

      const result = runCli(dir, ['step']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Commit or stash those changes before assigning the next code-writing turn/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step names the missing api credential and points to --resume', () => {
    const dir = createGovernedProject({
      state: {
        current_turn: null,
        phase: 'qa',
        status: 'active',
      },
    });

    try {
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;

      const result = runCli(dir, ['step'], { env });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /ANTHROPIC_API_KEY/);
      assert.match(result.stdout, /agentxchain step --resume/);

      const blockedState = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_reason.category, 'dispatch_error');
      assert.match(blockedState.blocked_on, /^dispatch:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn prints validation stage and recovery commands for invalid staged results', () => {
    const dir = createGovernedProject({
      state: {
        current_turn: {
          turn_id: 'turn_01H',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          started_at: '2026-03-31T14:00:00Z',
          deadline_at: '2026-03-31T14:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({ bad: true }, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Validation failed at stage schema/);
      assert.match(result.stdout, /agentxchain validate --mode turn/);
      assert.match(result.stdout, /agentxchain reject-turn --reason/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn renders all four recovery descriptor fields on validation failure', () => {
    const dir = createGovernedProject({
      state: {
        current_turn: {
          turn_id: 'turn_recov_01',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          started_at: '2026-04-01T10:00:00Z',
          deadline_at: '2026-04-01T10:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({ not_valid: true }, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 1);
      // All four normative recovery descriptor fields must be present
      assert.match(result.stdout, /Reason:\s+\S+/);
      assert.match(result.stdout, /Owner:\s+human/);
      assert.match(result.stdout, /Action:\s+Fix staged result and rerun agentxchain accept-turn/);
      assert.match(result.stdout, /Turn:\s+retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step renders recovery descriptor after accepting a turn that pauses for human approval', () => {
    const dir = createGovernedProject({
      state: {
        status: 'active',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_pm_01',
          assigned_role: 'pm',
          status: 'running',
          attempt: 1,
          started_at: '2026-04-01T10:00:00Z',
          deadline_at: '2026-04-01T10:20:00Z',
          runtime_id: 'manual-pm',
        },
        phase_gate_status: {
          planning_signoff: 'pending',
          implementation_complete: 'pending',
          qa_ship_verdict: 'pending',
        },
      },
    });

    try {
      const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      const activeTurn = state.active_turns ? Object.values(state.active_turns)[0] : state.current_turn;
      const stagingDir = join(dir, '.agentxchain', 'staging', activeTurn.turn_id);
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(
        join(stagingDir, 'turn-result.json'),
        JSON.stringify(
          makeValidTurnResult(state, {
            role: 'pm',
            runtime_id: 'manual-pm',
            phase_transition_request: 'implementation',
          }),
          null,
          2,
        ),
      );

      const result = runCli(dir, ['step', '--resume']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Accepted/);
      assert.match(result.stdout, /Reason:\s+pending_phase_transition/);
      assert.match(result.stdout, /Owner:\s+human/);
      assert.match(result.stdout, /Action:\s+agentxchain approve-transition/);
      assert.match(result.stdout, /Turn:\s+cleared/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn at max retries renders escalation recovery descriptor', () => {
    const dir = createGovernedProject({
      config: {
        rules: {
          challenge_required: true,
          max_turn_retries: 2,
          max_deadlock_cycles: 2,
        },
      },
      state: {
        current_turn: {
          turn_id: 'turn_esc_01',
          assigned_role: 'dev',
          status: 'running',
          attempt: 2,
          started_at: '2026-04-01T10:00:00Z',
          deadline_at: '2026-04-01T10:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      // Stage an invalid result so reject-turn has something to reject
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({ bad: true }, null, 2));

      const result = runCli(dir, ['reject-turn', '--reason', 'test escalation']);
      assert.equal(result.status, 0);
      // Should show escalation recovery descriptor
      assert.match(result.stdout, /Reason:\s+retries_exhausted/);
      assert.match(result.stdout, /Owner:\s+human/);
      assert.match(result.stdout, /Action:\s+Resolve the escalation/);
      assert.match(result.stdout, /Turn:\s+retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn with retries remaining shows retry info without recovery descriptor', () => {
    const dir = createGovernedProject({
      config: {
        rules: {
          challenge_required: true,
          max_turn_retries: 3,
          max_deadlock_cycles: 2,
        },
      },
      state: {
        current_turn: {
          turn_id: 'turn_retry_02',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          started_at: '2026-04-01T10:00:00Z',
          deadline_at: '2026-04-01T10:20:00Z',
          runtime_id: 'local-dev',
        },
      },
    });

    try {
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({ bad: true }, null, 2));

      const result = runCli(dir, ['reject-turn', '--reason', 'test retry']);
      assert.equal(result.status, 0);
      // Should show retry info, not escalation
      assert.match(result.stdout, /Rejected For Retry/);
      assert.match(result.stdout, /Attempt:/);
      // Should NOT show escalation recovery descriptor
      assert.doesNotMatch(result.stdout, /retries_exhausted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step --auto-reject renders escalation recovery descriptor when retries are exhausted', () => {
    const dir = createGovernedProject({
      state: {
        status: 'active',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_pm_retry_01',
          assigned_role: 'pm',
          status: 'running',
          attempt: 2,
          started_at: '2026-04-01T10:00:00Z',
          deadline_at: '2026-04-01T10:20:00Z',
          runtime_id: 'manual-pm',
        },
      },
    });

    try {
      mkdirSync(join(dir, '.agentxchain', 'staging', 'turn_pm_retry_01'), { recursive: true });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn_pm_retry_01', 'turn-result.json'), JSON.stringify({ bad: true }, null, 2));

      const result = runCli(dir, ['step', '--resume', '--auto-reject']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Escalated/);
      assert.match(result.stdout, /Reason:\s+retries_exhausted/);
      assert.match(result.stdout, /Owner:\s+human/);
      assert.match(result.stdout, /Action:\s+Resolve the escalation, then run agentxchain step/);
      assert.match(result.stdout, /Turn:\s+retained/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
