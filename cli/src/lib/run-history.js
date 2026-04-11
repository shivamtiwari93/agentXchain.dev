/**
 * Run History — cross-run operator observability.
 *
 * Append-only JSONL ledger persisting summary metadata from each governed run.
 * Survives across runs (not reset by initializeGovernedRun).
 *
 * DEC-RH-SPEC: .planning/RUN_HISTORY_SPEC.md
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { normalizeRunProvenance } from './run-provenance.js';

const RUN_HISTORY_PATH = '.agentxchain/run-history.jsonl';
const HISTORY_PATH = '.agentxchain/history.jsonl';
const LEDGER_PATH = '.agentxchain/decision-ledger.jsonl';
const SCHEMA_VERSION = '0.1';
const WRITABLE_TERMINAL_STATUSES = new Set(['completed', 'blocked']);

/**
 * Record a run's summary into the persistent run-history ledger.
 * Non-fatal: catches and returns { ok: false, error } on failure.
 *
 * @param {string} root - project root directory
 * @param {object} state - final governed state
 * @param {object} config - normalized config
 * @param {'completed'|'blocked'} status - terminal status produced by current governed writers
 * @returns {{ ok: boolean, error?: string }}
 */
export function recordRunHistory(root, state, config, status) {
  try {
    if (!WRITABLE_TERMINAL_STATUSES.has(status)) {
      return {
        ok: false,
        error: `Unsupported run-history terminal status: ${status}. Current governed writers emit completed or blocked only.`,
      };
    }

    const filePath = join(root, RUN_HISTORY_PATH);
    mkdirSync(dirname(filePath), { recursive: true });

    const historyEntries = readJsonlSafe(root, HISTORY_PATH);
    const ledgerEntries = readJsonlSafe(root, LEDGER_PATH);

    // Extract unique phases and roles from turn history
    const phasesCompleted = [...new Set(historyEntries.map(e => e.phase).filter(Boolean))];
    const rolesUsed = [...new Set(historyEntries.map(e => e.role).filter(Boolean))];

    // Derive connector and model from config
    const firstRole = Object.values(config.roles || {})[0];
    const connectorUsed = firstRole?.runtime_id || firstRole?.runtime || null;
    const modelUsed = firstRole?.model || config.adapter?.model || null;

    // Derive run start time from first history entry or state
    const startedAt = historyEntries[0]?.accepted_at
      || state?.created_at
      || null;
    const completedAt = state?.completed_at || null;
    const durationMs = (startedAt && completedAt)
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : null;

    const record = {
      schema_version: SCHEMA_VERSION,
      run_id: state?.run_id || null,
      project_id: config.project?.id || null,
      project_name: config.project?.name || null,
      template: config.template || null,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      phases_completed: phasesCompleted,
      total_turns: historyEntries.length,
      roles_used: rolesUsed,
      decisions_count: ledgerEntries.length,
      total_cost_usd: state?.budget_status?.spent_usd ?? null,
      budget_limit_usd: config.budget?.per_run_max_usd ?? null,
      blocked_reason: status === 'blocked' ? (state?.blocked_reason?.detail || state?.blocked_on || null) : null,
      gate_results: state?.phase_gate_status || {},
      connector_used: connectorUsed,
      model_used: modelUsed,
      provenance: normalizeRunProvenance(state?.provenance),
      recorded_at: new Date().toISOString(),
    };

    appendFileSync(filePath, JSON.stringify(record) + '\n');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Query the run-history ledger.
 *
 * @param {string} root - project root directory
 * @param {object} [opts] - { limit?: number, status?: string }
 * @returns {Array<object>} most-recent-first
 */
export function queryRunHistory(root, opts = {}) {
  const filePath = join(root, RUN_HISTORY_PATH);
  if (!existsSync(filePath)) return [];

  let content;
  try {
    content = readFileSync(filePath, 'utf8').trim();
  } catch {
    return [];
  }
  if (!content) return [];

  let entries = content
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  // Filter by status if requested
  if (opts.status) {
    entries = entries.filter(e => e.status === opts.status);
  }

  // Most recent first
  entries.reverse();

  // Limit
  if (opts.limit && opts.limit > 0) {
    entries = entries.slice(0, opts.limit);
  }

  return entries;
}

/**
 * Get the path to the run-history file.
 */
export function getRunHistoryPath(root) {
  return join(root, RUN_HISTORY_PATH);
}

// ── Internal ────────────────────────────────────────────────────────────────

function readJsonlSafe(root, relPath) {
  const filePath = join(root, relPath);
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
