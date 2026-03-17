import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIG_FILE = 'agentxchain.json';
const LOCK_FILE = 'lock.json';
const STATE_FILE = 'state.json';

export function findProjectRoot(startDir = process.cwd()) {
  let dir = startDir;
  while (dir !== '/') {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    dir = join(dir, '..');
  }
  return null;
}

export function loadConfig(dir = process.cwd()) {
  const root = findProjectRoot(dir);
  if (!root) return null;
  const raw = readFileSync(join(root, CONFIG_FILE), 'utf8');
  return { root, config: JSON.parse(raw) };
}

export function loadLock(root) {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadState(root) {
  const path = join(root, STATE_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export { CONFIG_FILE, LOCK_FILE, STATE_FILE };
