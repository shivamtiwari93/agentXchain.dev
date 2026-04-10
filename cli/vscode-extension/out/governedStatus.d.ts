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
    restart_recommended?: boolean;
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
export interface GovernedStepAction {
    cliArgs: string[];
    label: 'Dispatch Step' | 'Resume Step';
}
export interface GovernedRunAction {
    cliArgs: string[];
    label: 'Start Run' | 'Resume Run';
}
export interface GovernedRestartAction {
    cliArgs: string[];
    label: 'Restart Run';
}
export declare function loadGovernedStatus(root: string): Promise<GovernedStatusPayload>;
export declare function parseGovernedStatus(stdout: string, stderr?: string): GovernedStatusPayload;
export declare function renderGovernedStatusLines(payload: GovernedStatusPayload): string[];
export declare function renderGovernedStatusHtml(payload: GovernedStatusPayload, notice: string): string;
export declare function summarizeGovernedStatus(payload: GovernedStatusPayload): GovernedStatusBarModel;
export declare function getGovernedStepAction(payload: GovernedStatusPayload): GovernedStepAction | null;
export declare function getGovernedRunAction(payload: GovernedStatusPayload): GovernedRunAction | null;
export declare function getGovernedRestartAction(payload: GovernedStatusPayload): GovernedRestartAction | null;
export declare function buildCliShellCommand(cliArgs: string[]): string;
/**
 * Execute an agentxchain CLI command as a subprocess.
 * Used by governed status, approval commands, and future operator actions.
 */
export declare function execCliCommand(root: string, cliArgs: string[], timeoutMs?: number): Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function parseRecommendedRestartArgs(command: string | null | undefined): string[] | null;
export interface GovernedReportPayload {
    report_version?: string;
    overall?: string;
    generated_at?: string;
    export_kind?: string;
    verification?: {
        ok?: boolean;
        errors?: string[];
    };
    subject?: GovernedReportSubject;
}
export interface GovernedReportSubject {
    kind?: string;
    project?: {
        id?: string;
        name?: string;
        template?: string;
        protocol_mode?: string;
        schema_version?: string;
    };
    run?: GovernedReportRun;
    artifacts?: {
        history_entries?: number;
        decision_entries?: number;
        hook_audit_entries?: number;
        dispatch_artifact_files?: number;
        staging_artifact_files?: number;
    };
}
export interface GovernedReportRun {
    run_id?: string;
    status?: string;
    phase?: string;
    blocked_on?: string | null;
    blocked_reason?: string | null;
    active_turn_count?: number;
    retained_turn_count?: number;
    active_roles?: string[];
    budget_status?: {
        spent_usd?: number;
        remaining_usd?: number;
    } | null;
    created_at?: string;
    completed_at?: string | null;
    duration_seconds?: number;
    turns?: GovernedReportTurn[];
    decisions?: GovernedReportDecision[];
    workflow_kit_artifacts?: GovernedReportArtifact[];
}
export interface GovernedReportTurn {
    turn_id?: string;
    role?: string;
    status?: string;
    summary?: string;
    phase?: string;
    phase_transition?: string | null;
    files_changed_count?: number;
    decisions?: string[];
    objections?: string[];
    cost_usd?: number | null;
    accepted_at?: string;
}
export interface GovernedReportDecision {
    id?: string;
    turn_id?: string | null;
    role?: string | null;
    phase?: string | null;
    statement?: string;
}
export interface GovernedReportArtifact {
    path?: string;
    required?: boolean;
    exists?: boolean;
    owned_by?: string;
}
export declare function loadGovernedReport(root: string): Promise<GovernedReportPayload>;
export declare function renderReportLines(report: GovernedReportPayload): string[];
