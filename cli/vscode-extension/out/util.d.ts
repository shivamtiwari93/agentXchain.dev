export interface LockState {
    holder: string | null;
    last_released_by: string | null;
    turn_number: number;
    claimed_at: string | null;
}
export interface ProjectState {
    phase: string;
    blocked: boolean;
    blocked_on: string | null;
    project: string;
}
export interface AgentConfig {
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
export declare function readJson<T>(filePath: string): T | null;
export declare function writeJson(filePath: string, data: unknown): void;
export declare function lockPath(root: string): string;
export declare function statePath(root: string): string;
export declare function configPath(root: string): string;
