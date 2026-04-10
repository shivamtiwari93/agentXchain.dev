"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotFromPayload = snapshotFromPayload;
exports.diffRequiresNotification = diffRequiresNotification;
function snapshotFromPayload(payload) {
    const state = payload.state ?? null;
    return {
        pendingTransitionGate: state?.pending_phase_transition?.gate ?? null,
        pendingCompletionGate: state?.pending_run_completion?.gate ?? null,
        blocked: !!(state?.blocked || state?.status === 'blocked'),
        blockedReason: state?.blocked_reason ?? state?.blocked_on ?? null,
        turnSequence: state?.turn_sequence ?? 0,
    };
}
function diffRequiresNotification(prev, current) {
    return {
        pendingTransition: !!current.pendingTransitionGate && current.pendingTransitionGate !== prev.pendingTransitionGate,
        pendingCompletion: !!current.pendingCompletionGate && current.pendingCompletionGate !== prev.pendingCompletionGate,
        blocked: current.blocked && !prev.blocked,
        turnCompleted: current.turnSequence > prev.turnSequence,
    };
}
//# sourceMappingURL=notificationState.js.map