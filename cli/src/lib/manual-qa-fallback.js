/**
 * Narrow recovery hint for the built-in manual QA fallback path.
 *
 * The check must use normalized config so operator-facing guidance stays
 * consistent across commands and does not depend on raw config exceptions.
 */
export function shouldSuggestManualQaFallback({
  roleId,
  runtimeId,
  classified,
  config,
}) {
  return classified?.error_class === 'missing_credentials'
    && roleId === 'qa'
    && runtimeId === 'api-qa'
    && config?.roles?.qa?.runtime_id === 'api-qa'
    && config?.runtimes?.['manual-qa']?.type === 'manual';
}
