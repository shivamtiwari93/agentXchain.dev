/**
 * Protocol Bridge — wraps runner-interface.js primitives for HTTP consumption.
 *
 * Design principles:
 *   1. No HTTP objects (no req/res) — pure protocol-to-protocol adapter
 *   2. Typed error classification for deterministic HTTP status mapping
 *   3. @state-provider JSDoc on every filesystem operation
 *   4. No side effects beyond protocol state mutations
 *
 * This module proves the agentxchain protocol is composable by an HTTP server
 * without modifying the protocol layer. The server maps bridge errors to HTTP
 * status codes and bridge results to JSON responses.
 *
 * Note: restartFromCheckpoint is defined in the OpenAPI spec but not exported
 * here because the protocol layer (turn-checkpoint.js) does not yet expose a
 * restart primitive. The bridge will add it when the protocol does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  initRun,
  loadState,
  acceptTurn,
  rejectTurn,
  approvePhaseGate,
  markRunBlocked,
  reissueTurn,
  acquireLock,
  releaseLock,
  getTurnStagingResultPath,
} from '../runner-interface.js';

import { checkpointAcceptedTurn } from '../turn-checkpoint.js';
import { queryRunHistory } from '../run-history.js';
import { readRunEvents } from '../run-events.js';
import { evaluatePhaseExit } from '../gate-evaluator.js';
import { buildRunExport } from '../export.js';

// ── Error Classes ──────────────────────────────────────────────────────────

export class ProtocolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details || null;
  }
}

export class NotFoundError extends Error {
  constructor(target, id) {
    super(`${target} "${id}" not found`);
    this.name = 'NotFoundError';
    this.code = 'not_found';
    this.target = target;
    this.target_id = id;
  }
}

export class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'invalid_request';
    this.details = details || null;
  }
}

export class AuthorizationError extends Error {
  constructor(requiredRole, actualRole) {
    super(`Requires role "${requiredRole}", got "${actualRole}"`);
    this.name = 'AuthorizationError';
    this.code = 'forbidden';
    this.required_role = requiredRole;
    this.actual_role = actualRole;
  }
}

export class ConflictError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'lock_conflict';
    this.details = details || null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const AGENTXCHAIN_DIR = '.agentxchain';
const HISTORY_FILE = 'history.jsonl';
const DECISION_LEDGER_FILE = 'decision-ledger.jsonl';

function requireState(root) {
  const statePath = join(root, AGENTXCHAIN_DIR, 'state.json');
  if (!existsSync(statePath)) {
    throw new NotFoundError('run state', root);
  }
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function paginate(items, cursor, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, limit));
  let startIndex = 0;
  if (cursor) {
    const cursorIndex = parseInt(cursor, 10);
    if (!Number.isNaN(cursorIndex) && cursorIndex >= 0) {
      startIndex = cursorIndex;
    }
  }
  const slice = items.slice(startIndex, startIndex + safeLimit);
  const hasMore = startIndex + safeLimit < items.length;
  return {
    data: slice,
    cursor: hasMore ? String(startIndex + safeLimit) : null,
    has_more: hasMore,
  };
}

// ── Bridge Functions ───────────────────────────────────────────────────────

/**
 * Create a new governed run.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (create new run document)
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @param {object} [opts] - options forwarded to initializeGovernedRun
 * @returns {object} created run state
 */
export function createRun(root, config, opts = {}) {
  const result = initRun(root, config, opts);
  if (!result.ok) {
    throw new ProtocolError('invalid_state', result.error);
  }
  return result.state;
}

/**
 * Get current run state.
 *
 * @state-provider readState
 * Reads: .agentxchain/state.json
 * Cloud replacement: state store GET by run_id
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @returns {object} run state
 */
export function getRunState(root, config) {
  requireState(root);
  const state = loadState(root, config);
  if (!state) {
    throw new NotFoundError('run', root);
  }
  return state;
}

