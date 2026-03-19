import * as fs from 'fs';
import * as path from 'path';

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
  agents: Record<string, { name: string; mandate: string }>;
  log?: string;
  state_file?: string;
  history_file?: string;
  rules?: Record<string, unknown>;
}

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

export function statePath(root: string): string {
  return path.join(root, 'state.json');
}

export function configPath(root: string): string {
  return path.join(root, 'agentxchain.json');
}
