import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { evaluateApprovalPolicy } from '../src/lib/approval-policy.js';
import { validateApprovalPolicy } from '../src/lib/normalized-config.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeGateResult(overrides = {}) {
  return {
    gate_id: 'planning_exit',
    passed: true,
    blocked_by_human_approval: true,
    reasons: [],
    missing_files: [],
    missing_verification: false,
    next_phase: 'implementation',
    transition_request: 'implementation',
    action: 'awaiting_human_approval',
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    phase: 'planning',
    status: 'active',
    run_id: 'run_test123',
    history: [],
    ...overrides,
  };
}

function makeConfig(approvalPolicy, routingOverride) {
  return {
    routing: routingOverride || {
      planning: { exit_gate: 'planning_exit' },
      implementation: { exit_gate: 'impl_exit' },
      qa: { exit_gate: 'qa_exit' },
      release: {},
    },
    gates: {
      planning_exit: { requires_human_approval: true },
      impl_exit: { requires_human_approval: true },
      qa_exit: { requires_human_approval: true },
    },
    approval_policy: approvalPolicy,
  };
}

// ── AT-AP-001: No policy → always require_human ─────────────────────────────

describe('AT-AP-001: no approval_policy', () => {
  it('returns require_human when no policy is configured', () => {
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfig(null),
    });
    assert.equal(result.action, 'require_human');
    assert.equal(result.matched_rule, null);
  });

  it('returns require_human for run_completion when no policy', () => {
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ action: 'awaiting_human_approval', gate_id: 'completion_gate' }),
      gateType: 'run_completion',
      state: makeState({ phase: 'release' }),
      config: makeConfig(null),
    });
    assert.equal(result.action, 'require_human');
  });
});

// ── AT-AP-002: default auto_approve with gate_passed ────────────────────────

describe('AT-AP-002: default auto_approve', () => {
  it('auto-approves phase transition when gate passed and default is auto_approve', () => {
    const policy = {
      phase_transitions: {
        default: 'auto_approve',
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');
  });
});

// ── AT-AP-003: rule matching specific from/to phases ────────────────────────

describe('AT-AP-003: specific phase rule', () => {
  it('auto-approves only the matching transition', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [
          { from_phase: 'planning', to_phase: 'implementation', action: 'auto_approve' },
        ],
      },
    };

    // Matching transition
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ next_phase: 'implementation' }),
      gateType: 'phase_transition',
      state: makeState({ phase: 'planning' }),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');

    // Non-matching transition falls to default
    const result2 = evaluateApprovalPolicy({
      gateResult: makeGateResult({ next_phase: 'release', gate_id: 'qa_exit' }),
      gateType: 'phase_transition',
      state: makeState({ phase: 'qa' }),
      config: makeConfig(policy),
    });
    assert.equal(result2.action, 'require_human');
  });
});

// ── AT-AP-004: explicit require_human rule ──────────────────────────────────

describe('AT-AP-004: explicit require_human rule overrides default', () => {
  it('requires human for qa→release even with auto_approve default', () => {
    const policy = {
      phase_transitions: {
        default: 'auto_approve',
        rules: [
          { from_phase: 'qa', to_phase: 'release', action: 'require_human' },
        ],
      },
    };

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ next_phase: 'release', gate_id: 'qa_exit' }),
      gateType: 'phase_transition',
      state: makeState({ phase: 'qa' }),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'require_human');
  });
});

// ── AT-AP-005: roles_participated condition ─────────────────────────────────

describe('AT-AP-005: when.roles_participated', () => {
  it('auto-approves when required role has participated', () => {
    const policy = {
      phase_transitions: {
        rules: [
          {
            from_phase: 'qa',
            action: 'auto_approve',
            when: { roles_participated: ['qa_engineer'] },
          },
        ],
      },
    };

    const state = makeState({
      phase: 'qa',
      history: [
        { phase: 'qa', role: 'qa_engineer', turn_id: 't1' },
      ],
    });

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ next_phase: 'release', gate_id: 'qa_exit' }),
      gateType: 'phase_transition',
      state,
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');
  });

  it('requires human when required role has NOT participated', () => {
    const policy = {
      phase_transitions: {
        rules: [
          {
            from_phase: 'qa',
            action: 'auto_approve',
            when: { roles_participated: ['qa_engineer'] },
          },
        ],
      },
    };

    const state = makeState({
      phase: 'qa',
      history: [
        { phase: 'qa', role: 'dev', turn_id: 't1' },
      ],
    });

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ next_phase: 'release', gate_id: 'qa_exit' }),
      gateType: 'phase_transition',
      state,
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.ok(result.reason.includes('roles_participated'));
  });
});

