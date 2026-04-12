import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePolicies,
  validatePolicies,
  validatePolicy,
  normalizePolicies,
  VALID_POLICY_RULES,
  VALID_POLICY_ACTIONS,
  VALID_POLICY_TURN_STATUSES,
} from '../src/lib/policy-evaluator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides = {}) {
  return {
    currentPhase: 'implementation',
    turnRole: 'dev',
    turnStatus: 'completed',
    turnCostUsd: null,
    history: [],
    ...overrides,
  };
}

function makeHistory(entries) {
  return entries.map((e, i) => ({
    turn_id: `t-${i}`,
    role: e.role || 'dev',
    phase: e.phase || 'implementation',
    status: e.status || 'completed',
    ...e,
  }));
}

// ── Module shape ─────────────────────────────────────────────────────────────

describe('policy-evaluator module', () => {
  it('exports VALID_POLICY_RULES', () => {
    assert.ok(Array.isArray(VALID_POLICY_RULES));
    assert.ok(VALID_POLICY_RULES.includes('max_turns_per_phase'));
    assert.ok(VALID_POLICY_RULES.includes('max_total_turns'));
    assert.ok(VALID_POLICY_RULES.includes('max_consecutive_same_role'));
    assert.ok(VALID_POLICY_RULES.includes('max_cost_per_turn'));
    assert.ok(VALID_POLICY_RULES.includes('require_status'));
    assert.ok(VALID_POLICY_RULES.includes('require_reproducible_verification'));
  });

  it('exports VALID_POLICY_ACTIONS', () => {
    assert.deepStrictEqual(VALID_POLICY_ACTIONS, ['block', 'warn', 'escalate']);
  });

  it('exports VALID_POLICY_TURN_STATUSES', () => {
    assert.deepStrictEqual(VALID_POLICY_TURN_STATUSES, [
      'completed',
      'blocked',
      'needs_human',
      'failed',
    ]);
  });
});

// ── normalizePolicies ────────────────────────────────────────────────────────

describe('normalizePolicies', () => {
  it('returns empty array for null', () => {
    assert.deepStrictEqual(normalizePolicies(null), []);
  });

  it('returns empty array for undefined', () => {
    assert.deepStrictEqual(normalizePolicies(undefined), []);
  });

  it('returns empty array for non-array', () => {
    assert.deepStrictEqual(normalizePolicies('bad'), []);
  });

  it('passes through valid array', () => {
    const policies = [{ id: 'test', rule: 'max_total_turns', params: { limit: 5 }, action: 'block' }];
    assert.deepStrictEqual(normalizePolicies(policies), policies);
  });
});

// ── validatePolicies ─────────────────────────────────────────────────────────

