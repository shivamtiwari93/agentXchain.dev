import * as fs from 'fs';
import * as path from 'path';

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
  agents: Record<string, { name: string; mandate: string }>;
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
  roles?: Record<string, { title?: string; mandate?: string }>;
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

export const GOVERNED_MODE_NOTICE =
  'Governed project detected. This extension supports phase transition and run completion approvals via CLI subprocess calls. Use agentxchain step, agentxchain dashboard, or the browser dashboard for additional governed operations.';

export function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function lockPath(root: string): string {
  return path.join(root, 'lock.json');
}

export function statePath(root: string, mode: ProjectMode = 'legacy'): string {
  if (mode === 'governed') {
    return path.join(root, '.agentxchain', 'state.json');
  }
  return path.join(root, 'state.json');
}

export function configPath(root: string): string {
  return path.join(root, 'agentxchain.json');
}

export function detectProjectMode(root: string, config?: AgentConfig | null): ProjectMode {
  const resolvedConfig = config ?? readJson<AgentConfig>(configPath(root));
  const hasGovernedState = fs.existsSync(statePath(root, 'governed'));
  const hasLegacyLock = fs.existsSync(lockPath(root));
  const hasLegacyState = fs.existsSync(statePath(root, 'legacy'));

  if (resolvedConfig && isGovernedConfig(resolvedConfig)) {
    return 'governed';
  }

  if (hasGovernedState) {
    return 'governed';
  }

  if (resolvedConfig && isLegacyConfig(resolvedConfig)) {
    return 'legacy';
  }

  if (hasLegacyLock || hasLegacyState) {
    return 'legacy';
  }

  return 'unknown';
}

export function getProjectSurface(root: string): ProjectSurface {
  const config = readJson<AgentConfig>(configPath(root));
  const mode = detectProjectMode(root, config);
  const state = readJson<ProjectState>(statePath(root, mode === 'governed' ? 'governed' : 'legacy'));
  const lock = mode === 'legacy' ? readJson<LockState>(lockPath(root)) : null;

  return { mode, config, state, lock };
}

export function getProjectName(config: AgentConfig | null): string {
  if (!config) return 'Unknown';
  if (isLegacyConfig(config)) {
    return config.project;
  }
  return config.project?.name || config.project?.id || 'Unknown';
}

export function getProjectActors(config: AgentConfig | null): ProjectActor[] {
  if (!config) {
    return [];
  }

  if (isLegacyConfig(config)) {
    return Object.entries(config.agents || {}).map(([id, agent]) => ({
      id,
      name: agent.name || id,
    }));
  }

  return Object.entries(config.roles || {}).map(([id, role]) => ({
    id,
    name: role.title || role.mandate || id,
  }));
}

export function getBlockedDetail(state: ProjectState | null): string | null {
  if (!state) return null;
  return state.blocked_on || state.blocked_reason || null;
}

function isLegacyConfig(config: AgentConfig): config is LegacyAgentConfig {
  return typeof (config as LegacyAgentConfig).project === 'string'
    || typeof (config as LegacyAgentConfig).version === 'number'
    || !!(config as LegacyAgentConfig).agents;
}

function isGovernedConfig(config: AgentConfig): config is GovernedAgentConfig {
  return typeof (config as GovernedAgentConfig).schema_version === 'string'
    || typeof (config as GovernedAgentConfig).schema_version === 'number'
    || !!(config as GovernedAgentConfig).roles
    || (config as GovernedAgentConfig).compat?.lock_based_coordination === false;
}
