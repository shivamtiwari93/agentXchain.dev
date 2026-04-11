const VALID_TRIGGERS = new Set([
  'manual',
  'continuation',
  'recovery',
  'intake',
  'schedule',
  'coordinator',
]);

const VALID_CREATORS = new Set([
  'operator',
  'coordinator',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeRunProvenance(value, { fallbackManual = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallbackManual ? buildDefaultRunProvenance() : null;
  }

  const trigger = normalizeString(value.trigger);
  const createdBy = normalizeString(value.created_by);
  const normalized = {
    trigger: VALID_TRIGGERS.has(trigger) ? trigger : (fallbackManual ? 'manual' : null),
    parent_run_id: normalizeString(value.parent_run_id),
    trigger_reason: normalizeString(value.trigger_reason),
    intake_intent_id: normalizeString(value.intake_intent_id),
    created_by: VALID_CREATORS.has(createdBy) ? createdBy : 'operator',
  };

  if (!normalized.trigger) {
    return fallbackManual ? buildDefaultRunProvenance() : null;
  }

  return normalized;
}

export function buildDefaultRunProvenance(overrides = {}) {
  return normalizeRunProvenance({
    trigger: 'manual',
    parent_run_id: null,
    trigger_reason: null,
    intake_intent_id: null,
    created_by: 'operator',
    ...overrides,
  }, { fallbackManual: true });
}

export function getRunTriggerLabel(provenance) {
  const normalized = normalizeRunProvenance(provenance);
  return normalized?.trigger || 'legacy';
}

export function summarizeRunProvenance(provenance) {
  const normalized = normalizeRunProvenance(provenance);
  if (!normalized) return null;

  const details = [];
  if (normalized.parent_run_id) {
    details.push(`from ${normalized.parent_run_id}`);
  }
  if (normalized.intake_intent_id) {
    details.push(`intent ${normalized.intake_intent_id}`);
  }

  const base = details.length > 0
    ? `${normalized.trigger} ${details.join(' ')}`
    : normalized.trigger;
  const creatorSuffix = normalized.created_by === 'coordinator'
    ? ' (created by coordinator)'
    : '';
  const reasonSuffix = normalized.trigger_reason
    ? ` ("${normalized.trigger_reason}")`
    : '';

  if (
    normalized.trigger === 'manual'
    && !normalized.parent_run_id
    && !normalized.intake_intent_id
    && !normalized.trigger_reason
    && normalized.created_by !== 'coordinator'
  ) {
    return null;
  }

  return `${base}${creatorSuffix}${reasonSuffix}`;
}
