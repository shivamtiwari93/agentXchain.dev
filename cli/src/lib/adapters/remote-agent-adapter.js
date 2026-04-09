/**
 * Remote Agent adapter — HTTP-based governed turn dispatch.
 *
 * Specification: .planning/REMOTE_AGENT_BRIDGE_CONNECTOR_SPEC.md
 *
 * This adapter proves connector replaceability (VISION.md Layer 3) by executing
 * governed turns over HTTP against an external agent service. The protocol's
 * staging, validation, and acceptance flow is preserved exactly — the remote
 * service receives a turn envelope and must return a valid turn-result JSON.
 *
 * v1 scope: synchronous request/response only. No polling, no webhooks.
 *
 * Security: authorization headers are sent to the remote service but are
 * never echoed into dispatch logs or governance artifacts.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getDispatchContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingDir,
  getTurnStagingResultPath,
} from '../turn-paths.js';
import { verifyDispatchManifestForAdapter } from '../dispatch-manifest.js';

/** Default timeout for remote agent requests (ms). */
export const DEFAULT_REMOTE_AGENT_TIMEOUT_MS = 120_000;

/** Header keys that must never appear in logs or artifacts. */
const REDACTED_HEADER_PATTERNS = [/^authorization$/i, /^x-api-key$/i, /^cookie$/i, /^proxy-authorization$/i];

function isSecretHeader(key) {
  return REDACTED_HEADER_PATTERNS.some(p => p.test(key));
}

/**
 * Build a safe header summary for logs (redacts secret values).
 */
function safeHeaderSummary(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const safe = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = isSecretHeader(k) ? '[REDACTED]' : v;
  }
  return safe;
}

/**
 * Dispatch a governed turn to a remote agent service.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state
 * @param {object} config - normalized config
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - abort signal
 * @param {function} [options.onStatus] - status callback
 * @param {boolean} [options.verifyManifest] - require dispatch manifest verification
 * @param {boolean} [options.skipManifestVerification] - skip manifest check
 * @param {string} [options.turnId] - override turn ID
 * @returns {Promise<{ ok: boolean, error?: string, logs?: string[], aborted?: boolean, timedOut?: boolean }>}
 */
export async function dispatchRemoteAgent(root, state, config, options = {}) {
  const { signal, onStatus, turnId } = options;
  const logs = [];

  const turn = resolveTargetTurn(state, turnId);
  if (!turn) {
    return { ok: false, error: 'No active turn in state', logs };
  }

  const manifestCheck = verifyDispatchManifestForAdapter(root, turn.turn_id, options);
  if (!manifestCheck.ok) {
    return { ok: false, error: `Dispatch manifest verification failed: ${manifestCheck.error}`, logs };
  }

  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  if (!runtime || runtime.type !== 'remote_agent') {
    return { ok: false, error: `Runtime "${runtimeId}" is not a remote_agent runtime`, logs };
  }

  if (!runtime.url) {
    return { ok: false, error: `Runtime "${runtimeId}" is missing required "url"`, logs };
  }

  const promptPath = join(root, getDispatchPromptPath(turn.turn_id));
  const contextPath = join(root, getDispatchContextPath(turn.turn_id));

  if (!existsSync(promptPath)) {
    return { ok: false, error: 'Dispatch bundle not found — PROMPT.md missing', logs };
  }

  const prompt = readFileSync(promptPath, 'utf8');
  const context = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : '';

  // Build request envelope — governed turn metadata + rendered content
  const timeoutMs = runtime.timeout_ms || DEFAULT_REMOTE_AGENT_TIMEOUT_MS;
  const requestBody = {
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    phase: state.phase,
    runtime_id: runtimeId,
    dispatch_dir: join(root, getDispatchTurnDir(turn.turn_id)),
    prompt,
    context,
  };

  // Ensure staging directory exists
  const stagingDir = join(root, getTurnStagingDir(turn.turn_id));
  mkdirSync(stagingDir, { recursive: true });

  // Log transport metadata (safe — no secrets)
  logs.push(`[remote] POST ${runtime.url}`);
  logs.push(`[remote] timeout_ms=${timeoutMs}`);
  const safeHeaders = safeHeaderSummary(runtime.headers);
  if (Object.keys(safeHeaders).length > 0) {
    logs.push(`[remote] headers=${JSON.stringify(safeHeaders)}`);
  }

  onStatus?.(`Posting to remote agent: ${runtime.url}`);

  try {
    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }

    const headers = {
      'content-type': 'application/json',
      ...(runtime.headers || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Chain external abort signal to our controller
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response;
    try {
      response = await fetch(runtime.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (signal?.aborted) {
        return { ok: false, aborted: true, logs };
      }
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        logs.push(`[remote] Request timed out after ${timeoutMs}ms`);
        return { ok: false, timedOut: true, error: `Remote agent timed out after ${timeoutMs}ms`, logs };
      }
      logs.push(`[remote] Network error: ${err.message}`);
      return { ok: false, error: `Remote agent network error: ${err.message}`, logs };
    } finally {
      clearTimeout(timeout);
    }

    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }

    logs.push(`[remote] HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch { /* ignore */ }
      if (body) logs.push(`[remote] Body: ${body.slice(0, 500)}`);
      return {
        ok: false,
        error: `Remote agent returned HTTP ${response.status}`,
        logs,
      };
    }

    // Parse response JSON
    let responseData;
    try {
      responseData = await response.json();
    } catch (err) {
      logs.push(`[remote] JSON parse error: ${err.message}`);
      return {
        ok: false,
        error: 'Remote agent response is not valid JSON',
        logs,
      };
    }

    // Validate turn result structure (lightweight — full validation happens in the acceptance pipeline)
    if (!looksLikeTurnResult(responseData)) {
      logs.push('[remote] Response missing required turn-result fields (need at least run_id/turn_id + status/role)');
      return {
        ok: false,
        error: 'Remote agent response does not contain a valid turn result',
        logs,
      };
    }

    // Stage the result
    const stagingPath = join(root, getTurnStagingResultPath(turn.turn_id));
    writeFileSync(stagingPath, JSON.stringify(responseData, null, 2));

    logs.push(`[remote] Turn result staged at ${getTurnStagingResultPath(turn.turn_id)}`);
    onStatus?.('Remote agent returned valid turn result');
    return { ok: true, logs };
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }
    logs.push(`[remote] Unexpected error: ${error.message}`);
    return {
      ok: false,
      error: `Remote agent dispatch failed: ${error.message}`,
      logs,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lightweight structural check: does this object look like a turn result?
 * Full validation happens later via validateStagedTurnResult.
 */
function looksLikeTurnResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hasIdentity = 'run_id' in value || 'turn_id' in value;
  const hasLifecycle = 'status' in value || 'role' in value || 'runtime_id' in value;
  return hasIdentity && hasLifecycle;
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}

/**
 * Describe a remote_agent runtime target for display (safe — no secrets).
 */
export function describeRemoteAgentTarget(runtime) {
  if (!runtime?.url) return '(unknown)';
  try {
    const u = new URL(runtime.url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return runtime.url;
  }
}
