import {
  deriveConflictLoopRecoveryAction,
  deriveDispatchRecoveryAction,
  deriveEscalationRecoveryAction,
  deriveHookTamperRecoveryAction,
  deriveNeedsHumanRecoveryAction,
  getActiveTurnCount,
} from './governed-state.js';

function isLegacyEscalationRecoveryAction(action) {
  return action === 'Resolve the escalation, then run agentxchain step --resume'
    || action === 'Resolve the escalation, then run agentxchain step';
}

function isLegacyNeedsHumanRecoveryAction(action) {
  return action === 'Resolve the stated issue, then run agentxchain step --resume';
}

function isLegacyHookTamperRecoveryAction(action) {
  return action === 'Disable or fix the hook, verify protected files, then run agentxchain step --resume';
}

function isLegacyConflictLoopRecoveryAction(action) {
  return typeof action === 'string' && action.startsWith('Serialize the conflicting work, then run agentxchain step --resume');
}

function maybeRefreshRecoveryAction(state, config, persistedRecovery, turnRetained) {
  if (!config || !persistedRecovery || typeof persistedRecovery !== 'object') {
    return null;
  }

  const typedReason = persistedRecovery.typed_reason;
  const currentAction = persistedRecovery.recovery_action || null;
  const turnId = state?.blocked_reason?.turn_id ?? state?.escalation?.from_turn_id ?? null;
  if (typedReason === 'retries_exhausted' || ((typedReason === 'operator_escalation') && isLegacyEscalationRecoveryAction(currentAction))) {
    return deriveEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'needs_human' && isLegacyNeedsHumanRecoveryAction(currentAction)) {
    return deriveNeedsHumanRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'hook_tamper' && isLegacyHookTamperRecoveryAction(currentAction)) {
    return deriveHookTamperRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'conflict_loop' && isLegacyConflictLoopRecoveryAction(currentAction)) {
    return deriveConflictLoopRecoveryAction(turnId);
  }

  return null;
}

export function deriveRecoveryDescriptor(state, config = null) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  if (state.pending_run_completion) {
    return {
      typed_reason: 'pending_run_completion',
      owner: 'human',
      recovery_action: 'agentxchain approve-completion',
      turn_retained: false,
      detail: state.pending_run_completion.gate || null,
    };
  }

  if (state.pending_phase_transition) {
    return {
      typed_reason: 'pending_phase_transition',
      owner: 'human',
      recovery_action: 'agentxchain approve-transition',
      turn_retained: false,
      detail: state.pending_phase_transition.gate || null,
    };
  }

  const turnRetained = getActiveTurnCount(state) > 0;

  const persistedRecovery = state.blocked_reason?.recovery;
  if (persistedRecovery && typeof persistedRecovery === 'object') {
    const refreshedRecoveryAction = maybeRefreshRecoveryAction(state, config, persistedRecovery, turnRetained);
    return {
      typed_reason: persistedRecovery.typed_reason || 'unknown_block',
      owner: persistedRecovery.owner || 'human',
      recovery_action: refreshedRecoveryAction
        || persistedRecovery.recovery_action
        || 'Inspect state.json and resolve manually before rerunning agentxchain step',
      turn_retained: typeof persistedRecovery.turn_retained === 'boolean'
        ? persistedRecovery.turn_retained
        : turnRetained,
      detail: persistedRecovery.detail ?? state.blocked_on ?? null,
    };
  }

  if (typeof state.blocked_on !== 'string' || !state.blocked_on.trim()) {
    return null;
  }

  if (state.blocked_on.startsWith('human:')) {
    return {
      typed_reason: 'needs_human',
      owner: 'human',
      recovery_action: deriveNeedsHumanRecoveryAction(state, config, {
        turnRetained,
        turnId: state.blocked_reason?.turn_id ?? null,
      }),
      turn_retained: turnRetained,
      detail: state.blocked_on.slice('human:'.length) || null,
    };
  }

  if (state.blocked_on.startsWith('human_approval:')) {
    return {
      typed_reason: 'pending_phase_transition',
      owner: 'human',
      recovery_action: 'agentxchain approve-transition',
      turn_retained: false,
      detail: state.blocked_on.slice('human_approval:'.length) || null,
    };
  }

  if (state.blocked_on.startsWith('escalation:')) {
    const isOperatorEscalation = state.blocked_on.startsWith('escalation:operator:') || state.escalation?.source === 'operator';
    const recoveryAction = deriveEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId: state.blocked_reason?.turn_id ?? state.escalation?.from_turn_id ?? null,
    });
    return {
      typed_reason: isOperatorEscalation ? 'operator_escalation' : 'retries_exhausted',
      owner: 'human',
      recovery_action: recoveryAction,
      turn_retained: turnRetained,
      detail: state.escalation?.detail || state.escalation?.reason || state.blocked_on,
    };
  }

  if (state.blocked_on.startsWith('dispatch:')) {
    return {
      typed_reason: 'dispatch_error',
      owner: 'human',
      recovery_action: deriveDispatchRecoveryAction(state, config, {
        turnRetained,
        turnId: state.blocked_reason?.turn_id ?? null,
      }),
      turn_retained: turnRetained,
      detail: state.blocked_on.slice('dispatch:'.length) || state.blocked_on,
    };
  }

  return {
    typed_reason: 'unknown_block',
    owner: 'human',
    recovery_action: 'Inspect state.json and resolve manually before rerunning agentxchain step',
    turn_retained: turnRetained,
    detail: state.blocked_on,
  };
}
