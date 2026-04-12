export const CURRENT_PROTOCOL_VERSION = 'v6';
export const CURRENT_CONFIG_GENERATION = 4;

export function getGovernedConfigSchemaVersion(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return null;
  }

  if (typeof rawConfig.schema_version === 'string' && rawConfig.schema_version.trim()) {
    return rawConfig.schema_version.trim();
  }

  if (rawConfig.schema_version === 4) {
    return '1.0';
  }

  return null;
}

export function getGovernedVersionSurface(rawConfig) {
  return {
    protocol_version: CURRENT_PROTOCOL_VERSION,
    config_generation: CURRENT_CONFIG_GENERATION,
    config_schema_version: getGovernedConfigSchemaVersion(rawConfig),
  };
}

export function formatGovernedVersionLabel(rawConfig) {
  const surface = getGovernedVersionSurface(rawConfig);
  const parts = [
    `protocol ${surface.protocol_version}`,
    `config generation v${surface.config_generation}`,
  ];

  if (surface.config_schema_version) {
    parts.push(`config schema ${surface.config_schema_version}`);
  }

  return parts.join(', ');
}
