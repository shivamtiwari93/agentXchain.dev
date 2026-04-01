import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-test-'));

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

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
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'], requires_human_approval: true },
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
  };

  const state = {
    schema_version: '1.0',
    run_id: 'run_01H',
    project_id: 'baby-tracker',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_01H',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      started_at: '2026-03-31T14:00:00Z',
      deadline_at: '2026-03-31T14:20:00Z',
      runtime_id: 'local-dev',
    },
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

  return dir;
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

function makeTurnResult(state, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Implemented the assigned work and verified the result.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Ship the current implementation slice.',
        rationale: 'It satisfies the active turn contract.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Follow-up cleanup may still be needed.',
        status: 'raised',
      },
    ],
    files_changed: ['README.md'],
    artifacts_created: ['.planning/ship-verdict.md'],
    verification: {
      status: 'pass',
      evidence_summary: 'Checked manually.',
    },
    artifact: {
      type: 'workspace',
      ref: 'git:def456',
    },
    proposed_next_role: 'qa',
    cost: {
      usd: 0.42,
    },
    ...overrides,
  };
}

describe('governed CLI support', () => {
  it('step --help exposes the verbose flag for local_cli dispatch logs', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['step', '--help']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /--verbose/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed points new projects at step instead of start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-init-'));
    try {
      const result = runCli(dir, ['init', '--governed', '-y']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /agentxchain step/);
      assert.doesNotMatch(result.stdout, /agentxchain start/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows governed project status as JSON', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['status', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.protocol_mode, 'governed');
      assert.equal(payload.config.project.name, 'Baby Tracker');
      assert.equal(payload.state.current_turn.assigned_role, 'dev');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates governed project wiring and turn assignment', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['validate', '--mode', 'turn', '--agent', 'dev', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true, readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(payload.protocol_mode, 'governed');
      assert.ok(payload.warnings.some((warning) => warning.includes('No staged turn result found')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn accepts a valid staged result and clears the current turn', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      const staged = makeTurnResult(state);
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Accepted/);

      const updatedState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(updatedState.current_turn, null);
      assert.equal(updatedState.last_completed_turn_id, 'turn_01H');

      const history = readFileSync(join(dir, '.agentxchain', 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
      assert.equal(history.length, 2);
      const last = JSON.parse(history[history.length - 1]);
      assert.equal(last.turn_id, 'turn_01H');
      assert.equal(last.summary, staged.summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn rewrites the dispatch bundle for a retry after validation failure', () => {
    const dir = createGovernedProject();
    try {
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), '{"bad":true}');

      const result = runCli(dir, ['reject-turn', '--reason', 'Schema mismatch']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Rejected For Retry/);

      const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(state.current_turn.attempt, 2);
      assert.equal(state.current_turn.status, 'retrying');

      const assignment = JSON.parse(readFileSync(join(dir, '.agentxchain', 'dispatch', 'current', 'ASSIGNMENT.json'), 'utf8'));
      assert.equal(assignment.turn_id, 'turn_01H');
      assert.equal(assignment.attempt, 2);

      const prompt = readFileSync(join(dir, '.agentxchain', 'dispatch', 'current', 'PROMPT.md'), 'utf8');
      assert.match(prompt, /Previous Attempt Failed/);
      assert.match(prompt, /Schema mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn escalates when retries are exhausted', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.current_turn.attempt = 2;
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), '{"bad":true}');

      const result = runCli(dir, ['reject-turn', '--reason', 'Second failure']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Rejected And Escalated/);

      const updatedState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(updatedState.status, 'paused');
      assert.equal(updatedState.current_turn.status, 'failed');
      assert.match(updatedState.blocked_on, /escalation:retries-exhausted:dev/);
      assert.equal(updatedState.escalation.from_turn_id, 'turn_01H');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn requires a reason when the staged result is otherwise valid', () => {
    const dir = createGovernedProject();
    try {
      const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      const staged = makeTurnResult(state);
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['reject-turn']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Supply --reason to reject it anyway/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step --resume rewrites the dispatch bundle for an already active governed turn', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['step', '--resume']);
      // The local_cli adapter dispatches to subprocess. The command may fail
      // (claude may not be installed in test env), but the dispatch bundle
      // must be written before the subprocess attempt.
      const combined = result.stdout + result.stderr;
      assert.match(combined, /Resuming active turn: turn_01H/);
      assert.match(combined, /Dispatching to local CLI/);

      const assignment = JSON.parse(
        readFileSync(join(dir, '.agentxchain', 'dispatch', 'current', 'ASSIGNMENT.json'), 'utf8')
      );
      assert.equal(assignment.turn_id, 'turn_01H');
      assert.equal(assignment.role, 'dev');
      assert.equal(assignment.runtime_id, 'local-dev');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('malformed config rejection', () => {
  it('rejects invalid JSON in agentxchain.json before any governed side effects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-malformed-'));
    try {
      writeFileSync(join(dir, 'agentxchain.json'), '{ this is not valid json!!!');

      for (const args of [['status'], ['step'], ['resume'], ['validate']]) {
        const result = runCli(dir, args);
        assert.notEqual(result.status, 0, `${args[0]} should fail on malformed JSON`);
        const combined = result.stdout + result.stderr;
        assert.match(combined, /agentxchain\.json|invalid JSON|Warning|No agentxchain/i,
          `${args[0]} should report config parse error`);
      }

      // No governed state files should have been created
      const stateExists = existsSync(join(dir, '.agentxchain', 'state.json'));
      assert.equal(stateExists, false, 'No state.json should be created from malformed config');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects governed config with missing required sections before side effects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-incomplete-'));
    try {
      // Valid JSON but missing roles, runtimes, routing
      writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
        schema_version: '1.0',
        project: { id: 'test', name: 'Test' },
      }));

      for (const args of [['status'], ['step'], ['resume']]) {
        const result = runCli(dir, args);
        const combined = result.stdout + result.stderr;
        // Should fail or warn — not silently proceed
        assert.match(combined, /agentxchain\.json|Warning|issues|No agentxchain/i,
          `${args[0]} should report config validation issues`);
      }

      // No governed state files should have been created
      const stateExists = existsSync(join(dir, '.agentxchain', 'state.json'));
      assert.equal(stateExists, false, 'No state.json should be created from incomplete config');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('concurrent step invocation detection', () => {
  it('step rejects concurrent invocation when a turn is already active', () => {
    const dir = createGovernedProject();
    try {
      // state.json already has an active turn from createGovernedProject()
      const result = runCli(dir, ['step']);
      assert.equal(result.status, 1, 'step should exit non-zero when turn is already active');
      const combined = result.stdout + result.stderr;
      assert.match(combined, /already active/i, 'should report an active turn exists');
      assert.match(combined, /--resume/, 'should suggest --resume to continue waiting');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resume rejects double assignment when a turn is already active', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['resume']);
      assert.notEqual(result.status, 0, 'resume should fail when turn is already active');
      const combined = result.stdout + result.stderr;
      assert.match(combined, /already|active|assigned/i, 'should report existing active turn');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
