import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createGovernedProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-escalate-test-'));

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: {
      id: 'escalation-fixture',
      name: 'Escalation Fixture',
      default_branch: 'main',
    },
    template: 'generic',
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect scope.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'qa', 'human'], exit_gate: 'planning_signoff' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'human'], exit_gate: 'qa_signoff' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
      qa_signoff: { requires_files: ['.planning/ship-verdict.md'] },
    },
    prompts: {
      pm: '.agentxchain/prompts/pm.md',
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
    schema_version: '1.1',
    run_id: 'run_esc_01',
    project_id: 'escalation-fixture',
    status: 'active',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'pending',
      qa_signoff: 'pending',
    },
    budget_status: {
      spent_usd: 0,
      remaining_usd: 100,
    },
    budget_reservations: {},
    ...overrides.state,
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), '# pm\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), '# qa\n');
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
  writeFileSync(join(dir, '.planning', 'ship-verdict.md'), '# verdict\n');

  return dir;
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
}

function readLedger(dir) {
  const raw = readFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
}

describe('escalate command', () => {
  it('AT-ESC-001: raises a run-level operator escalation and exposes operator_escalation recovery', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['escalate', '--reason', 'Scope contradiction']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Typed:\s+operator_escalation/);
      assert.match(result.stdout, /Action:\s+Resolve the escalation, then run agentxchain step/);
      assert.match(result.stdout, /Retained:\s+no/);

      const state = readState(dir);
      assert.equal(state.status, 'blocked');
      assert.match(state.blocked_on, /^escalation:operator:/);
      assert.equal(state.blocked_reason.category, 'operator_escalation');
      assert.equal(state.blocked_reason.recovery.typed_reason, 'operator_escalation');
      assert.equal(state.escalation.from_turn_id, null);

      const ledger = readLedger(dir);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].decision, 'operator_escalated');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-002: retains a single active turn automatically and requires step --resume recovery', () => {
    const dir = createGovernedProject({
      state: {
        active_turns: {
          turn_pm_01: {
            turn_id: 'turn_pm_01',
            assigned_role: 'pm',
            runtime_id: 'manual-pm',
            status: 'assigned',
            attempt: 1,
            assigned_sequence: 1,
            started_at: '2026-04-04T00:00:00.000Z',
            deadline_at: '2026-04-04T00:20:00.000Z',
          },
        },
        turn_sequence: 1,
      },
    });
    try {
      const result = runCli(dir, ['escalate', '--reason', 'Need product review']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn:\s+turn_pm_01/);
      assert.match(result.stdout, /Action:\s+Resolve the escalation, then run agentxchain step --resume/);
      assert.match(result.stdout, /Retained:\s+yes/);

      const state = readState(dir);
      assert.equal(state.escalation.from_turn_id, 'turn_pm_01');
      assert.equal(state.escalation.from_role, 'pm');
      assert.equal(state.blocked_reason.recovery.turn_retained, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-003 and AT-ESC-004: multiple active turns require --turn and target the selected turn', () => {
    const dir = createGovernedProject({
      state: {
        active_turns: {
          turn_pm_01: {
            turn_id: 'turn_pm_01',
            assigned_role: 'pm',
            runtime_id: 'manual-pm',
            status: 'assigned',
            attempt: 1,
            assigned_sequence: 1,
          },
          turn_qa_02: {
            turn_id: 'turn_qa_02',
            assigned_role: 'qa',
            runtime_id: 'manual-qa',
            status: 'assigned',
            attempt: 1,
            assigned_sequence: 2,
          },
        },
        turn_sequence: 2,
      },
    });
    try {
      const missingTarget = runCli(dir, ['escalate', '--reason', 'Cross-role deadlock']);
      assert.equal(missingTarget.status, 1);
      assert.match(missingTarget.stdout, /Multiple active turns exist\. Use --turn <id>/);

      const targeted = runCli(dir, ['escalate', '--reason', 'Cross-role deadlock', '--turn', 'turn_qa_02']);
      assert.equal(targeted.status, 0, targeted.stderr);

      const state = readState(dir);
      assert.equal(state.escalation.from_turn_id, 'turn_qa_02');
      assert.equal(state.escalation.from_role, 'qa');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-005: resume clears a retained escalation block and appends escalation_resolved', () => {
    const dir = createGovernedProject({
      state: {
        active_turns: {
          turn_pm_01: {
            turn_id: 'turn_pm_01',
            assigned_role: 'pm',
            runtime_id: 'manual-pm',
            status: 'assigned',
            attempt: 1,
            assigned_sequence: 1,
          },
        },
        turn_sequence: 1,
      },
    });
    try {
      const escalated = runCli(dir, ['escalate', '--reason', 'Need human review']);
      assert.equal(escalated.status, 0, escalated.stderr);

      const resumed = runCli(dir, ['resume']);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.match(resumed.stdout, /Re-dispatching blocked turn: turn_pm_01/);

      const state = readState(dir);
      assert.equal(state.status, 'active');
      assert.equal(state.blocked_on, null);
      assert.equal(state.escalation, null);
      assert.ok(existsSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_pm_01', 'PROMPT.md')));

      const ledger = readLedger(dir);
      assert.deepEqual(
        ledger.map((entry) => entry.decision),
        ['operator_escalated', 'escalation_resolved'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-006: resume clears a run-level escalation and assigns the next turn', () => {
    const dir = createGovernedProject();
    try {
      const escalated = runCli(dir, ['escalate', '--reason', 'Waiting on scope decision']);
      assert.equal(escalated.status, 0, escalated.stderr);

      const resumed = runCli(dir, ['resume']);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.match(resumed.stdout, /Resumed blocked run: run_esc_01/);

      const state = readState(dir);
      assert.equal(state.status, 'active');
      assert.equal(state.blocked_on, null);
      assert.equal(Object.keys(state.active_turns).length, 1);

      const [decision1, decision2] = readLedger(dir).map((entry) => entry.decision);
      assert.equal(decision1, 'operator_escalated');
      assert.equal(decision2, 'escalation_resolved');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-007: retry-exhaustion escalation remains retries_exhausted, not operator_escalation', () => {
    const dir = createGovernedProject({
      state: {
        status: 'blocked',
        blocked_on: 'escalation:retries-exhausted:qa',
        escalation: {
          from_role: 'qa',
          from_turn_id: 'turn_qa_01',
          reason: 'Turn rejected 2 times. Retries exhausted.',
          escalated_at: '2026-04-04T00:00:00.000Z',
        },
        active_turns: {
          turn_qa_01: {
            turn_id: 'turn_qa_01',
            assigned_role: 'qa',
            runtime_id: 'manual-qa',
            status: 'failed',
            attempt: 2,
            assigned_sequence: 1,
          },
        },
      },
    });
    try {
      const result = runCli(dir, ['status']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reason:\s+retries_exhausted/);
      assert.doesNotMatch(result.stdout, /Reason:\s+operator_escalation/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