/**
 * List runs from run history.
 *
 * @state-provider readHistory
 * Reads: .agentxchain/run-history.jsonl
 * Cloud replacement: run history query by project_id with cursor
 *
 * @param {string} root - project root
 * @param {string|null} cursor - pagination cursor
 * @param {number} [limit=25] - page size
 * @returns {{ data: object[], cursor: string|null, has_more: boolean }}
 */
export function listRuns(root, cursor, limit = 25) {
  const entries = queryRunHistory(root);
  return paginate(entries, cursor, limit);
}

/**
 * Cancel (block) a run.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (update run status)
 *
 * @param {string} root - project root
 * @param {string} reason - cancellation reason
 * @returns {object} updated run state
 */
export function cancelRun(root, reason) {
  requireState(root);
  if (!reason) {
    throw new ValidationError('Cancellation reason is required');
  }
  const result = markRunBlocked(root, {
    category: 'operator_cancelled',
    reason,
  });
  if (result && !result.ok) {
    throw new ProtocolError('invalid_state', result.error || 'Failed to cancel run');
  }
  return result;
}

/**
 * List turns from history.
 *
 * @state-provider readHistory
 * Reads: .agentxchain/history.jsonl
 * Cloud replacement: turn history query by run_id with cursor
 *
 * @param {string} root - project root
 * @param {string|null} cursor - pagination cursor
 * @param {number} [limit=25] - page size
 * @returns {{ data: object[], cursor: string|null, has_more: boolean }}
 */
export function getTurns(root, cursor, limit = 25) {
  const historyPath = join(root, AGENTXCHAIN_DIR, HISTORY_FILE);
  const entries = readJsonl(historyPath);
  return paginate(entries, cursor, limit);
}

/**
 * Get a specific turn by ID.
 *
 * @state-provider readHistory
 * Reads: .agentxchain/history.jsonl, .agentxchain/staging/<turn_id>/turn-result.json
 * Cloud replacement: turn store GET by turn_id
 *
 * @param {string} root - project root
 * @param {string} turnId - turn identifier
 * @returns {object} turn detail
 */
export function getTurn(root, turnId) {
  if (!turnId) {
    throw new ValidationError('turn_id is required');
  }
  const historyPath = join(root, AGENTXCHAIN_DIR, HISTORY_FILE);
  const entries = readJsonl(historyPath);
  const entry = entries.find(e => e.turn_id === turnId);
  if (entry) return entry;

  const stagingPath = join(root, getTurnStagingResultPath(turnId));
  if (existsSync(stagingPath)) {
    return JSON.parse(readFileSync(stagingPath, 'utf8'));
  }
  throw new NotFoundError('turn', turnId);
}

/**
 * Accept a turn result.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (compare-and-swap)
 *
 * @state-provider acquireLock
 * Reads/writes: .agentxchain/lock.json
 * Cloud replacement: distributed lock (lease-based, workspace-scoped)
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @param {string} turnId - target turn ID
 * @param {object} [opts] - additional options
 * @returns {object} acceptance result with updated state
 */
export function acceptTurnResult(root, config, turnId, opts = {}) {
  requireState(root);
  const result = acceptTurn(root, config, { ...opts, turnId });
  if (!result.ok) {
    if (result.error_code === 'lock_conflict' || (result.error && result.error.includes('lock'))) {
      throw new ConflictError(result.error);
    }
    throw new ProtocolError(
      result.error_code || 'invalid_state',
      result.error || 'Turn acceptance failed',
    );
  }
  return result;
}

/**
 * Reject a turn result.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (compare-and-swap)
 *
 * @state-provider acquireLock
 * Reads/writes: .agentxchain/lock.json
 * Cloud replacement: distributed lock (lease-based, workspace-scoped)
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @param {string} turnId - target turn ID
 * @param {string} reason - rejection reason
 * @param {object} [opts] - additional options
 * @returns {object} rejection result with updated state
 */
export function rejectTurnResult(root, config, turnId, reason, opts = {}) {
  requireState(root);
  if (!reason) {
    throw new ValidationError('Rejection reason is required');
  }
  const result = rejectTurn(root, config, null, { ...opts, turnId, reason });
  if (!result.ok) {
    if (result.error_code === 'lock_conflict' || (result.error && result.error.includes('lock'))) {
      throw new ConflictError(result.error);
    }
    throw new ProtocolError(
      result.error_code || 'invalid_state',
      result.error || 'Turn rejection failed',
    );
  }
  return result;
}

