import { GovernedStatusPayload } from './governedStatus';

export interface GovernedSnapshot {
  pendingTransitionGate: string | null;
  pendingCompletionGate: string | null;
  blocked: boolean;
  blockedReason: string | null;
  turnSequence: number;
}

export function snapshotFromPayload(payload: GovernedStatusPayload): GovernedSnapshot {
  const state = payload.state ?? null;
  return {
    pendingTransitionGate: state?.pending_phase_transition?.gate ?? null,
    pendingCompletionGate: state?.pending_run_completion?.gate ?? null,
    blocked: !!(state?.blocked || state?.status === 'blocked'),
    blockedReason: (state?.blocked_reason as string | null) ?? state?.blocked_on ?? null,
    turnSequence: state?.turn_sequence ?? 0,
  };
}

export function diffRequiresNotification(prev: GovernedSnapshot, current: GovernedSnapshot): {
  pendingTransition: boolean;
  pendingCompletion: boolean;
  blocked: boolean;
  turnCompleted: boolean;
} {
  return {
    pendingTransition: !!current.pendingTransitionGate && current.pendingTransitionGate !== prev.pendingTransitionGate,
    pendingCompletion: !!current.pendingCompletionGate && current.pendingCompletionGate !== prev.pendingCompletionGate,
    blocked: current.blocked && !prev.blocked,
    turnCompleted: current.turnSequence > prev.turnSequence,
  };
}
