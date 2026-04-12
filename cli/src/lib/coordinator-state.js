/**
 * Coordinator state machine — multi-repo run lifecycle.
 *
 * Manages: super_run initialization, repo-local run linkage,
 * coordinator state persistence, barrier bootstrapping, and status queries.
 *
 * Design rules:
 *   - Coordinator state lives under <workspace>/.agentxchain/multirepo/
 *   - Repo-local .agentxchain/ directories are NEVER mutated by coordinator code
 *   - Init is atomic: if any required repo fails, no coordinator state is written
 *   - Uses loadCoordinatorConfig() as the sole config entry point (DEC-MR-IMPL-006)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeWriteJson } from './safe-write.js';
import { loadCoordinatorConfig } from './coordinator-config.js';
import { initializeGovernedRun } from './governed-state.js';

// ── Paths ───────────────────────────────────────────────────────────────────

const MULTIREPO_DIR = '.agentxchain/multirepo';
const STATE_FILE = 'state.json';
const HISTORY_FILE = 'history.jsonl';
const LEDGER_FILE = 'decision-ledger.jsonl';
const BARRIERS_FILE = 'barriers.json';
const BARRIER_LEDGER_FILE = 'barrier-ledger.jsonl';

function multiDir(workspacePath) {
  return join(workspacePath, MULTIREPO_DIR);
}

function statePath(workspacePath) {
  return join(multiDir(workspacePath), STATE_FILE);
}

function historyPath(workspacePath) {
  return join(multiDir(workspacePath), HISTORY_FILE);
}

function ledgerPath(workspacePath) {
  return join(multiDir(workspacePath), LEDGER_FILE);
}

function barriersPath(workspacePath) {
  return join(multiDir(workspacePath), BARRIERS_FILE);
}

function barrierLedgerPath(workspacePath) {
  return join(multiDir(workspacePath), BARRIER_LEDGER_FILE);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateSuperRunId() {
  const ts = Date.now();
  const rand = randomBytes(4).toString('hex');
  return `srun_${ts}_${rand}`;
}

function appendJsonl(filePath, entry) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entry) + '\n', { flag: 'a' });
}

function nextCoordinatorDecisionId(entries) {
  let max = 0;
  for (const entry of entries) {
    const match = typeof entry?.id === 'string'
      ? entry.id.match(/^DEC-COORD-(\d+)$/)
      : null;
    if (!match) continue;
    const current = Number.parseInt(match[1], 10);
    if (Number.isFinite(current) && current > max) {
      max = current;
    }
  }
  return `DEC-COORD-${String(max + 1).padStart(3, '0')}`;
}

function readRepoLocalState(repoPath) {
  const stateFile = join(repoPath, '.agentxchain/state.json');
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function readRepoLocalConfig(repoPath) {
  const configFile = join(repoPath, 'agentxchain.json');
  if (!existsSync(configFile)) return null;
  try {
    return JSON.parse(readFileSync(configFile, 'utf8'));
  } catch {
    return null;
  }
}

// ── Barrier bootstrapping ───────────────────────────────────────────────────

function bootstrapBarriers(config) {
  const barriers = {};

  for (const [workstreamId, workstream] of Object.entries(config.workstreams)) {
    const barrierId = `${workstreamId}_completion`;
    barriers[barrierId] = {
      workstream_id: workstreamId,
      type: workstream.completion_barrier,
      status: 'pending',
      required_repos: [...workstream.repos],
      satisfied_repos: [],
      alignment_decision_ids: workstream.interface_alignment?.decision_ids_by_repo || null,
      created_at: new Date().toISOString(),
    };
  }

  return barriers;
}

// ── Core API ────────────────────────────────────────────────────────────────

/**
 * Initialize a multi-repo coordinator run.
 *
 * 1. Validates config via loadCoordinatorConfig().
 * 2. For each repo: links existing active run or initializes a new one.
 * 3. Writes all coordinator state files atomically.
 * 4. If any required repo fails, no coordinator state is written.
 *
 * @param {string} workspacePath - path to the coordinator workspace
 * @param {object} [preloadedConfig] - optional pre-loaded config (skips loadCoordinatorConfig)
 * @returns {{ ok: boolean, super_run_id?: string, repo_runs?: object, errors?: string[] }}
 */