// ── AT-AP-007: run_completion auto-approve ──────────────────────────────────

describe('AT-AP-007: run_completion auto-approve', () => {
  it('auto-approves run completion when all phases visited and gate passed', () => {
    const policy = {
      run_completion: {
        action: 'auto_approve',
        when: { gate_passed: true, all_phases_visited: true },
      },
    };

    const state = makeState({
      phase: 'release',
      history: [
        { phase: 'planning', role: 'pm', turn_id: 't1' },
        { phase: 'implementation', role: 'dev', turn_id: 't2' },
        { phase: 'qa', role: 'qa', turn_id: 't3' },
        { phase: 'release', role: 'dev', turn_id: 't4' },
      ],
    });

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ passed: true, gate_id: 'completion_gate' }),
      gateType: 'run_completion',
      state,
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');
  });

  it('requires human when not all phases visited', () => {
    const policy = {
      run_completion: {
        action: 'auto_approve',
        when: { gate_passed: true, all_phases_visited: true },
      },
    };

    const state = makeState({
      phase: 'release',
      history: [
        { phase: 'planning', role: 'pm', turn_id: 't1' },
        // implementation never visited
        { phase: 'qa', role: 'qa', turn_id: 't3' },
        { phase: 'release', role: 'dev', turn_id: 't4' },
      ],
    });

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ passed: true, gate_id: 'completion_gate' }),
      gateType: 'run_completion',
      state,
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.ok(result.reason.includes('all_phases_visited'));
  });
});

// ── AT-AP-009: config validation rejects invalid action ─────────────────────

describe('AT-AP-009: config validation', () => {
  it('rejects unknown action', () => {
    const errors = validateApprovalPolicy({
      phase_transitions: {
        rules: [{ action: 'skip' }],
      },
    }, {});
    assert.ok(errors.some(e => e.includes('action must be one of')));
  });

  it('rejects non-existent from_phase', () => {
    const routing = { planning: {}, implementation: {} };
    const errors = validateApprovalPolicy({
      phase_transitions: {
        rules: [{ from_phase: 'nonexistent', action: 'auto_approve' }],
      },
    }, routing);
    assert.ok(errors.some(e => e.includes('does not exist in routing')));
  });

  it('accepts valid config', () => {
    const routing = { planning: {}, implementation: {} };
    const errors = validateApprovalPolicy({
      phase_transitions: {
        default: 'auto_approve',
        rules: [
          { from_phase: 'planning', to_phase: 'implementation', action: 'auto_approve', when: { gate_passed: true } },
        ],
      },
      run_completion: {
        action: 'require_human',
      },
    }, routing);
    assert.equal(errors.length, 0);
  });

  it('rejects non-boolean gate_passed', () => {
    const errors = validateApprovalPolicy({
      phase_transitions: {
        rules: [{ action: 'auto_approve', when: { gate_passed: 'yes' } }],
      },
    }, {});
    assert.ok(errors.some(e => e.includes('gate_passed must be a boolean')));
  });
});

// ── AT-AP-011: gate failure → policy never evaluated ────────────────────────

describe('AT-AP-011: gate failure bypasses policy', () => {
  it('policy is not consulted when gate did not pass', () => {
    // The gate evaluator would return 'gate_failed', not 'awaiting_human_approval'.
    // This test verifies the evaluateApprovalPolicy function itself is only called
    // when action is awaiting_human_approval — and if called with a failed gate,
    // the gate_passed condition prevents auto-approval.
    const policy = {
      phase_transitions: {
        default: 'auto_approve',
        rules: [
          { action: 'auto_approve', when: { gate_passed: true } },
        ],
      },
    };

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ passed: false }),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.ok(result.reason.includes('gate_passed'));
  });
});

// ── AT-AP-012: first matching rule wins ─────────────────────────────────────

describe('AT-AP-012: first match wins', () => {
  it('uses the first matching rule, not the last', () => {
    const policy = {
      phase_transitions: {
        rules: [
          { from_phase: 'planning', action: 'auto_approve' },
          { from_phase: 'planning', action: 'require_human' },
        ],
      },
    };

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState({ phase: 'planning' }),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');
  });
});

// ── AT-AP-008: policy decision is auditable ─────────────────────────────────

describe('AT-AP-008: auditable policy decisions', () => {
  it('returns matched_rule for auditability', () => {
    const rule = { from_phase: 'planning', action: 'auto_approve' };
    const policy = { phase_transitions: { rules: [rule] } };

    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState({ phase: 'planning' }),
      config: makeConfig(policy),
    });
    assert.equal(result.action, 'auto_approve');
    assert.deepEqual(result.matched_rule, rule);
    assert.ok(result.reason.length > 0);
  });
});

