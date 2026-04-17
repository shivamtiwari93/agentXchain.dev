/**
 * Timeout status — computed dashboard endpoint.
 *
 * Reads agentxchain.json config, .agentxchain/state.json, and the decision
 * ledger to derive live timeout pressure and persisted timeout events.
 *
 * See: TIMEOUT_DASHBOARD_SURFACE_SPEC.md
 */

import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../config.js';
import { evaluateTimeouts, computeTimeoutBudget } from '../timeout-evaluator.js';
import { readJsonlFile } from './state-reader.js';

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

function emptyLiveTimeouts() {
  return { exceeded: [], warnings: [] };
}

function buildLiveContext(state) {
  const pendingPhase = state?.pending_phase_transition;
  const pendingCompletion = state?.pending_run_completion;
  if (pendingPhase) {
    return {
      awaiting_approval: true,
      pending_gate_type: 'phase_transition',
      requested_at: typeof pendingPhase.requested_at === 'string' ? pendingPhase.requested_at : null,
    };
  }
  if (pendingCompletion) {
    return {
      awaiting_approval: true,
      pending_gate_type: 'run_completion',
      requested_at: typeof pendingCompletion.requested_at === 'string' ? pendingCompletion.requested_at : null,
    };
  }
  return {
    awaiting_approval: false,
    pending_gate_type: null,
    requested_at: null,
  };
}

function getActiveTurns(state) {
  if (!state?.active_turns || typeof state.active_turns !== 'object' || Array.isArray(state.active_turns)) {
    return [];
  }
  return Object.values(state.active_turns).filter((turn) => turn && typeof turn === 'object');
}

function annotateTurnTimeout(result, state, turn) {
  return {
    ...result,
    phase: result.phase || state?.phase || null,
    turn_id: turn?.turn_id || null,
    role_id: turn?.assigned_role || null,
  };
}

export function evaluateDashboardTimeoutPressure(config, state, now = new Date()) {
  const approvalPending = Boolean(state?.pending_phase_transition || state?.pending_run_completion);
  if (!config?.timeouts || (state?.status !== 'active' && !approvalPending)) {
    return emptyLiveTimeouts();
  }

  const base = evaluateTimeouts({ config, state, now });
  const live = {
    exceeded: [...base.exceeded],
    warnings: [...base.warnings],
  };

  if (state?.status === 'active') {
    for (const turn of getActiveTurns(state)) {
      const turnEval = evaluateTimeouts({ config, state, turn, now });
      for (const item of turnEval.exceeded) {
        if (item.scope === 'turn') {
          live.exceeded.push(annotateTurnTimeout(item, state, turn));
        }
      }
      for (const item of turnEval.warnings) {
        if (item.scope === 'turn') {
          live.warnings.push(annotateTurnTimeout(item, state, turn));
        }
      }
    }
  }

  return live;
}

function loadDashboardTimeoutContext(workspacePath) {
  const context = loadProjectContext(workspacePath);
  if (!context || context.config?.protocol_mode !== 'governed') {
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

  const { root, config } = context;
  const state = loadProjectState(root, config);
  const agentxchainDir = join(root, '.agentxchain');
  if (!state) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'state_missing',
        error: 'Run state not found. Run `agentxchain init --governed` first.',
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
        live_context: null,
        events: [],
      },
    };
  }

  // Config summary
  const configSummary = buildTimeoutConfigSummary(timeouts, config.routing);

  // Live timeout evaluation — only meaningful when the run is active
  const nowDate = new Date();
  const live = evaluateDashboardTimeoutPressure(config, state, nowDate);

  // Compute remaining budget for all configured scopes
  const activeTurnsList = getActiveTurns(state);
  const primaryTurn = activeTurnsList.length === 1 ? activeTurnsList[0] : null;
  const budget = (state?.status === 'active' || Boolean(state?.pending_phase_transition || state?.pending_run_completion))
    ? computeTimeoutBudget({ config, state, turn: primaryTurn, now: nowDate })
    : [];

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
        budget,
        live_context: buildLiveContext(state),
        events,
      },
    };
}