export function initializeCoordinatorRun(workspacePath, preloadedConfig) {
  // Step 1: Load and validate config
  let config;
  if (preloadedConfig) {
    config = preloadedConfig;
  } else {
    const configResult = loadCoordinatorConfig(workspacePath);
    if (!configResult.ok) {
      return { ok: false, errors: configResult.errors };
    }
    config = configResult.config;
  }

  // Step 2: Link or initialize repo-local runs
  const repoRuns = {};
  const errors = [];

  for (const repoId of config.repo_order) {
    const repo = config.repos[repoId];
    const repoPath = repo.resolved_path;

    const repoState = readRepoLocalState(repoPath);

    if (repoState && repoState.run_id && repoState.status === 'active') {
      // Link existing active run
      repoRuns[repoId] = {
        run_id: repoState.run_id,
        status: 'linked',
        phase: repoState.phase ?? 'implementation',
        initialized_by_coordinator: false,
      };
    } else if (repoState && (repoState.status === 'idle' || repoState.status === 'paused' ||
      (repoState.status === 'blocked' && !repoState.run_id))) {
      // Initialize a new run
      const repoConfig = readRepoLocalConfig(repoPath);
      if (!repoConfig) {
        errors.push(`repo_init_failed: repo "${repoId}" config could not be read`);
        continue;
      }

      const initResult = initializeGovernedRun(repoPath, repoConfig);
      if (!initResult.ok) {
        errors.push(`repo_init_failed: repo "${repoId}" initialization failed: ${initResult.error}`);
        continue;
      }

      repoRuns[repoId] = {
        run_id: initResult.state.run_id,
        status: 'initialized',
        phase: initResult.state.phase ?? 'implementation',
        initialized_by_coordinator: true,
      };
    } else if (repoState && repoState.status === 'completed') {
      errors.push(`repo_completed: repo "${repoId}" has a completed run. Reset or start a new project before coordinator init.`);
      continue;
    } else if (repoState && repoState.status === 'blocked' && repoState.run_id) {
      errors.push(`repo_blocked: repo "${repoId}" is blocked with an active run. Resolve the blocked state before coordinator init.`);
      continue;
    } else {
      errors.push(`repo_no_state: repo "${repoId}" has no governed state`);
      continue;
    }
  }

  // Check if all required repos succeeded
  const requiredRepos = config.repo_order.filter(id => config.repos[id].required);
  const failedRequired = requiredRepos.filter(id => !repoRuns[id]);
  if (failedRequired.length > 0) {
    return {
      ok: false,
      errors: [
        ...errors,
        `atomic_failure: required repos failed: ${failedRequired.join(', ')}. No coordinator state written.`,
      ],
    };
  }

  // Step 3: Generate coordinator state
  const superRunId = generateSuperRunId();
  const now = new Date().toISOString();
  const barriers = bootstrapBarriers(config);

  const state = {
    schema_version: '0.1',
    super_run_id: superRunId,
    project_id: config.project.id,
    status: 'active',
    phase: config.workstream_order.length > 0
      ? config.workstreams[config.workstream_order[0]].phase
      : 'implementation',
    repo_runs: repoRuns,
    pending_gate: null,
    phase_gate_status: {},
    created_at: now,
    updated_at: now,
  };

  // Step 4: Atomic write — create directory and all files
  const dir = multiDir(workspacePath);
  try {
    mkdirSync(dir, { recursive: true });

    // Write state
    safeWriteJson(statePath(workspacePath), state);

    // Write barriers
    safeWriteJson(barriersPath(workspacePath), barriers);

    // Create empty JSONL files
    const emptyFiles = [
      historyPath(workspacePath),
      ledgerPath(workspacePath),
      barrierLedgerPath(workspacePath),
    ];
    for (const filePath of emptyFiles) {
      if (!existsSync(filePath)) {
        writeFileSync(filePath, '', { flag: 'w' });
      }
    }

    // Append run_initialized to history
    appendJsonl(historyPath(workspacePath), {
      type: 'run_initialized',
      super_run_id: superRunId,
      project_id: config.project.id,
      repo_runs: Object.fromEntries(
        Object.entries(repoRuns).map(([id, run]) => [id, {
          run_id: run.run_id,
          initialized_by_coordinator: run.initialized_by_coordinator,
        }]),
      ),
      timestamp: now,
    });
    recordCoordinatorDecision(workspacePath, state, {
      timestamp: now,
      category: 'initialization',
      statement: `Initialized coordinator run for ${config.project.id} with ${Object.keys(repoRuns).length} repo${Object.keys(repoRuns).length === 1 ? '' : 's'}`,
    });
  } catch (err) {
    // Atomic failure: clean up partial state
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort cleanup */ }
    return {
      ok: false,
      errors: [...errors, `write_failed: ${err.message}`],
    };
  }

  return {
    ok: true,
    super_run_id: superRunId,
    repo_runs: repoRuns,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Load coordinator state from disk.
 *
 * @param {string} workspacePath
 * @returns {object|null} - parsed state or null if not found
 */
export function loadCoordinatorState(workspacePath) {
  const file = statePath(workspacePath);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save coordinator state to disk.
 *
 * @param {string} workspacePath
 * @param {object} state
 */
export function saveCoordinatorState(workspacePath, state) {
  const updated = { ...state, updated_at: new Date().toISOString() };
  safeWriteJson(statePath(workspacePath), updated);
}

export function readCoordinatorDecisionLedger(workspacePath) {
  const file = ledgerPath(workspacePath);
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function recordCoordinatorDecision(workspacePath, state, decision) {
  const statement = typeof decision?.statement === 'string' ? decision.statement.trim() : '';
  if (statement.length === 0) {
    throw new Error('Coordinator decision statement is required');
  }

  const existingEntries = readCoordinatorDecisionLedger(workspacePath);
  const entry = {
    id: typeof decision?.id === 'string' && decision.id.length > 0
      ? decision.id
      : nextCoordinatorDecisionId(existingEntries),
    timestamp: decision?.timestamp || new Date().toISOString(),
    super_run_id: decision?.super_run_id || state?.super_run_id || null,
    role: decision?.role || 'coordinator',
    phase: decision?.phase || state?.phase || null,
    category: decision?.category || 'governance',
    statement,
  };

  for (const key of [
    'repo_id',
    'repo_run_id',
    'repo_turn_id',
    'workstream_id',
    'gate',
    'from',
    'to',
    'reason',
    'context_ref',
    'projection_ref',
  ]) {
    const value = decision?.[key];
    if (value != null) {
      entry[key] = value;
    }
  }

  appendJsonl(ledgerPath(workspacePath), entry);
  return entry;
}

/**
 * Get a full coordinator status snapshot.
 *
 * @param {string} workspacePath
 * @returns {{ super_run_id, status, phase, repo_runs, pending_barriers, pending_gate }|null}
 */
export function getCoordinatorStatus(workspacePath) {
  const state = loadCoordinatorState(workspacePath);
  if (!state) return null;

  // Read barriers
  let barriers = {};
  const barriersFile = barriersPath(workspacePath);
  if (existsSync(barriersFile)) {
    try {
      barriers = JSON.parse(readFileSync(barriersFile, 'utf8'));
    } catch { /* empty or corrupt — treat as empty */ }
  }

  const pendingBarriers = Object.entries(barriers)
    .filter(([, b]) => b.status === 'pending' || b.status === 'partially_satisfied')
    .map(([id, b]) => ({ id, ...b }));

  return {
    super_run_id: state.super_run_id,
    status: state.status,
    phase: state.phase,
    repo_runs: state.repo_runs,
    pending_barriers: pendingBarriers,
    pending_gate: state.pending_gate ?? null,
    blocked_reason: state.blocked_reason ?? null,
    created_at: state.created_at ?? null,
    updated_at: state.updated_at ?? null,
    phase_gate_status: state.phase_gate_status ?? null,
  };
}

/**
 * Read coordinator history entries.
 *
 * @param {string} workspacePath
 * @returns {object[]}
 */
export function readCoordinatorHistory(workspacePath) {
  const file = historyPath(workspacePath);
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Read coordinator barriers snapshot.
 *
 * @param {string} workspacePath
 * @returns {object}
 */
export function readBarriers(workspacePath) {
  const file = barriersPath(workspacePath);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
