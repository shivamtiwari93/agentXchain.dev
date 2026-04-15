/**
 * State reader — reads .agentxchain/ state files for the dashboard bridge.
 *
 * All reads are synchronous and return parsed data or null for missing files.
 * The bridge server calls these on each API request (no caching — files are
 * small and change infrequently relative to HTTP request rate).
 */

import { readFileSync, existsSync } from 'fs';
import { join, normalize, resolve } from 'path';
import {
  deriveGovernedRunNextActions,
  deriveRuntimeBlockedGuidance,
} from '../blocked-state.js';
import { loadProjectContext } from '../config.js';
import { getContinuityStatus } from '../continuity-status.js';
import { readRepoDecisions, summarizeRepoDecisions } from '../repo-decisions.js';

const STATE_FILE = 'state.json';
const SESSION_FILE = 'session.json';
const SESSION_RECOVERY_FILE = 'SESSION_RECOVERY.md';
const HISTORY_FILE = 'history.jsonl';
const LEDGER_FILE = 'decision-ledger.jsonl';
const REPO_DECISIONS_FILE = 'repo-decisions.jsonl';
const HOOK_AUDIT_FILE = 'hook-audit.jsonl';
const HOOK_ANNOTATIONS_FILE = 'hook-annotations.jsonl';
const EVENTS_FILE = 'events.jsonl';
const MULTIREPO_DIR = 'multirepo';
const BARRIERS_FILE = 'barriers.json';
const BARRIER_LEDGER_FILE = 'barrier-ledger.jsonl';

/**
 * Map of API resource paths to their .agentxchain/ file names.
 */
export const RESOURCE_MAP = {
  '/api/state': STATE_FILE,
  '/api/continuity': SESSION_FILE,
  '/api/history': HISTORY_FILE,
  '/api/ledger': LEDGER_FILE,
  '/api/hooks/audit': HOOK_AUDIT_FILE,
  '/api/hooks/annotations': HOOK_ANNOTATIONS_FILE,
  '/api/coordinator/state': join(MULTIREPO_DIR, STATE_FILE),
  '/api/coordinator/history': join(MULTIREPO_DIR, HISTORY_FILE),
  '/api/coordinator/ledger': join(MULTIREPO_DIR, LEDGER_FILE),
  '/api/coordinator/barriers': join(MULTIREPO_DIR, BARRIERS_FILE),
  '/api/coordinator/barrier-ledger': join(MULTIREPO_DIR, BARRIER_LEDGER_FILE),
  '/api/coordinator/hooks/audit': join(MULTIREPO_DIR, HOOK_AUDIT_FILE),
  '/api/coordinator/hooks/annotations': join(MULTIREPO_DIR, HOOK_ANNOTATIONS_FILE),
  '/api/events': EVENTS_FILE,
};

/**
 * Reverse map: relative file path under .agentxchain/ → API resource path.
 */
export const FILE_TO_RESOURCE = Object.fromEntries(
  Object.entries(RESOURCE_MAP).map(([resource, file]) => [normalizeRelativePath(file), resource])
);
FILE_TO_RESOURCE[normalizeRelativePath(SESSION_RECOVERY_FILE)] = '/api/continuity';
FILE_TO_RESOURCE[normalizeRelativePath('run-history.jsonl')] = '/api/run-history';
FILE_TO_RESOURCE[normalizeRelativePath(REPO_DECISIONS_FILE)] = '/api/repo-decisions-summary';

export const WATCH_DIRECTORIES = [
  '',
  MULTIREPO_DIR,
];

export function normalizeRelativePath(filePath) {
  return normalize(filePath).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function resourceForRelativePath(filePath) {
  return FILE_TO_RESOURCE[normalizeRelativePath(filePath)] || null;
}

/**
 * Read a JSON file. Returns parsed object or null if file doesn't exist.
 * Throws on malformed JSON.
 */
export function readJsonFile(agentxchainDir, filename) {
  const filePath = join(agentxchainDir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return null;
  return JSON.parse(content);
}

/**
 * Read a JSONL file. Returns array of parsed objects or null if file doesn't exist.
 * Throws on malformed JSON in any line.
 */
export function readJsonlFile(agentxchainDir, filename) {
  const filePath = join(agentxchainDir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

function enrichGovernedState(agentxchainDir, state) {
  if (!state || typeof state !== 'object') {
    return state;
  }

  const workspacePath = resolve(agentxchainDir, '..');
  const context = loadProjectContext(workspacePath);
  if (!context || context.config?.protocol_mode !== 'governed') {
    return state;
  }

  return {
    ...state,
    runtime_guidance: deriveRuntimeBlockedGuidance(state, context.config),
    next_actions: deriveGovernedRunNextActions(state, context.config),
  };
}

/**
 * Read a resource by its API path. Returns { data, format } or null.
 */
export function readResource(agentxchainDir, resourcePath) {
  if (resourcePath === '/api/continuity') {
    const root = resolve(agentxchainDir, '..');
    const state = readJsonFile(agentxchainDir, STATE_FILE);
    const data = getContinuityStatus(root, state);
    return { data, format: 'json' };
  }
  if (resourcePath === '/api/repo-decisions-summary') {
    const root = resolve(agentxchainDir, '..');
    const context = loadProjectContext(root);
    const data = summarizeRepoDecisions(readRepoDecisions(root), context?.config || null);
    return { data, format: 'json' };
  }

  const filename = RESOURCE_MAP[resourcePath];
  if (!filename) return null;

  if (filename.endsWith('.jsonl')) {
    const data = readJsonlFile(agentxchainDir, filename);
    return data !== null ? { data, format: 'jsonl' } : null;
  }
  let data = readJsonFile(agentxchainDir, filename);
  if (resourcePath === '/api/state') {
    data = enrichGovernedState(agentxchainDir, data);
  }
  return data !== null ? { data, format: 'json' } : null;
}
