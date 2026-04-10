import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const HISTORY_PATH = '.agentxchain/history.jsonl';
const STAGING_DIR = '.agentxchain/staging';
const CONNECTOR_RUNTIME_TYPES = new Set(['local_cli', 'api_proxy', 'mcp', 'remote_agent']);

function safeReadJson(absPath) {
  try {
    if (!existsSync(absPath)) return null;
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadJsonl(absPath) {
  try {
    if (!existsSync(absPath)) return [];
    const raw = readFileSync(absPath, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function toMillis(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function chooseLatest(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const leftMs = toMillis(left.at);
  const rightMs = toMillis(right.at);
  if (leftMs === null) return right;
  if (rightMs === null) return left;
  return rightMs >= leftMs ? right : left;
}

function chooseLatestDefined(left, right) {
  if (right == null) return left ?? null;
  if (left == null) return right;
  return right;
}

function formatCommand(command, args = []) {
  if (Array.isArray(command)) {
    return command.join(' ');
  }
  if (typeof command === 'string' && command.length > 0) {
    return [command, ...(Array.isArray(args) ? args : [])].join(' ');
  }
  return null;
}

function formatTarget(runtime) {
  switch (runtime?.type) {
    case 'api_proxy':
      return [runtime.provider, runtime.model].filter(Boolean).join(' / ') || 'unknown target';
    case 'remote_agent':
      return runtime.url || 'unknown target';
    case 'mcp':
      return runtime.transport === 'streamable_http'
        ? (runtime.url || 'unknown target')
        : (formatCommand(runtime.command, runtime.args) || 'unknown target');
    case 'local_cli':
      return formatCommand(runtime.command, runtime.args) || 'unknown target';
    default:
      return 'unknown target';
  }
}

function getLatestAttemptFromTrace(trace) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null;
  const attempts = Array.isArray(trace.attempts) ? trace.attempts : [];
  if (attempts.length === 0) return null;
  const last = attempts[attempts.length - 1];
  if (!last || typeof last !== 'object') return null;
  const startedAt = typeof last.started_at === 'string' ? last.started_at : null;
  const completedAt = typeof last.completed_at === 'string' ? last.completed_at : startedAt;
  let latencyMs = null;
  const startedMs = toMillis(startedAt);
  const completedMs = toMillis(completedAt);
  if (startedMs !== null && completedMs !== null && completedMs >= startedMs) {
    latencyMs = completedMs - startedMs;
  }
  return {
    at: completedAt,
    turn_id: trace.turn_id || null,
    runtime_id: trace.runtime_id || null,
    attempts_made: Number.isInteger(trace.attempts_made) ? trace.attempts_made : attempts.length,
    final_outcome: trace.final_outcome || null,
    latency_ms: latencyMs,
  };
}

function buildConnectorEntry(runtimeId, runtime) {
  return {
    runtime_id: runtimeId,
    type: runtime.type,
    target: formatTarget(runtime),
    state: 'never_used',
    reachable: 'unknown',
    active_turn_ids: [],
    active_roles: [],
    last_turn_id: null,
    last_role: null,
    last_phase: null,
    last_attempt_at: null,
    last_success_at: null,
    last_failure_at: null,
    latency_ms: null,
    attempts_made: null,
    last_error: null,
    _latest_success: null,
    _latest_failure: null,
    _latest_attempt: null,
    _latest_identity: null,
  };
}

function applyIdentityTarget(entry, candidate) {
  if (!candidate) return;
  entry.last_turn_id = candidate.turn_id || entry.last_turn_id;
  entry.last_role = candidate.role || entry.last_role;
  entry.last_phase = candidate.phase || entry.last_phase;
}

function finalizeConnectorEntry(entry) {
  entry.last_attempt_at = entry._latest_attempt?.at || null;
  entry.latency_ms = entry._latest_attempt?.latency_ms ?? null;
  entry.attempts_made = entry._latest_attempt?.attempts_made ?? null;
  entry.last_success_at = entry._latest_success?.at || null;
  entry.last_failure_at = entry._latest_failure?.at || null;
  entry.last_error = entry._latest_failure?.error || null;

  const hasActive = entry.active_turn_ids.length > 0;
  const hasFailure = Boolean(entry._latest_failure);
  const hasSuccess = Boolean(entry._latest_success);

  if (hasActive && !hasFailure) {
    entry.state = 'active';
  } else {
    const failureMs = toMillis(entry.last_failure_at);
    const successMs = toMillis(entry.last_success_at);
    if (failureMs !== null && (successMs === null || failureMs >= successMs)) {
      entry.state = 'failing';
    } else if (hasSuccess || entry._latest_attempt?.final_outcome === 'success') {
      entry.state = 'healthy';
    } else if (hasActive) {
      entry.state = 'active';
    } else {
      entry.state = 'never_used';
    }
  }

  if (entry.type === 'local_cli') {
    entry.reachable = 'unknown';
  } else if (entry._latest_attempt?.final_outcome === 'success' || entry.state === 'healthy') {
    entry.reachable = 'yes';
  } else if (entry._latest_failure) {
    entry.reachable = 'no';
  } else {
    entry.reachable = 'unknown';
  }

  delete entry._latest_success;
  delete entry._latest_failure;
  delete entry._latest_attempt;
  delete entry._latest_identity;
  return entry;
}

export function getConnectorHealth(root, config, state) {
  const runtimeEntries = Object.entries(config?.runtimes || {})
    .filter(([, runtime]) => CONNECTOR_RUNTIME_TYPES.has(runtime?.type))
    .sort(([left], [right]) => left.localeCompare(right, 'en'));

  const connectors = runtimeEntries.map(([runtimeId, runtime]) => buildConnectorEntry(runtimeId, runtime));
  const connectorMap = Object.fromEntries(connectors.map((entry) => [entry.runtime_id, entry]));

  const turnRuntimeIndex = {};

  for (const turn of Object.values(state?.active_turns || {})) {
    if (!turn || typeof turn !== 'object') continue;
    const entry = connectorMap[turn.runtime_id];
    if (!entry) continue;
    if (typeof turn.turn_id === 'string') {
      turnRuntimeIndex[turn.turn_id] = turn.runtime_id;
      entry.active_turn_ids.push(turn.turn_id);
    }
    if (typeof turn.assigned_role === 'string' && !entry.active_roles.includes(turn.assigned_role)) {
      entry.active_roles.push(turn.assigned_role);
    }
    entry._latest_identity = chooseLatestDefined(entry._latest_identity, {
      turn_id: turn.turn_id || null,
      role: turn.assigned_role || null,
      phase: state?.phase || null,
    });
  }

  for (const entry of connectors) {
    entry.active_turn_ids.sort((a, b) => a.localeCompare(b, 'en'));
    entry.active_roles.sort((a, b) => a.localeCompare(b, 'en'));
  }

  const history = safeReadJsonl(join(root, HISTORY_PATH));
  for (const item of history) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const runtimeId = item.runtime_id;
    const entry = connectorMap[runtimeId];
    if (!entry) continue;

    if (typeof item.turn_id === 'string') {
      turnRuntimeIndex[item.turn_id] = runtimeId;
    }

    const acceptedAt = typeof item.accepted_at === 'string' ? item.accepted_at : null;
    if (!acceptedAt) continue;

    const successCandidate = {
      at: acceptedAt,
      turn_id: item.turn_id || null,
      role: item.role || null,
      phase: item.phase || null,
    };
    entry._latest_success = chooseLatest(entry._latest_success, successCandidate);
    entry._latest_identity = chooseLatestDefined(entry._latest_identity, successCandidate);
  }

  const stagingRoot = join(root, STAGING_DIR);
  if (existsSync(stagingRoot)) {
    for (const child of readdirSync(stagingRoot, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const turnId = child.name;
      const turnDir = join(stagingRoot, turnId);
      const trace = safeReadJson(join(turnDir, 'retry-trace.json'));
      const apiError = safeReadJson(join(turnDir, 'api-error.json'));
      const runtimeId = trace?.runtime_id || turnRuntimeIndex[turnId] || null;
      const entry = runtimeId ? connectorMap[runtimeId] : null;
      if (!entry) continue;

      const latestAttempt = getLatestAttemptFromTrace(trace);
      if (latestAttempt) {
        entry._latest_attempt = chooseLatest(entry._latest_attempt, latestAttempt);
        const identity = {
          turn_id: latestAttempt.turn_id || turnId,
          role: null,
          phase: null,
        };
        if (latestAttempt.final_outcome === 'success') {
          entry._latest_success = chooseLatest(entry._latest_success, {
            at: latestAttempt.at,
            turn_id: latestAttempt.turn_id || turnId,
            role: null,
            phase: null,
          });
        } else if (latestAttempt.final_outcome === 'failure' || latestAttempt.final_outcome === 'aborted') {
          entry._latest_failure = chooseLatest(entry._latest_failure, {
            at: latestAttempt.at,
            turn_id: latestAttempt.turn_id || turnId,
            role: null,
            phase: null,
            error: apiError?.message || latestAttempt.final_outcome,
          });
        }
        entry._latest_identity = chooseLatestDefined(entry._latest_identity, identity);
      }

      if (apiError && !latestAttempt) {
        const stats = statSync(turnDir);
        entry._latest_failure = chooseLatest(entry._latest_failure, {
          at: stats.mtime.toISOString(),
          turn_id: turnId,
          role: null,
          phase: null,
          error: apiError.message || apiError.error_class || 'runtime_error',
        });
        entry._latest_identity = chooseLatestDefined(entry._latest_identity, {
          turn_id: turnId,
          role: null,
          phase: null,
        });
      } else if (apiError && entry._latest_failure && entry._latest_failure.turn_id === turnId) {
        entry._latest_failure.error = apiError.message || apiError.error_class || entry._latest_failure.error;
      }
    }
  }

  const blockedTurnId = state?.blocked_reason?.turn_id || null;
  if (blockedTurnId && turnRuntimeIndex[blockedTurnId] && connectorMap[turnRuntimeIndex[blockedTurnId]]) {
    const entry = connectorMap[turnRuntimeIndex[blockedTurnId]];
    const detail = state?.blocked_reason?.recovery?.detail || state?.blocked_on || 'runtime_blocked';
    const blockedAt = state?.blocked_reason?.blocked_at || null;
    entry._latest_failure = chooseLatest(entry._latest_failure, {
      at: blockedAt,
      turn_id: blockedTurnId,
      role: null,
      phase: state?.phase || null,
      error: detail,
    });
    entry._latest_identity = chooseLatestDefined(entry._latest_identity, {
      turn_id: blockedTurnId,
      role: null,
      phase: state?.phase || null,
    });
  }

  return {
    connectors: connectors.map((entry) => {
      applyIdentityTarget(entry, entry._latest_failure || entry._latest_success || entry._latest_identity);
      return finalizeConnectorEntry(entry);
    }),
  };
}