// ── AT-AP-013: credentialed gate hard stop (BUG-59) ─────────────────────────

describe('AT-AP-013: credentialed gate hard stop', () => {
  function makeCredentialedConfig(approvalPolicy) {
    return {
      routing: {
        planning: { exit_gate: 'planning_exit' },
        implementation: { exit_gate: 'impl_exit' },
        qa: { exit_gate: 'qa_ship_verdict' },
        release: {},
      },
      gates: {
        planning_exit: { requires_human_approval: true },
        impl_exit: { requires_human_approval: true },
        qa_ship_verdict: { requires_human_approval: true, credentialed: true },
      },
      approval_policy: approvalPolicy,
    };
  }

  it('hard-stops a credentialed gate under catch-all default: auto_approve', () => {
    const policy = { phase_transitions: { default: 'auto_approve' } };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ gate_id: 'qa_ship_verdict', next_phase: 'release' }),
      gateType: 'phase_transition',
      state: makeState({ phase: 'qa' }),
      config: makeCredentialedConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.equal(result.matched_rule, null);
    assert.match(result.reason, /credentialed/);
  });

  it('hard-stops a credentialed gate even with a matching auto_approve rule', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [{ from_phase: 'qa', to_phase: 'release', action: 'auto_approve' }],
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ gate_id: 'qa_ship_verdict', next_phase: 'release' }),
      gateType: 'phase_transition',
      state: makeState({ phase: 'qa' }),
      config: makeCredentialedConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.equal(result.matched_rule, null);
    assert.match(result.reason, /credentialed/);
  });

  it('hard-stops a credentialed gate under run_completion.action: auto_approve', () => {
    const policy = {
      run_completion: { action: 'auto_approve' },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult({ gate_id: 'qa_ship_verdict', next_phase: null }),
      gateType: 'run_completion',
      state: makeState({ phase: 'qa' }),
      config: makeCredentialedConfig(policy),
    });
    assert.equal(result.action, 'require_human');
    assert.equal(result.matched_rule, null);
    assert.match(result.reason, /credentialed/);
  });
});

// ── AT-AP-014: when.credentialed_gate predicate (BUG-59) ────────────────────

describe('AT-AP-014: when.credentialed_gate predicate', () => {
  function makeConfigWithGateFlag(approvalPolicy, credentialed) {
    return {
      routing: {
        planning: { exit_gate: 'planning_exit' },
        implementation: { exit_gate: 'impl_exit' },
        qa: { exit_gate: 'qa_exit' },
        release: {},
      },
      gates: {
        planning_exit: credentialed === undefined
          ? { requires_human_approval: true }
          : { requires_human_approval: true, credentialed },
        impl_exit: { requires_human_approval: true },
        qa_exit: { requires_human_approval: true },
      },
      approval_policy: approvalPolicy,
    };
  }

  it('auto-approves when gate is not credentialed and when.credentialed_gate: false', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [
          {
            from_phase: 'planning',
            to_phase: 'implementation',
            action: 'auto_approve',
            when: { gate_passed: true, credentialed_gate: false },
          },
        ],
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfigWithGateFlag(policy, false),
    });
    assert.equal(result.action, 'auto_approve');
  });

  it('hard-stop fires before predicate when gate is credentialed', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [
          {
            from_phase: 'planning',
            to_phase: 'implementation',
            action: 'auto_approve',
            when: { credentialed_gate: false },
          },
        ],
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfigWithGateFlag(policy, true),
    });
    assert.equal(result.action, 'require_human');
    // Must be the hard-stop reason, not the predicate's condition-unmet reason
    assert.match(result.reason, /credentialed gate — policy auto-approval forbidden/);
  });

  it('treats missing credentialed field as non-credentialed', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [
          {
            from_phase: 'planning',
            to_phase: 'implementation',
            action: 'auto_approve',
            when: { credentialed_gate: false },
          },
        ],
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfigWithGateFlag(policy, undefined),
    });
    assert.equal(result.action, 'auto_approve');
  });

  it('rejects credentialed_gate: true at runtime even for non-credentialed gates', () => {
    const policy = {
      phase_transitions: {
        default: 'require_human',
        rules: [
          {
            from_phase: 'planning',
            to_phase: 'implementation',
            action: 'auto_approve',
            when: { credentialed_gate: true },
          },
        ],
      },
    };
    const result = evaluateApprovalPolicy({
      gateResult: makeGateResult(),
      gateType: 'phase_transition',
      state: makeState(),
      config: makeConfigWithGateFlag(policy, false),
    });
    assert.equal(result.action, 'require_human');
    assert.match(result.reason, /credentialed_gate: true not supported/);
  });
});
