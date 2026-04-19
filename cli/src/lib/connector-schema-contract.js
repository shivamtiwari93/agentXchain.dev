import { buildRuntimeCapabilityReport } from './runtime-capabilities.js';

export const CONFIG_SCHEMA_ARTIFACT = 'agentxchain/schemas/agentxchain-config';
export const CAPABILITIES_OUTPUT_SCHEMA_ARTIFACT = 'agentxchain/schemas/connector-capabilities-output';

export function buildConnectorSchemaContract(rawConfig, normalizedConfig, runtimeId, roleId) {
  const continuity = {
    raw_config_runtime_present: Boolean(rawConfig?.runtimes?.[runtimeId]),
    raw_role_present: Boolean(rawConfig?.roles?.[roleId]),
    raw_role_binding_matches_runtime: false,
    capabilities_report_runtime_matches: false,
    capabilities_report_role_binding_matches: false,
  };
  const failures = [];

  const rawRole = rawConfig?.roles?.[roleId];
  if (continuity.raw_role_present) {
    continuity.raw_role_binding_matches_runtime = rawRole?.runtime === runtimeId;
  }

  const report = buildRuntimeCapabilityReport(
    runtimeId,
    normalizedConfig?.runtimes?.[runtimeId],
    normalizedConfig?.roles || {}
  );
  continuity.capabilities_report_runtime_matches = report.runtime_id === runtimeId;
  continuity.capabilities_report_role_binding_matches = report.role_bindings.some(
    (binding) => binding.role_id === roleId
  );

  if (!continuity.raw_config_runtime_present) {
    failures.push(`Raw config does not define runtime "${runtimeId}".`);
  }
  if (!continuity.raw_role_present) {
    failures.push(`Raw config does not define role "${roleId}".`);
  } else if (!continuity.raw_role_binding_matches_runtime) {
    failures.push(
      `Raw role binding mismatch: roles.${roleId}.runtime is "${rawRole.runtime}" instead of "${runtimeId}".`
    );
  }
  if (!continuity.capabilities_report_runtime_matches) {
    failures.push(`Capability report emitted runtime "${report.runtime_id}" instead of "${runtimeId}".`);
  }
  if (!continuity.capabilities_report_role_binding_matches) {
    failures.push(`Capability report omitted the "${roleId}" binding under runtime "${runtimeId}".`);
  }

  return {
    ok: failures.length === 0,
    config_schema_artifact: CONFIG_SCHEMA_ARTIFACT,
    capabilities_output_schema_artifact: CAPABILITIES_OUTPUT_SCHEMA_ARTIFACT,
    runtime_id: runtimeId,
    role_id: roleId,
    continuity,
    failures,
  };
}
