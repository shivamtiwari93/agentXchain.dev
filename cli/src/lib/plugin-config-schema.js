import { isDeepStrictEqual } from 'node:util';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatPath(path) {
  return path || 'config';
}

function typeMatches(expected, value) {
  switch (expected) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function validateAgainstSchema(schema, value, path, errors) {
  if (!isPlainObject(schema)) {
    errors.push(`${formatPath(path)}: schema must be an object`);
    return;
  }

  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type];

  if (expectedTypes.length > 0) {
    const validTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
    const invalidType = expectedTypes.find((type) => !validTypes.has(type));
    if (invalidType) {
      errors.push(`${formatPath(path)}: unsupported schema type "${invalidType}"`);
      return;
    }

    const matched = expectedTypes.some((type) => typeMatches(type, value));
    if (!matched) {
      errors.push(
        `${formatPath(path)}: expected ${expectedTypes.join(' | ')}, got ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`,
      );
      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => isDeepStrictEqual(candidate, value))) {
    errors.push(`${formatPath(path)}: must match one of the configured enum values`);
  }

  if ('const' in schema && !isDeepStrictEqual(schema.const, value)) {
    errors.push(`${formatPath(path)}: must equal the configured constant value`);
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${formatPath(path)}: must be at least ${schema.minLength} characters`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${formatPath(path)}: must be at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!(new RegExp(schema.pattern).test(value))) {
          errors.push(`${formatPath(path)}: must match pattern ${schema.pattern}`);
        }
      } catch {
        errors.push(`${formatPath(path)}: schema pattern is invalid`);
      }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${formatPath(path)}: must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${formatPath(path)}: must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${formatPath(path)}: must contain at least ${schema.minItems} items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${formatPath(path)}: must contain at most ${schema.maxItems} items`);
    }
    if ('items' in schema) {
      for (let i = 0; i < value.length; i++) {
        validateAgainstSchema(schema.items, value[i], `${formatPath(path)}[${i}]`, errors);
      }
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${formatPath(path)}.${key}: is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) {
        validateAgainstSchema(childSchema, value[key], `${formatPath(path)}.${key}`, errors);
      }
    }

    const extraKeys = Object.keys(value).filter((key) => !(key in properties));
    if (schema.additionalProperties === false && extraKeys.length > 0) {
      for (const key of extraKeys) {
        errors.push(`${formatPath(path)}.${key}: additional property is not allowed`);
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of extraKeys) {
        validateAgainstSchema(schema.additionalProperties, value[key], `${formatPath(path)}.${key}`, errors);
      }
    }
  }
}

export function validatePluginConfigAgainstSchema(schema, config, path = 'config') {
  const errors = [];
  validateAgainstSchema(schema, config, path, errors);
  return errors;
}

export function validatePluginConfigInput(schema, config, label = 'plugin config') {
  if (schema === null || schema === undefined) {
    if (config === undefined) {
      return { ok: true, value: undefined, errors: [] };
    }
    return {
      ok: false,
      value: undefined,
      errors: [`${label}: config provided but plugin does not declare config_schema`],
    };
  }

  const candidate = config === undefined ? {} : config;
  const errors = validatePluginConfigAgainstSchema(schema, candidate, label);
  return {
    ok: errors.length === 0,
    value: candidate,
    errors,
  };
}

export function validateInstalledPluginConfigs(rawConfig) {
  const errors = [];
  const plugins = isPlainObject(rawConfig?.plugins) ? rawConfig.plugins : {};

  for (const [name, meta] of Object.entries(plugins)) {
    if (!isPlainObject(meta)) {
      errors.push(`plugins.${name}: metadata must be an object`);
      continue;
    }

    if ('config' in meta && meta.config !== undefined && !('config_schema' in meta)) {
      errors.push(`plugins.${name}.config: present but plugin metadata is missing config_schema`);
      continue;
    }

    if ('config_schema' in meta && meta.config_schema !== undefined) {
      const validation = validatePluginConfigInput(
        meta.config_schema,
        meta.config,
        `plugins.${name}.config`,
      );
      errors.push(...validation.errors);
    }
  }

  return { ok: errors.length === 0, errors };
}
