import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecoveryDescriptor } from '../src/lib/blocked-state.js';

function makePolicyState(overrides = {}) {
  return {
    status: 'blocked',
    blocked_on: 'policy:total-turn-cap',
    active_turns: {},
    ...overrides,
  };
}

describe('deriveRecoveryDescriptor — policy escalation fallback', () => {
  it('classifies blocked_on "policy:..." as policy_escalation, not unknown_block', () => {
    const state = makePolicyState({
      blocked_reason: 'Policy escalation: run has reached 50/50 total accepted turns',
    });
    const result = deriveRecoveryDescriptor(state);
    assert.equal(result.typed_reason, 'policy_escalation');
    assert.equal(result.owner, 'human');
    assert.equal(result.recovery_action, 'Resolve policy "total-turn-cap" condition, then run agentxchain resume');
    assert.equal(result.turn_retained, false);
    assert.equal(result.detail, 'Policy escalation: run has reached 50/50 total accepted turns');
  });

  it('uses runtime-aware resume for retained manual turns', () => {
    const state = makePolicyState({
      blocked_on: 'policy:no-role-monopoly',
      blocked_reason: 'Policy escalation: role monopoly',
      active_turns: {
        't-1': { turn_id: 't-1', assigned_role: 'dev', runtime_id: 'manual-dev', status: 'dispatched' },
      },
    });
    const config = {
      runtimes: {
        'manual-dev': { type: 'manual' },
      },
    };
    const result = deriveRecoveryDescriptor(state, config);
    assert.equal(result.typed_reason, 'policy_escalation');
    assert.equal(result.recovery_action, 'Resolve policy "no-role-monopoly" condition, then run agentxchain resume');
    assert.equal(result.turn_retained, true);
  });

  it('uses step --resume for retained non-manual turns', () => {
    const state = makePolicyState({
      blocked_on: 'policy:phase-turn-cap',
      blocked_reason: 'Policy escalation: implementation turn cap reached',
      active_turns: {
        't-2': { turn_id: 't-2', assigned_role: 'qa', runtime_id: 'api-qa', status: 'dispatched' },
      },
    });
    const config = {
      runtimes: {
        'api-qa': { type: 'api_proxy' },
      },
    };
    const result = deriveRecoveryDescriptor(state, config);
    assert.equal(result.typed_reason, 'policy_escalation');
    assert.equal(result.recovery_action, 'Resolve policy "phase-turn-cap" condition, then run agentxchain step --resume');
    assert.equal(result.turn_retained, true);
  });
});

describe('deriveRecoveryDescriptor — policy escalation persisted recovery', () => {
  it('passes through persisted recovery when it already matches runtime truth', () => {
    const state = makePolicyState({
      blocked_reason: {
        category: 'policy_escalation',
        recovery: {
          typed_reason: 'policy_escalation',
          owner: 'human',
          recovery_action: 'Resolve policy "total-turn-cap" condition, then run agentxchain resume',
          turn_retained: false,
          detail: 'run has reached 50/50 total accepted turns',
        },
        turn_id: 't-5',
        blocked_at: '2026-04-10T00:00:00Z',
      },
    });
    const result = deriveRecoveryDescriptor(state);
    assert.equal(result.typed_reason, 'policy_escalation');
    assert.equal(result.recovery_action, 'Resolve policy "total-turn-cap" condition, then run agentxchain resume');
    assert.equal(result.detail, 'run has reached 50/50 total accepted turns');
  });

  it('refreshes legacy retained-manual recovery actions to use resume', () => {
    const state = makePolicyState({
      blocked_on: 'policy:no-role-monopoly',
      blocked_reason: {
        category: 'policy_escalation',
        recovery: {
          typed_reason: 'policy_escalation',
          owner: 'human',
          recovery_action: 'Resolve policy "no-role-monopoly" condition, then run agentxchain step --resume',
          turn_retained: true,
          detail: 'role monopoly detected',
        },
        turn_id: 't-9',
        blocked_at: '2026-04-10T00:00:00Z',
      },
      active_turns: {
        't-9': { turn_id: 't-9', assigned_role: 'dev', runtime_id: 'manual-dev', status: 'dispatched' },
      },
    });
    const config = {
      runtimes: {
        'manual-dev': { type: 'manual' },
      },
    };
    const result = deriveRecoveryDescriptor(state, config);
    assert.equal(result.recovery_action, 'Resolve policy "no-role-monopoly" condition, then run agentxchain resume');
    assert.equal(result.detail, 'role monopoly detected');
  });
});

describe('deriveRecoveryDescriptor — policy edge cases', () => {
  it('handles bare "policy:" prefix with empty id', () => {
    const state = makePolicyState({
      blocked_on: 'policy:',
      blocked_reason: null,
    });
    const result = deriveRecoveryDescriptor(state);
    assert.equal(result.typed_reason, 'policy_escalation');
    assert.equal(result.recovery_action, 'Resolve the policy condition, then run agentxchain resume');
    assert.equal(result.detail, 'policy:');
  });

  it('does not classify non-policy blocked_on as policy_escalation', () => {
    const state = makePolicyState({
      blocked_on: 'escalation:operator:something',
    });
    const result = deriveRecoveryDescriptor(state);
    assert.notEqual(result.typed_reason, 'policy_escalation');
  });
});
