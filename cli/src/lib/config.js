import { readFileSync, existsSync } from 'fs';
import { join, parse as pathParse, resolve } from 'path';
import { safeParseJson, validateConfigSchema, validateLockSchema, validateProjectStateSchema, validateStateSchema } from './schema.js';
import { loadNormalizedConfig } from './normalized-config.js';

const CONFIG_FILE = 'agentxchain.json';
const LOCK_FILE = 'lock.json';
const STATE_FILE = 'state.json';

export function findProjectRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);
  const { root: fsRoot } = pathParse(dir);
  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    if (dir === fsRoot) return null;
    dir = join(dir, '..');
  }
}

export function loadConfig(dir = process.cwd()) {
  const root = findProjectRoot(dir);
  if (!root) return null;
  const filePath = join(root, CONFIG_FILE);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const result = safeParseJson(raw, validateConfigSchema);
  if (!result.ok) {
    console.error(`  Warning: agentxchain.json has issues: ${result.errors.join(', ')}`);
    return null;
  }
  return { root, config: result.data };
}

export function loadProjectContext(dir = process.cwd()) {
  const root = findProjectRoot(dir);
  if (!root) return null;

  const filePath = join(root, CONFIG_FILE);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`  Warning: agentxchain.json is invalid JSON: ${err.message}`);
    return null;
  }

  const normalized = loadNormalizedConfig(parsed);
  if (!normalized.ok) {
    console.error(`  Warning: agentxchain.json has issues: ${normalized.errors.join(', ')}`);
    return null;
  }

  return {
    root,
    rawConfig: parsed,
    config: normalized.normalized,
    version: normalized.version,
  };
}

export function loadLock(root) {
  const filePath = join(root, LOCK_FILE);
  if (!existsSync(filePath)) return null;
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const result = safeParseJson(raw, validateLockSchema);
  if (!result.ok) {
    console.error(`  Warning: lock.json has issues: ${result.errors.join(', ')}`);
    return null;
  }
  return result.data;
}

export function loadState(root) {
  const filePath = join(root, STATE_FILE);
  if (!existsSync(filePath)) return null;
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const result = safeParseJson(raw, validateStateSchema);
  if (!result.ok) {
    console.error(`  Warning: state.json has issues: ${result.errors.join(', ')}`);
    return null;
  }
  return result.data;
}

export function loadProjectState(root, config) {
  const relPath = config?.files?.state || STATE_FILE;
  const filePath = join(root, relPath);
  if (!existsSync(filePath)) return null;

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const result = safeParseJson(raw, validateProjectStateSchema);
  if (!result.ok) {
    console.error(`  Warning: ${relPath} has issues: ${result.errors.join(', ')}`);
    return null;
  }
  return result.data;
}

export { CONFIG_FILE, LOCK_FILE, STATE_FILE };
