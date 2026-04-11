/**
 * Timeout status — computed dashboard endpoint.
 *
 * Reads agentxchain.json config, .agentxchain/state.json, and the decision
 * ledger to derive live timeout pressure and persisted timeout events.
 *
 * See: TIMEOUT_DASHBOARD_SURFACE_SPEC.md
 */

import { join } from 'path';
import { loadConfig, loadProjectContext, loadProjectState } from '../config.js';
import { evaluateTimeouts } from '../timeout-evaluator.js';
import { readJsonFile, readJsonlFile } from './state-reader.js';

/**
 * Extract timeout events from raw decision-ledger entries.
 * Mirrors the shape of report.js extractTimeoutEventDigest but operates
 * on in-memory ledger array rather than export artifacts.
 */
export function extractTimeoutEvents(ledgerEntries) {
  if (!Array.isArray(ledgerEntries) || ledgerEntries.length === 0) return [];
  return ledgerEntries
    .filter((d) => typeof d?.type === 'string' && d.type.startsWith('timeout'))
    .map((d) => ({
      type: d.type,
      scope: d.scope || null,
      phase: d.phase || null,
      turn_id: d.turn_id || null,
      limit_minutes: typeof d.limit_minutes === 'number' ? d.limit_minutes : null,
      elapsed_minutes: typeof d.elapsed_minutes === 'number' ? d.elapsed_minutes : null,
      exceeded_by_minutes: typeof d.exceeded_by_minutes === 'number' ? d.exceeded_by_minutes : null,
      action: d.action || null,
      timestamp: d.timestamp || null,
    }));
}

/**
 * Flatten per-phase routing timeout overrides into a display-friendly array.
 */
export function flattenPhaseOverrides(routing) {
  if (!routing) return [];
  const overrides = [];
  for (const [phase, route] of Object.entries(routing)) {
    if (route.timeout_minutes || route.timeout_action) {
      overrides.push({
        phase,
        limit_minutes: typeof route.timeout_minutes === 'number' ? route.timeout_minutes : null,
        action: route.timeout_action || null,
      });
    }
  }
  return overrides;
}

/**
 * Read timeout status for the dashboard.
 *
 * @param {string} workspacePath — project root (parent of .agentxchain/)
 * @returns {{ ok: boolean, status: number, body: object }}
 */
export function buildTimeoutConfigSummary(timeouts, routing) {
  if (!timeouts) return null;
  return {
    per_turn_minutes: timeouts.per_turn_minutes || null,
    per_phase_minutes: timeouts.per_phase_minutes || null,
    per_run_minutes: timeouts.per_run_minutes || null,
    action: timeouts.action || 'escalate',
    phase_overrides: flattenPhaseOverrides(routing),
  };
}

function loadDashboardTimeoutContext(workspacePath) {
  const context = loadProjectContext(workspacePath);
  const governedContext = context?.config?.protocol_mode === 'governed' ? context : null;
  const legacyConfigResult = governedContext ? null : loadConfig(workspacePath);
  if (!governedContext && !legacyConfigResult) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'config_missing',
        error: 'Project config not found. Run `agentxchain init --governed` first.',
      },
    };
  }

  return {
    ok: true,
    root,
    config,
    state,
    agentxchainDir,
  };
}

export function readTimeoutStatus(workspacePath) {
  const contextResult = loadDashboardTimeoutContext(workspacePath);
  if (!contextResult.ok) {
    return contextResult;
  }

  const { config, state, agentxchainDir } = contextResult;
  const timeouts = config.timeouts;
  if (!timeouts) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        configured: false,
        config: null,
        live: null,
        events: [],
      },
    };
  }

  // Config summary
  const configSummary = buildTimeoutConfigSummary(timeouts, config.routing);

  // Live timeout evaluation — only meaningful when the run is active
  let live = { exceeded: [], warnings: [] };
  if (state.status === 'active') {
    live = evaluateTimeouts({ config, state, now: new Date() });
  }

  // Persisted timeout events from the decision ledger
  const ledger = readJsonlFile(agentxchainDir, 'decision-ledger.jsonl');
  const events = extractTimeoutEvents(ledger);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      configured: true,
      config: configSummary,
      live,
      events,
    },
  };
}
