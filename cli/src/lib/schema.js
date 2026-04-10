/**
 * Lightweight schema validation for AgentXchain protocol files.
 * No external dependencies — validates shape and types only.
 */

export function validateLockSchema(data) {
  const errors = [];
  if (data === null || typeof data !== 'object') {
    return { ok: false, errors: ['lock.json must be a JSON object'] };
  }
  if (!('holder' in data)) errors.push('Missing field: holder');
  else if (data.holder !== null && typeof data.holder !== 'string') errors.push('holder must be a string or null');
  if (!('turn_number' in data)) errors.push('Missing field: turn_number');
  else if (typeof data.turn_number !== 'number' || !Number.isInteger(data.turn_number)) errors.push('turn_number must be an integer');
  if (!('last_released_by' in data)) errors.push('Missing field: last_released_by');
  else if (data.last_released_by !== null && typeof data.last_released_by !== 'string') errors.push('last_released_by must be a string or null');
  if (!('claimed_at' in data)) errors.push('Missing field: claimed_at');
  else if (data.claimed_at !== null && typeof data.claimed_at !== 'string') errors.push('claimed_at must be a string or null');
  return { ok: errors.length === 0, errors };
}

export function validateStateSchema(data) {
  const errors = [];
  if (data === null || typeof data !== 'object') {
    return { ok: false, errors: ['state.json must be a JSON object'] };
  }
  if (typeof data.phase !== 'string') errors.push('phase must be a string');
  if (typeof data.blocked !== 'boolean' && data.blocked !== undefined) errors.push('blocked must be a boolean');
  return { ok: errors.length === 0, errors };
}

export function validateGovernedStateSchema(data) {
  const errors = [];
  // Keep `failed` for compatibility. Current governed writers do not emit it,
  // but validators and read-only surfaces still tolerate reserved/manual states.
  const VALID_RUN_STATUSES = ['idle', 'active', 'paused', 'blocked', 'completed', 'failed'];
  const isV1_1 = data?.schema_version === '1.1';
  const hasLegacyCurrentTurn = Object.prototype.hasOwnProperty.call(data || {}, 'current_turn');

  function validateTurn(turn, label) {
    if (typeof turn !== 'object' || Array.isArray(turn)) {
      errors.push(`${label} must be an object`);
      return;
    }

    if (typeof turn.turn_id !== 'string' || !turn.turn_id.trim()) errors.push(`${label}.turn_id must be a non-empty string`);
    if (typeof turn.assigned_role !== 'string' || !turn.assigned_role.trim()) errors.push(`${label}.assigned_role must be a non-empty string`);
    if (typeof turn.status !== 'string' || !turn.status.trim()) errors.push(`${label}.status must be a non-empty string`);
    if (typeof turn.runtime_id !== 'string' || !turn.runtime_id.trim()) errors.push(`${label}.runtime_id must be a non-empty string`);
    if (typeof turn.attempt !== 'number' || !Number.isInteger(turn.attempt)) errors.push(`${label}.attempt must be an integer`);
    if (isV1_1 && (!Number.isInteger(turn.assigned_sequence) || turn.assigned_sequence < 1)) {
      errors.push(`${label}.assigned_sequence must be an integer >= 1`);
    }
  }

  if (data === null || typeof data !== 'object') {
    return { ok: false, errors: ['governed state must be a JSON object'] };
  }

  const hasRunId = typeof data.run_id === 'string' && data.run_id.trim();
  const hasNoActiveTurn = isV1_1
    ? data.active_turns && typeof data.active_turns === 'object' && !Array.isArray(data.active_turns)
      ? Object.keys(data.active_turns).length === 0
      : false
    : data.current_turn === null;
  const isUninitializedIdle = data.run_id === null && data.status === 'idle' && hasNoActiveTurn;
  if (!hasRunId && !isUninitializedIdle) {
    errors.push('run_id must be a non-empty string, or null only for an idle state with no active turn');
  }
  if (typeof data.project_id !== 'string' || !data.project_id.trim()) errors.push('project_id must be a non-empty string');
  if (typeof data.status !== 'string' || !data.status.trim()) {
    errors.push('status must be a non-empty string');
  } else if (!VALID_RUN_STATUSES.includes(data.status)) {
    errors.push(`status must be one of: ${VALID_RUN_STATUSES.join(', ')}`);
  }
  if (typeof data.phase !== 'string' || !data.phase.trim()) errors.push('phase must be a non-empty string');

  if (isV1_1) {
    if (hasLegacyCurrentTurn) {
      errors.push('current_turn is not allowed when schema_version is "1.1"; use active_turns');
    }
    if (!data.active_turns || typeof data.active_turns !== 'object' || Array.isArray(data.active_turns)) {
      errors.push('active_turns must be an object when schema_version is "1.1"');
    } else {
      for (const [turnId, turn] of Object.entries(data.active_turns)) {
        validateTurn(turn, `active_turns.${turnId}`);
      }
    }
    if (!Number.isInteger(data.turn_sequence) || data.turn_sequence < 0) {
      errors.push('turn_sequence must be an integer >= 0 when schema_version is "1.1"');
    }
  } else if ('current_turn' in data && data.current_turn !== null) {
    validateTurn(data.current_turn, 'current_turn');
  }

  if ('phase_gate_status' in data && data.phase_gate_status !== null && typeof data.phase_gate_status !== 'object') {
    errors.push('phase_gate_status must be an object');
  }
  if ('budget_status' in data && data.budget_status !== null && typeof data.budget_status !== 'object') {
    errors.push('budget_status must be an object');
  }
  if (isV1_1 && 'budget_reservations' in data && data.budget_reservations !== null && typeof data.budget_reservations !== 'object') {
    errors.push('budget_reservations must be an object when provided');
  }

  if (data.status === 'blocked') {
    if (typeof data.blocked_on !== 'string' || !data.blocked_on.trim()) {
      errors.push('blocked_on must be a non-empty string when status is "blocked"');
    }
    if (!data.blocked_reason || typeof data.blocked_reason !== 'object') {
      errors.push('blocked_reason must be an object when status is "blocked"');
    } else {
      if (typeof data.blocked_reason.category !== 'string' || !data.blocked_reason.category.trim()) {
        errors.push('blocked_reason.category must be a non-empty string');
      }
      if (typeof data.blocked_reason.blocked_at !== 'string' || !data.blocked_reason.blocked_at.trim()) {
        errors.push('blocked_reason.blocked_at must be a non-empty string');
      }
      if (!('turn_id' in data.blocked_reason) || (data.blocked_reason.turn_id !== null && typeof data.blocked_reason.turn_id !== 'string')) {
        errors.push('blocked_reason.turn_id must be a string or null');
      }
      const recovery = data.blocked_reason.recovery;
      if (!recovery || typeof recovery !== 'object') {
        errors.push('blocked_reason.recovery must be an object');
      } else {
        if (typeof recovery.typed_reason !== 'string' || !recovery.typed_reason.trim()) errors.push('blocked_reason.recovery.typed_reason must be a non-empty string');
        if (typeof recovery.owner !== 'string' || !recovery.owner.trim()) errors.push('blocked_reason.recovery.owner must be a non-empty string');
        if (typeof recovery.recovery_action !== 'string' || !recovery.recovery_action.trim()) errors.push('blocked_reason.recovery.recovery_action must be a non-empty string');
        if (typeof recovery.turn_retained !== 'boolean') errors.push('blocked_reason.recovery.turn_retained must be a boolean');
        if ('detail' in recovery && recovery.detail !== null && typeof recovery.detail !== 'string') {
          errors.push('blocked_reason.recovery.detail must be a string or null');
        }
      }
    }
  }

  if (data.status === 'paused' && !data.pending_phase_transition && !data.pending_run_completion) {
    errors.push('paused state must include pending_phase_transition or pending_run_completion');
  }

  if (data.status === 'active' && data.blocked_on != null) {
    errors.push('active state must not include blocked_on');
  }

  return { ok: errors.length === 0, errors };
}

