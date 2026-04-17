/**
 * Timeout evaluator for governed runs.
 *
 * Checks per-turn, per-phase, and per-run time limits at governance boundaries.
 * Returns timeout results that callers use to escalate, warn, or skip.
 */

const VALID_TIMEOUT_ACTIONS = ['escalate', 'warn', 'skip_phase'];

/**
 * Evaluate all configured timeouts against the current state.
 *
 * @param {object} options
 * @param {object} options.config - Normalized config with optional `timeouts` section
 * @param {object} options.state - Current governed state
 * @param {object} [options.turn] - Active turn metadata being accepted (for per-turn check)
 * @param {object} [options.turnResult] - Accepted turn result (legacy fallback for tests)
 * @param {Date|string} [options.now] - Override for current time (testing)
 * @returns {{ exceeded: Array<TimeoutResult>, warnings: Array<TimeoutResult> }}
 */
export function evaluateTimeouts({ config, state, turn = null, turnResult = null, now = new Date() }) {
  const timeouts = config.timeouts;
  if (!timeouts) return { exceeded: [], warnings: [] };

  const nowMs = typeof now === 'string' ? new Date(now).getTime() : now.getTime();
  const exceeded = [];
  const warnings = [];

  // Per-turn timeout
  if (timeouts.per_turn_minutes) {
    const startedAt = turn?.started_at || turn?.assigned_at || turnResult?.dispatched_at || turnResult?.assigned_at;
    if (startedAt) {
      const dispatchMs = new Date(startedAt).getTime();
      const limitMs = timeouts.per_turn_minutes * 60 * 1000;
      const elapsedMs = nowMs - dispatchMs;
      if (elapsedMs > limitMs) {
        const result = {
          scope: 'turn',
          limit_minutes: timeouts.per_turn_minutes,
          elapsed_minutes: Math.round(elapsedMs / 60000),
          exceeded_by_minutes: Math.round((elapsedMs - limitMs) / 60000),
          action: resolveAction(timeouts.action, 'turn'),
        };
        if (result.action === 'warn') {
          warnings.push(result);
        } else {
          exceeded.push(result);
        }
      }
    }
  }

  // Per-phase timeout
  const phaseLimit = resolvePhaseLimit(timeouts, config.routing, state.phase);
  const phaseAction = resolvePhaseAction(timeouts, config.routing, state.phase);
  if (phaseLimit) {
    const phaseEnteredAt = findPhaseEntryTime(state);
    if (phaseEnteredAt) {
      const entryMs = new Date(phaseEnteredAt).getTime();
      const limitMs = phaseLimit * 60 * 1000;
      const elapsedMs = nowMs - entryMs;
      if (elapsedMs > limitMs) {
        const result = {
          scope: 'phase',
          phase: state.phase,
          limit_minutes: phaseLimit,
          elapsed_minutes: Math.round(elapsedMs / 60000),
          exceeded_by_minutes: Math.round((elapsedMs - limitMs) / 60000),
          action: phaseAction,
        };
        if (result.action === 'warn') {
          warnings.push(result);
        } else {
          exceeded.push(result);
        }
      }
    }
  }

  // Per-run timeout
  if (timeouts.per_run_minutes) {
    const createdAt = state.created_at;
    if (createdAt) {
      const createMs = new Date(createdAt).getTime();
      const limitMs = timeouts.per_run_minutes * 60 * 1000;
      const elapsedMs = nowMs - createMs;
      if (elapsedMs > limitMs) {
        const result = {
          scope: 'run',
          limit_minutes: timeouts.per_run_minutes,
          elapsed_minutes: Math.round(elapsedMs / 60000),
          exceeded_by_minutes: Math.round((elapsedMs - limitMs) / 60000),
          action: resolveAction(timeouts.action, 'run'),
        };
        if (result.action === 'warn') {
          warnings.push(result);
        } else {
          exceeded.push(result);
        }
      }
    }
  }

  return { exceeded, warnings };
}

/**
 * Resolve the phase-level timeout limit.
 * Per-phase routing override takes precedence over global per_phase_minutes.
 */
