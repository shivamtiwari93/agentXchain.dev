import { AgentConfig } from './util';
export interface GovernedTurnState {
    turn_id?: string;
    assigned_role?: string;
    runtime_id?: string;
    status?: string;
    attempt?: number;
}
export interface GovernedPendingTransition {
    from?: string;
    to?: string;
    gate?: string;
}
export interface GovernedPendingCompletion {
    gate?: string;
}
export interface GovernedState {
    phase?: string;
    status?: string;
    blocked?: boolean;
    blocked_on?: string | null;
    blocked_reason?: string | null;
    escalation_active?: boolean;
    accepted_integration_ref?: string | null;
    turn_sequence?: number;
    current_turn?: GovernedTurnState | null;
    pending_phase_transition?: GovernedPendingTransition | null;
    pending_run_completion?: GovernedPendingCompletion | null;
    completed_at?: string | null;
}
export interface ContinuityCheckpoint {
    session_id?: string | null;
    last_checkpoint_at?: string | null;
    checkpoint_reason?: string | null;
    last_turn_id?: string | null;
    last_role?: string | null;
}
export interface GovernedContinuity {
    checkpoint?: ContinuityCheckpoint | null;
    recommended_command?: string | null;
    recommended_reason?: string | null;
    recommended_detail?: string | null;
    recovery_report_path?: string | null;
    drift_warnings?: string[] | null;
}
export interface WorkflowKitArtifact {
    path: string;
    exists: boolean;
    required: boolean;
    owned_by?: string | null;
}
export interface WorkflowKitArtifacts {
    phase?: string | null;
    artifacts?: WorkflowKitArtifact[] | null;
}
export interface GovernedStatusPayload {
    version?: string | number;
    protocol_mode?: string;
    template?: string;
    config?: AgentConfig | null;
    state?: GovernedState | null;
    continuity?: GovernedContinuity | null;
    workflow_kit_artifacts?: WorkflowKitArtifacts | null;
}
export interface GovernedStatusBarModel {
    text: string;
    tooltip: string;
    tone: 'default' | 'warning' | 'error';
}
export declare function loadGovernedStatus(root: string): Promise<GovernedStatusPayload>;
export declare function parseGovernedStatus(stdout: string, stderr?: string): GovernedStatusPayload;
export declare function renderGovernedStatusLines(payload: GovernedStatusPayload): string[];
export declare function renderGovernedStatusHtml(payload: GovernedStatusPayload, notice: string): string;
export declare function summarizeGovernedStatus(payload: GovernedStatusPayload): GovernedStatusBarModel;
