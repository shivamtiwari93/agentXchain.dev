import { deriveCoordinatorNextActions } from './coordinator-next-actions.js';
import { collectCoordinatorRepoSnapshots } from './coordinator-repo-snapshots.js';

export function deriveCoordinatorGateNextActions(state, config) {
  return deriveCoordinatorNextActions({
    status: state?.status ?? null,
    blockedReason: state?.blocked_reason ?? null,
    pendingGate: state?.pending_gate ?? null,
    repos: config ? collectCoordinatorRepoSnapshots(config) : [],
    coordinatorRepoRuns: state?.repo_runs || {},
  });
}

function deriveTypedReason(code) {
  if (code === 'hook_blocked') {
    return 'hook_block';
  }
  if (code === 'hook_failed') {
    return 'hook_failure';
  }
  return 'approval_failed';
}

function deriveRecoveryDetail(code, gate, hookName) {
  const gateLabel = gate ? `pending gate "${gate}"` : 'pending coordinator gate';
  if (code === 'hook_blocked') {
    return `Coordinator state is unchanged. Fix or reconfigure hook "${hookName || 'before_gate'}", then rerun approval for ${gateLabel}.`;
  }
  if (code === 'hook_failed') {
    return `Coordinator state is unchanged. Fix hook "${hookName || 'before_gate'}" or its execution failure, then rerun approval for ${gateLabel}.`;
  }
  return `Coordinator state is unchanged. Resolve the approval failure, then follow the next coordinator action for ${gateLabel}.`;
}

export function normalizeCoordinatorGateApprovalFailure({
  state,
  config,
  code,
  error,
  hookName = null,
  hookPhase = null,
}) {
  const gate = state?.pending_gate?.gate ?? null;
  const gateType = state?.pending_gate?.gate_type ?? null;
  const nextActions = deriveCoordinatorGateNextActions(state, config);
  const nextAction = nextActions[0]?.command ?? null;
  const detail = deriveRecoveryDetail(code, gate, hookName);

  return {
    ok: false,
    code: code || 'approval_failed',
    error: error || 'Coordinator gate approval failed',
    gate,
    gate_type: gateType,
    hook_phase: hookPhase || null,
    hook_name: hookName || null,
    next_action: nextAction,
    next_actions: nextActions,
    recovery_summary: {
      typed_reason: deriveTypedReason(code),
      owner: 'human',
      recovery_action: nextAction,
      detail,
    },
  };
}

export function normalizeCoordinatorGateApprovalSuccess({
  result,
  gateType,
  phaseTransitionMessagePrefix = 'Coordinator phase transition approved',
  completionMessage = 'Coordinator run completion approved. Run is now complete.',
}) {
  const nextActions = deriveCoordinatorGateNextActions(result?.state, result?.config);
  const nextAction = nextActions[0]?.command ?? null;

  if (gateType === 'phase_transition') {
    return {
      ok: true,
      gate_type: 'phase_transition',
      status: result?.state?.status || null,
      phase: result?.state?.phase || null,
      message: `${phaseTransitionMessagePrefix}: ${result?.transition?.from} -> ${result?.transition?.to}`,
      next_action: nextAction,
      next_actions: nextActions,
    };
  }

  return {
    ok: true,
    gate_type: 'run_completion',
    status: result?.state?.status || null,
    phase: result?.state?.phase || null,
    message: completionMessage,
    next_action: nextAction,
    next_actions: nextActions,
  };
}
