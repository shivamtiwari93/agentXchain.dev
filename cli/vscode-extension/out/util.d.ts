export interface LockState {
    holder: string | null;
    last_released_by: string | null;
    turn_number: number;
    claimed_at: string | null;
}
export interface ProjectState {
    phase?: string;
    blocked?: boolean;
    blocked_on?: string | null;
    blocked_reason?: string | null;
    project?: string;
    status?: string | null;
    queued_phase_transition?: string | null;
    queued_run_completion?: unknown;
}
export interface LegacyAgentConfig {
    version: number;
    project: string;
    agents: Record<string, {
        name: string;
        mandate: string;
    }>;
    log?: string;
    state_file?: string;
    history_file?: string;
    rules?: Record<string, unknown>;
}
export interface GovernedAgentConfig {
    schema_version?: string | number;
    compat?: {
        lock_based_coordination?: boolean;
    };
    files?: {
        state?: string;
    };
    project?: {
        id?: string;
        name?: string;
        default_branch?: string;
    };
    roles?: Record<string, {
        title?: string;
        mandate?: string;
    }>;
}
export type AgentConfig = LegacyAgentConfig | GovernedAgentConfig;
export type ProjectMode = 'legacy' | 'governed' | 'unknown';
export interface ProjectActor {
    id: string;
    name: string;
}
export interface ProjectSurface {
    mode: ProjectMode;
    config: AgentConfig | null;
    state: ProjectState | null;
    lock: LockState | null;
}
export declare const GOVERNED_MODE_NOTICE = "Governed project detected. This extension keeps governed status read-only while supporting governed approvals and step dispatch through the AgentXchain CLI. Use agentxchain dashboard or the browser dashboard for additional governed operations.";
export declare function readJson<T>(filePath: string): T | null;
export declare function writeJson(filePath: string, data: unknown): void;
export declare function lockPath(root: string): string;
export declare function statePath(root: string, mode?: ProjectMode): string;
export declare function configPath(root: string): string;
export declare function detectProjectMode(root: string, config?: AgentConfig | null): ProjectMode;
export declare function getProjectSurface(root: string): ProjectSurface;
export declare function getProjectName(config: AgentConfig | null): string;
export declare function getProjectActors(config: AgentConfig | null): ProjectActor[];
export declare function getBlockedDetail(state: ProjectState | null): string | null;