export function validateProjectStateSchema(data) {
  if (data && typeof data === 'object' && ('run_id' in data || 'current_turn' in data || 'active_turns' in data || 'phase_gate_status' in data)) {
    return validateGovernedStateSchema(data);
  }
  return validateStateSchema(data);
}

export function validateConfigSchema(data) {
  const errors = [];
  if (data === null || typeof data !== 'object') {
    return { ok: false, errors: ['agentxchain.json must be a JSON object'] };
  }
  if (data.version !== 3) errors.push('version must be 3');
  if (typeof data.project !== 'string' || !data.project.trim()) errors.push('project must be a non-empty string');
  if (!data.agents || typeof data.agents !== 'object') {
    errors.push('agents must be an object');
  } else {
    for (const [id, agent] of Object.entries(data.agents)) {
      if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`Invalid agent id: "${id}" (must be lowercase alphanumeric, hyphens, underscores)`);
      if (!agent || typeof agent !== 'object') { errors.push(`Agent "${id}" must be an object`); continue; }
      if (typeof agent.name !== 'string' || !agent.name.trim()) errors.push(`Agent "${id}": name must be a non-empty string`);
      if (typeof agent.mandate !== 'string' || !agent.mandate.trim()) errors.push(`Agent "${id}": mandate must be a non-empty string`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Safely parse JSON with schema validation.
 * Returns { ok, data, errors }.
 */
export function safeParseJson(raw, validator) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, data: null, errors: [`Invalid JSON: ${err.message}`] };
  }
  if (validator) {
    const result = validator(data);
    return { ok: result.ok, data, errors: result.errors };
  }
  return { ok: true, data, errors: [] };
}
