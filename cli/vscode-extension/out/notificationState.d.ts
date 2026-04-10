import { GovernedStatusPayload } from './governedStatus';
export interface GovernedSnapshot {
    pendingTransitionGate: string | null;
    pendingCompletionGate: string | null;
    blocked: boolean;
    blockedReason: string | null;
    turnSequence: number;
}
export declare function snapshotFromPayload(payload: GovernedStatusPayload): GovernedSnapshot;
export declare function diffRequiresNotification(prev: GovernedSnapshot, current: GovernedSnapshot): {
    pendingTransition: boolean;
    pendingCompletion: boolean;
    blocked: boolean;
    turnCompleted: boolean;
};