describe('validatePolicies', () => {
  it('AT-POL-014: empty array is valid', () => {
    const result = validatePolicies([]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('AT-POL-015: null/undefined is valid (no-op)', () => {
    assert.strictEqual(validatePolicies(null).ok, true);
    assert.strictEqual(validatePolicies(undefined).ok, true);
  });

  it('rejects non-array', () => {
    const result = validatePolicies('bad');
    assert.strictEqual(result.ok, false);
  });

  it('AT-POL-013: rejects unknown rule', () => {
    const result = validatePolicies([{
      id: 'bad-rule',
      rule: 'nonexistent_rule',
      params: {},
      action: 'block',
    }]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('unknown rule')));
  });

  it('rejects invalid action', () => {
    const result = validatePolicies([{
      id: 'test',
      rule: 'max_total_turns',
      params: { limit: 5 },
      action: 'destroy',
    }]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('action must be')));
  });

  it('rejects duplicate ids', () => {
    const result = validatePolicies([
      { id: 'same', rule: 'max_total_turns', params: { limit: 5 }, action: 'block' },
      { id: 'same', rule: 'max_total_turns', params: { limit: 10 }, action: 'warn' },
    ]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('duplicate id')));
  });

  it('rejects missing params.limit for max_turns_per_phase', () => {
    const result = validatePolicies([{
      id: 'test',
      rule: 'max_turns_per_phase',
      params: {},
      action: 'block',
    }]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('params.limit')));
  });

  it('rejects zero limit', () => {
    const result = validatePolicies([{
      id: 'test',
      rule: 'max_turns_per_phase',
      params: { limit: 0 },
      action: 'block',
    }]);
    assert.strictEqual(result.ok, false);
  });

  it('rejects invalid require_status values', () => {
    const result = validatePolicies([{
      id: 'status-filter',
      rule: 'require_status',
      params: { allowed: ['completed', 'invented_status'] },
      action: 'block',
    }]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('invalid status "invented_status"')));
  });

  it('accepts a valid policy set', () => {
    const result = validatePolicies([
      { id: 'phase-cap', rule: 'max_turns_per_phase', params: { limit: 10 }, action: 'block' },
      { id: 'total-cap', rule: 'max_total_turns', params: { limit: 50 }, action: 'escalate' },
      { id: 'cost-guard', rule: 'max_cost_per_turn', params: { limit_usd: 5.00 }, action: 'warn' },
      { id: 'no-monopoly', rule: 'max_consecutive_same_role', params: { limit: 3 }, action: 'block' },
      { id: 'status-filter', rule: 'require_status', params: { allowed: ['completed'] }, action: 'block' },
      { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' },
    ]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('AT-RVP-001: accepts require_reproducible_verification as a valid built-in rule', () => {
    const result = validatePolicies([
      { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });
});

// ── evaluatePolicies — max_turns_per_phase ───────────────────────────────────

describe('evaluatePolicies — max_turns_per_phase', () => {
  const policy = { id: 'phase-cap', rule: 'max_turns_per_phase', params: { limit: 3 }, action: 'block' };

  it('AT-POL-002: passes when count < limit', () => {
    const ctx = makeContext({
      history: makeHistory([
        { phase: 'implementation' },
        { phase: 'implementation' },
      ]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it('AT-POL-001: blocks when count >= limit', () => {
    const ctx = makeContext({
      history: makeHistory([
        { phase: 'implementation' },
        { phase: 'implementation' },
        { phase: 'implementation' },
      ]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.blocks.length, 1);
    assert.ok(result.blocks[0].message.includes('3/3'));
  });

  it('does not count turns in other phases', () => {
    const ctx = makeContext({
      currentPhase: 'qa',
      history: makeHistory([
        { phase: 'implementation' },
        { phase: 'implementation' },
        { phase: 'implementation' },
        { phase: 'qa' },
      ]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });
});

// ── evaluatePolicies — max_total_turns ───────────────────────────────────────

describe('evaluatePolicies — max_total_turns', () => {
  const policy = { id: 'total-cap', rule: 'max_total_turns', params: { limit: 5 }, action: 'block' };

  it('AT-POL-003: blocks when total >= limit', () => {
    const ctx = makeContext({
      history: makeHistory([{}, {}, {}, {}, {}]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.blocks.length, 1);
    assert.ok(result.blocks[0].message.includes('5/5'));
  });

  it('passes when total < limit', () => {
    const ctx = makeContext({
      history: makeHistory([{}, {}, {}]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });
});

// ── evaluatePolicies — max_consecutive_same_role ─────────────────────────────

describe('evaluatePolicies — max_consecutive_same_role', () => {
  const policy = { id: 'no-monopoly', rule: 'max_consecutive_same_role', params: { limit: 2 }, action: 'block' };

  it('AT-POL-004: blocks when consecutive >= limit (including current turn)', () => {
    const ctx = makeContext({
      turnRole: 'dev',
      history: makeHistory([
        { role: 'pm' },
        { role: 'dev' },
        { role: 'dev' },
      ]),
    });
    // Two in history + 1 current = 3, limit is 2
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.blocks.length, 1);
  });

  it('AT-POL-005: passes when a different role intervened', () => {
    const ctx = makeContext({
      turnRole: 'dev',
      history: makeHistory([
        { role: 'dev' },
        { role: 'qa' },
        { role: 'dev' },
      ]),
    });
    // Only 1 consecutive (last entry) + 1 current = 2, limit is 2 → passes
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });
});

// ── evaluatePolicies — max_cost_per_turn ─────────────────────────────────────

describe('evaluatePolicies — max_cost_per_turn', () => {
  const policy = { id: 'cost-guard', rule: 'max_cost_per_turn', params: { limit_usd: 5.00 }, action: 'warn' };

  it('AT-POL-006: warns when cost exceeds limit', () => {
    const ctx = makeContext({ turnCostUsd: 7.50 });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true); // warn does not block
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].message.includes('$7.50'));
  });

  it('AT-POL-007: passes when cost is under limit', () => {
    const ctx = makeContext({ turnCostUsd: 3.20 });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('AT-POL-007: passes when cost is absent', () => {
    const ctx = makeContext({ turnCostUsd: null });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.warnings.length, 0);
  });
});

// ── evaluatePolicies — require_status ────────────────────────────────────────

describe('evaluatePolicies — require_status', () => {
  const policy = { id: 'status-filter', rule: 'require_status', params: { allowed: ['completed'] }, action: 'block' };

  it('AT-POL-008: blocks disallowed statuses', () => {
    const ctx = makeContext({ turnStatus: 'failed' });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.blocks.length, 1);
    assert.ok(result.blocks[0].message.includes('failed'));
  });

  it('passes allowed statuses', () => {
    const ctx = makeContext({ turnStatus: 'completed' });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });
});

describe('evaluatePolicies — require_reproducible_verification', () => {
  const policy = { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' };

  it('AT-RVP-002: triggers when verification replay is not reproducible', () => {
    const result = evaluatePolicies([policy], makeContext({
      verificationReplay: {
        overall: 'not_reproducible',
        reason: 'No verification.machine_evidence commands were declared.',
        replayed_commands: 0,
        matched_commands: 0,
      },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blocks.length, 1);
    assert.match(result.blocks[0].message, /machine_evidence/i);
  });

  it('AT-RVP-003: triggers when verification replay mismatches declared exit codes', () => {
    const result = evaluatePolicies([policy], makeContext({
      verificationReplay: {
        overall: 'mismatch',
        replayed_commands: 2,
        matched_commands: 1,
      },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blocks.length, 1);
    assert.match(result.blocks[0].message, /1\/2 commands matched/i);
  });

  it('passes when verification replay matches', () => {
    const result = evaluatePolicies([policy], makeContext({
      verificationReplay: {
        overall: 'match',
        replayed_commands: 1,
        matched_commands: 1,
      },
    }));
    assert.equal(result.ok, true);
    assert.equal(result.violations.length, 0);
  });
});

// ── evaluatePolicies — actions ───────────────────────────────────────────────

describe('evaluatePolicies — actions', () => {
  it('AT-POL-009: escalate returns an escalation instead of a block', () => {
    const policy = { id: 'esc', rule: 'max_total_turns', params: { limit: 1 }, action: 'escalate' };
    const ctx = makeContext({ history: makeHistory([{}]) });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.escalations.length, 1);
    assert.strictEqual(result.blocks.length, 0);
  });

  it('AT-POL-010: warn accepts with warnings', () => {
    const policy = { id: 'w', rule: 'max_total_turns', params: { limit: 1 }, action: 'warn' };
    const ctx = makeContext({ history: makeHistory([{}]) });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.warnings.length, 1);
  });
});

// ── evaluatePolicies — scoping ───────────────────────────────────────────────

describe('evaluatePolicies — scoping', () => {
  it('AT-POL-011: skips when phase is out of scope', () => {
    const policy = {
      id: 'qa-only',
      rule: 'max_turns_per_phase',
      params: { limit: 1 },
      action: 'block',
      scope: { phases: ['qa'] },
    };
    const ctx = makeContext({
      currentPhase: 'implementation',
      history: makeHistory([{ phase: 'implementation' }, { phase: 'implementation' }]),
    });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });

  it('AT-POL-011: skips when role is out of scope', () => {
    const policy = {
      id: 'dev-only',
      rule: 'max_total_turns',
      params: { limit: 1 },
      action: 'block',
      scope: { roles: ['qa'] },
    };
    const ctx = makeContext({ turnRole: 'dev', history: makeHistory([{}]) });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, true);
  });

  it('applies when phase and role are in scope', () => {
    const policy = {
      id: 'scoped',
      rule: 'max_total_turns',
      params: { limit: 1 },
      action: 'block',
      scope: { phases: ['implementation'], roles: ['dev'] },
    };
    const ctx = makeContext({ history: makeHistory([{}]) });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.ok, false);
  });
});

// ── evaluatePolicies — multiple violations ───────────────────────────────────

describe('evaluatePolicies — multiple violations', () => {
  it('AT-POL-012: collects all violations (no short-circuit)', () => {
    const policies = [
      { id: 'p1', rule: 'max_total_turns', params: { limit: 1 }, action: 'block' },
      { id: 'p2', rule: 'max_turns_per_phase', params: { limit: 1 }, action: 'warn' },
      { id: 'p3', rule: 'require_status', params: { allowed: ['blocked'] }, action: 'block' },
    ];
    const ctx = makeContext({
      turnStatus: 'completed',
      history: makeHistory([{ phase: 'implementation' }]),
    });
    const result = evaluatePolicies(policies, ctx);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.violations.length, 3);
    assert.strictEqual(result.blocks.length, 2);
    assert.strictEqual(result.warnings.length, 1);
  });
});

// ── evaluatePolicies — empty / no policies ───────────────────────────────────

describe('evaluatePolicies — no policies', () => {
  it('returns ok with no policies', () => {
    const result = evaluatePolicies([], makeContext());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it('returns ok with null', () => {
    const result = evaluatePolicies(null, makeContext());
    assert.strictEqual(result.ok, true);
  });
});

// ── Custom messages ──────────────────────────────────────────────────────────

describe('evaluatePolicies — custom messages', () => {
  it('uses custom message when provided', () => {
    const policy = {
      id: 'custom',
      rule: 'max_total_turns',
      params: { limit: 1 },
      action: 'block',
      message: 'Too many turns — stop!',
    };
    const ctx = makeContext({ history: makeHistory([{}]) });
    const result = evaluatePolicies([policy], ctx);
    assert.strictEqual(result.blocks[0].message, 'Too many turns — stop!');
  });
});