/**
 * Approve a pending phase transition.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (update phase)
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @param {object} [opts] - additional options
 * @returns {object} approval result with transition details
 */
export function approveTransition(root, config, opts = {}) {
  requireState(root);
  const result = approvePhaseGate(root, config, opts);
  if (!result.ok) {
    throw new ProtocolError(
      result.error_code || 'gate_not_satisfied',
      result.error || 'Phase transition approval failed',
    );
  }
  return result;
}

/**
 * Checkpoint an accepted turn.
 *
 * @state-provider writeState
 * Writes: git commit (checkpoint)
 * Cloud replacement: snapshot store PUT by checkpoint_id
 *
 * @param {string} root - project root
 * @param {string} turnId - turn to checkpoint
 * @returns {object} checkpoint result
 */
export function checkpointTurn(root, turnId) {
  requireState(root);
  if (!turnId) {
    throw new ValidationError('turn_id is required');
  }
  const result = checkpointAcceptedTurn(root, { turnId });
  if (result && !result.ok) {
    throw new ProtocolError(
      'checkpoint_not_found',
      result.error || 'Checkpoint failed',
    );
  }
  return result;
}

/**
 * Retry (reissue) a failed turn.
 *
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT (reissue turn)
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @param {string} turnId - turn to retry
 * @returns {object} reissue result
 */
export function retryTurn(root, config, turnId) {
  requireState(root);
  if (!turnId) {
    throw new ValidationError('turn_id is required');
  }
  const result = reissueTurn(root, config, { turnId });
  if (!result.ok) {
    throw new ProtocolError(
      result.error_code || 'invalid_state',
      result.error || 'Turn retry failed',
    );
  }
  return result;
}

/**
 * Get run events.
 *
 * @state-provider readEvents
 * Reads: .agentxchain/events.jsonl
 * Cloud replacement: event store query by run_id with cursor
 *
 * @param {string} root - project root
 * @param {string|null} cursor - pagination cursor
 * @param {number} [limit=25] - page size
 * @returns {{ data: object[], cursor: string|null, has_more: boolean }}
 */
export function getEvents(root, cursor, limit = 25) {
  const events = readRunEvents(root);
  return paginate(events, cursor, limit);
}

/**
 * Get decision ledger.
 *
 * @state-provider readDecisions
 * Reads: .agentxchain/decision-ledger.jsonl
 * Cloud replacement: decision ledger query by run_id
 *
 * @param {string} root - project root
 * @returns {{ data: object[] }}
 */
export function getDecisions(root) {
  const ledgerPath = join(root, AGENTXCHAIN_DIR, DECISION_LEDGER_FILE);
  const entries = readJsonl(ledgerPath);
  return { data: entries };
}

/**
 * Get gate states for the current phase.
 *
 * @state-provider readState
 * Reads: .agentxchain/state.json + gate artifacts
 * Cloud replacement: gate state query by run_id
 *
 * @param {string} root - project root
 * @param {object} config - normalized config
 * @returns {{ data: object[] }}
 */
export function getGates(root, config) {
  requireState(root);
  const state = loadState(root, config);
  if (!state) {
    throw new NotFoundError('run', root);
  }
  const gates = state.gates || {};
  const gateList = Object.entries(gates).map(([name, gate]) => ({
    name,
    ...gate,
  }));
  return { data: gateList };
}

/**
 * Export run as repo-native artifact bundle.
 *
 * @state-provider readState
 * Reads: .agentxchain/ (all state files)
 * Cloud replacement: export service builds bundle from service stores
 *
 * @param {string} root - project root
 * @returns {object} export result with { ok, export }
 */
export function exportRun(root) {
  const result = buildRunExport(root);
  if (!result.ok) {
    throw new ProtocolError('internal_error', result.error || 'Export failed');
  }
  return result;
}
