/**
 * Lightweight staged turn-result shape guard.
 *
 * This is intentionally weaker than full acceptance validation. It exists for
 * adapter pre-stage checks so obviously incomplete payloads (`{}`,
 * `{"turn_id":"t1"}`, etc.) are rejected before they can be written into the
 * governed staging path and mistaken for meaningful execution output.
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Returns true when `value` has the minimum governed turn-result envelope:
 *   - `schema_version`
 *   - at least one identity field (`run_id` or `turn_id`)
 *   - at least one lifecycle field (`status`, `role`, or `runtime_id`)
 *
 * Full schema validation still happens later via `validateStagedTurnResult`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasMinimumTurnResultShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = /** @type {Record<string, unknown>} */ (value);
  const hasSchemaVersion = isNonEmptyString(candidate.schema_version);
  const hasIdentity = isNonEmptyString(candidate.run_id) || isNonEmptyString(candidate.turn_id);
  const hasLifecycle = isNonEmptyString(candidate.status)
    || isNonEmptyString(candidate.role)
    || isNonEmptyString(candidate.runtime_id);

  return hasSchemaVersion && hasIdentity && hasLifecycle;
}