function resolvePhaseLimit(timeouts, routing, phase) {
  if (routing && routing[phase] && typeof routing[phase].timeout_minutes === 'number') {
    return routing[phase].timeout_minutes;
  }
  return timeouts.per_phase_minutes || null;
}

/**
 * Resolve the phase-level timeout action.
 * Per-phase routing override takes precedence over global action.
 */
function resolvePhaseAction(timeouts, routing, phase) {
  if (routing && routing[phase] && routing[phase].timeout_action) {
    return routing[phase].timeout_action;
  }
  return timeouts.action || 'escalate';
}

/**
 * Resolve the effective action, enforcing that skip_phase is only valid for phase scope.
 */
function resolveAction(action, scope) {
  if (action === 'skip_phase' && scope !== 'phase') {
    return 'escalate';
  }
  return action || 'escalate';
}

/**
 * Find when the current phase was entered.
 * Uses phase_entered_at if available, otherwise falls back to created_at for the first phase.
 */
function findPhaseEntryTime(state) {
  if (state.phase_entered_at) return state.phase_entered_at;
  // Fallback for first phase: use run creation time
  return state.created_at || null;
}

/**
 * Validate the timeouts config section.
 * Returns { ok, errors }.
 */
export function validateTimeoutsConfig(timeouts, routing) {
  const errors = [];

  if (timeouts === null || timeouts === undefined) {
    return { ok: true, errors: [] };
  }

  if (typeof timeouts !== 'object' || Array.isArray(timeouts)) {
    errors.push('timeouts must be an object');
    return { ok: false, errors };
  }

  if ('per_turn_minutes' in timeouts) {
    if (typeof timeouts.per_turn_minutes !== 'number' || timeouts.per_turn_minutes < 1) {
      errors.push('timeouts.per_turn_minutes must be a number >= 1');
    }
  }

  if ('per_phase_minutes' in timeouts) {
    if (typeof timeouts.per_phase_minutes !== 'number' || timeouts.per_phase_minutes < 1) {
      errors.push('timeouts.per_phase_minutes must be a number >= 1');
    }
  }

  if ('per_run_minutes' in timeouts) {
    if (typeof timeouts.per_run_minutes !== 'number' || timeouts.per_run_minutes < 1) {
      errors.push('timeouts.per_run_minutes must be a number >= 1');
    }
  }

  if ('action' in timeouts) {
    if (!VALID_TIMEOUT_ACTIONS.includes(timeouts.action)) {
      errors.push(`timeouts.action must be one of: escalate, warn`);
    }
    if (timeouts.action === 'skip_phase') {
      // skip_phase is only valid as a per-phase override, not as a global default
      // because it makes no sense for per-turn or per-run timeouts
      errors.push('timeouts.action cannot be "skip_phase" at the global level — use per-phase timeout_action override in routing instead');
    }
  }

  // Per-phase timeout overrides in routing
  if (routing) {
    for (const [phase, route] of Object.entries(routing)) {
      if ('timeout_minutes' in route) {
        if (typeof route.timeout_minutes !== 'number' || route.timeout_minutes < 1) {
          errors.push(`Routing "${phase}": timeout_minutes must be a number >= 1`);
        }
      }
      if ('timeout_action' in route) {
        if (!VALID_TIMEOUT_ACTIONS.includes(route.timeout_action)) {
          errors.push(`Routing "${phase}": timeout_action must be one of: ${VALID_TIMEOUT_ACTIONS.join(', ')}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Compute remaining timeout budget for an active turn/phase/run.
 *
 * Unlike evaluateTimeouts() which only returns items when exceeded,
 * this returns budget info for ALL configured timeout scopes regardless
 * of whether the deadline has passed.
 *
 * @param {object} options
 * @param {object} options.config - Normalized config with optional `timeouts` section
 * @param {object} options.state - Current governed state
 * @param {object} [options.turn] - Active turn metadata
 * @param {Date|string} [options.now] - Override for current time (testing)
 * @returns {Array<TimeoutBudget>} Array of { scope, limit_minutes, elapsed_minutes, remaining_minutes, deadline_iso, exceeded, action }
 */
export function computeTimeoutBudget({ config, state, turn = null, now = new Date() }) {
  const timeouts = config?.timeouts;
  if (!timeouts) return [];

  const nowMs = typeof now === 'string' ? new Date(now).getTime() : now.getTime();
  const budgets = [];

  // Per-turn budget
  if (timeouts.per_turn_minutes && turn) {
    const startedAt = turn.started_at || turn.assigned_at;
    if (startedAt) {
      const dispatchMs = new Date(startedAt).getTime();
      const limitMs = timeouts.per_turn_minutes * 60 * 1000;
      const elapsedMs = nowMs - dispatchMs;
      const remainingMs = limitMs - elapsedMs;
      budgets.push({
        scope: 'turn',
        limit_minutes: timeouts.per_turn_minutes,
        elapsed_minutes: Math.round(elapsedMs / 60000),
        remaining_minutes: Math.max(0, Math.round(remainingMs / 60000)),
        remaining_seconds: Math.max(0, Math.round(remainingMs / 1000)),
        deadline_iso: new Date(dispatchMs + limitMs).toISOString(),
        exceeded: elapsedMs > limitMs,
        action: resolveAction(timeouts.action, 'turn'),
      });
    }
  }

  // Per-phase budget
  const phaseLimit = resolvePhaseLimit(timeouts, config.routing, state.phase);
  const phaseAction = resolvePhaseAction(timeouts, config.routing, state.phase);
  if (phaseLimit) {
    const phaseEnteredAt = findPhaseEntryTime(state);
    if (phaseEnteredAt) {
      const entryMs = new Date(phaseEnteredAt).getTime();
      const limitMs = phaseLimit * 60 * 1000;
      const elapsedMs = nowMs - entryMs;
      const remainingMs = limitMs - elapsedMs;
      budgets.push({
        scope: 'phase',
        phase: state.phase,
        limit_minutes: phaseLimit,
        elapsed_minutes: Math.round(elapsedMs / 60000),
        remaining_minutes: Math.max(0, Math.round(remainingMs / 60000)),
        remaining_seconds: Math.max(0, Math.round(remainingMs / 1000)),
        deadline_iso: new Date(entryMs + limitMs).toISOString(),
        exceeded: elapsedMs > limitMs,
        action: phaseAction,
      });
    }
  }

  // Per-run budget
  if (timeouts.per_run_minutes && state.created_at) {
    const createMs = new Date(state.created_at).getTime();
    const limitMs = timeouts.per_run_minutes * 60 * 1000;
    const elapsedMs = nowMs - createMs;
    const remainingMs = limitMs - elapsedMs;
    budgets.push({
      scope: 'run',
      limit_minutes: timeouts.per_run_minutes,
      elapsed_minutes: Math.round(elapsedMs / 60000),
      remaining_minutes: Math.max(0, Math.round(remainingMs / 60000)),
      remaining_seconds: Math.max(0, Math.round(remainingMs / 1000)),
      deadline_iso: new Date(createMs + limitMs).toISOString(),
      exceeded: elapsedMs > limitMs,
      action: resolveAction(timeouts.action, 'run'),
    });
  }

  return budgets;
}

/**
 * Build a blocked_reason descriptor for a timeout.
 */
export function buildTimeoutBlockedReason(timeoutResult, options = {}) {
  const scopeLabel = timeoutResult.scope === 'turn'
    ? 'Turn timeout'
    : timeoutResult.scope === 'phase'
      ? `Phase timeout (${timeoutResult.phase || 'unknown'})`
      : 'Run timeout';
  const turnRetained = options.turnRetained === true;

  return {
    category: 'timeout',
    recovery: {
      typed_reason: 'timeout',
      owner: 'operator',
      recovery_action: 'agentxchain resume',
      turn_retained: turnRetained,
      detail: `${scopeLabel}: limit was ${timeoutResult.limit_minutes}m, elapsed ${timeoutResult.elapsed_minutes}m (exceeded by ${timeoutResult.exceeded_by_minutes}m)`,
    },
  };
}
