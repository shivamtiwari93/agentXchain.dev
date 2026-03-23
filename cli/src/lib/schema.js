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
