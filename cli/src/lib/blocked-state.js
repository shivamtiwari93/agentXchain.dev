export function deriveRecoveryDescriptor(state) {
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

  if (typeof state.blocked_on !== 'string' || !state.blocked_on.trim()) {
    return null;
  }

  if (state.blocked_on.startsWith('human:')) {
    return {
      typed_reason: 'needs_human',
      owner: 'human',
      recovery_action: 'Resolve the stated issue, then run agentxchain step --resume',
      turn_retained: Boolean(state.current_turn),
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
    return {
      typed_reason: 'retries_exhausted',
      owner: 'human',
      recovery_action: 'Resolve the escalation, then run agentxchain step',
      turn_retained: Boolean(state.current_turn),
      detail: state.blocked_on,
    };
  }

  return {
    typed_reason: 'unknown_block',
    owner: 'human',
    recovery_action: 'Inspect state.json and resolve manually before rerunning agentxchain step',
    turn_retained: Boolean(state.current_turn),
    detail: state.blocked_on,
  };
}
