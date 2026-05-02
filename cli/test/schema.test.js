import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLockSchema, validateStateSchema, validateGovernedStateSchema, validateConfigSchema, safeParseJson } from '../src/lib/schema.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));

describe('validateLockSchema', () => {
  it('accepts a valid lock', () => {
    const result = validateLockSchema({
      holder: null,
      last_released_by: 'pm',
      turn_number: 3,
      claimed_at: null
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts a claimed lock', () => {
    const result = validateLockSchema({
      holder: 'dev',
      last_released_by: 'pm',
      turn_number: 4,
      claimed_at: '2026-03-17T12:00:00.000Z'
    });
    assert.equal(result.ok, true);
  });

  it('rejects missing holder field', () => {
    const result = validateLockSchema({ turn_number: 0, last_released_by: null, claimed_at: null });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('holder')));
  });

  it('rejects non-integer turn_number', () => {
    const result = validateLockSchema({ holder: null, turn_number: 1.5, last_released_by: null, claimed_at: null });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('turn_number')));
  });

  it('rejects non-object input', () => {
    const result = validateLockSchema('not an object');
    assert.equal(result.ok, false);
  });
});

describe('validateStateSchema', () => {
  it('accepts a valid state', () => {
    const result = validateStateSchema({ phase: 'build', blocked: false, blocked_on: null });
    assert.equal(result.ok, true);
  });

  it('rejects missing phase', () => {
    const result = validateStateSchema({ blocked: false });
    assert.equal(result.ok, false);
  });
});

describe('validateGovernedStateSchema', () => {
  it('accepts an idle uninitialized governed state', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: null,
      project_id: 'test-project',
      status: 'idle',
      phase: 'planning',
      accepted_integration_ref: null,
      active_turns: {},
      turn_sequence: 0,
      last_completed_turn_id: null,
      blocked_on: null,
      blocked_reason: null,
      escalation: null,
      queued_phase_transition: null,
      queued_run_completion: null,
      last_gate_failure: null,
      phase_gate_status: {
        planning_signoff: 'pending',
        implementation_complete: 'pending',
        qa_ship_verdict: 'pending',
      },
      budget_reservations: {},
      budget_status: {
        spent_usd: 0,
        remaining_usd: 50,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts governed state with persisted last_gate_failure', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: 'run_123',
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      active_turns: {},
      turn_sequence: 2,
      last_gate_failure: {
        gate_type: 'phase_transition',
        gate_id: 'planning_signoff',
        phase: 'planning',
        from_phase: 'planning',
        to_phase: 'implementation',
        requested_by_turn: 'turn_001',
        failed_at: '2026-04-11T10:00:00.000Z',
        queued_request: true,
        reasons: ['Missing file: .planning/PM_SIGNOFF.md'],
        missing_files: ['.planning/PM_SIGNOFF.md'],
        missing_verification: false,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects null run_id once the run is active', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: null,
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      active_turns: {},
      turn_sequence: 0,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('run_id')));
  });

  it('accepts a blocked governed state with blocked_reason', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: 'run_123',
      project_id: 'test-project',
      status: 'blocked',
      phase: 'qa',
      active_turns: {
        turn_123: {
          turn_id: 'turn_123',
          assigned_role: 'qa',
          status: 'failed',
          runtime_id: 'api-qa',
          attempt: 2,
          assigned_sequence: 1,
        },
      },
      turn_sequence: 1,
      blocked_on: 'dispatch:auth_failure',
      blocked_reason: {
        category: 'dispatch_error',
        blocked_at: '2026-04-01T12:00:00.000Z',
        turn_id: 'turn_123',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: 'Set ANTHROPIC_API_KEY and retry.',
        },
      },
    });
    assert.equal(result.ok, true);
  });

  it('rejects blocked governed state without blocked_reason', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: 'run_123',
      project_id: 'test-project',
      status: 'blocked',
      phase: 'qa',
      active_turns: {},
      turn_sequence: 0,
      blocked_on: 'human:need clarification',
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('blocked_reason')));
  });

  it('rejects persisted current_turn in schema_version 1.1 state', () => {
    const result = validateGovernedStateSchema({
      schema_version: '1.1',
      run_id: 'run_123',
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      current_turn: null,
      active_turns: {},
      turn_sequence: 0,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('current_turn is not allowed')));
  });
});

describe('validateConfigSchema', () => {
  it('accepts a valid config', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: {
        pm: { name: 'Product Manager', mandate: 'Manage product' },
        dev: { name: 'Developer', mandate: 'Write code' }
      }
    });
    assert.equal(result.ok, true);
  });

  it('rejects wrong version', () => {
    const result = validateConfigSchema({ version: 2, project: 'Test', agents: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('version')));
  });

  it('rejects invalid agent IDs', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: { 'Bad Agent': { name: 'Bad', mandate: 'Bad' } }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Invalid agent id')));
  });

  it('rejects agents with empty mandate', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: { pm: { name: 'PM', mandate: '' } }
    });
    assert.equal(result.ok, false);
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    const result = safeParseJson('{"a": 1}');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { a: 1 });
  });

  it('returns error for invalid JSON', () => {
    const result = safeParseJson('{bad json}');
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('Invalid JSON'));
  });

  it('runs validator on parsed data', () => {
    const result = safeParseJson('{"holder": null, "turn_number": 0, "last_released_by": null, "claimed_at": null}', validateLockSchema);
    assert.equal(result.ok, true);
  });
});

describe('turn-result.schema.json drift guard', () => {
  const schemaPath = join(__test_dirname, '..', 'src', 'lib', 'schemas', 'turn-result.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  it('contains run_completion_request in the formal schema file', () => {
    assert.ok(
      schema.properties.run_completion_request,
      'turn-result.schema.json must define run_completion_request — see DEC-TYPES-002'
    );
    assert.deepEqual(
      schema.properties.run_completion_request.type,
      ['boolean', 'null'],
      'run_completion_request must accept boolean or null'
    );
  });

  it('contains phase_transition_request in the formal schema file', () => {
    assert.ok(
      schema.properties.phase_transition_request,
      'turn-result.schema.json must define phase_transition_request'
    );
  });
});
