/**
 * State reader — reads .agentxchain/ state files for the dashboard bridge.
 *
 * All reads are synchronous and return parsed data or null for missing files.
 * The bridge server calls these on each API request (no caching — files are
 * small and change infrequently relative to HTTP request rate).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const STATE_FILE = 'state.json';
const HISTORY_FILE = 'history.jsonl';
const LEDGER_FILE = 'decision-ledger.jsonl';
const HOOK_AUDIT_FILE = 'hook-audit.jsonl';
const HOOK_ANNOTATIONS_FILE = 'hook-annotations.jsonl';

/**
 * Map of API resource paths to their .agentxchain/ file names.
 */
export const RESOURCE_MAP = {
  '/api/state': STATE_FILE,
  '/api/history': HISTORY_FILE,
  '/api/ledger': LEDGER_FILE,
  '/api/hooks/audit': HOOK_AUDIT_FILE,
  '/api/hooks/annotations': HOOK_ANNOTATIONS_FILE,
};

/**
 * Reverse map: file basename → API resource path.
 */
export const FILE_TO_RESOURCE = Object.fromEntries(
  Object.entries(RESOURCE_MAP).map(([resource, file]) => [file, resource])
);

/**
 * Read a JSON file. Returns parsed object or null if file doesn't exist.
 * Throws on malformed JSON.
 */
export function readJsonFile(agentxchainDir, filename) {
  const filePath = join(agentxchainDir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return null;
  return JSON.parse(content);
}

/**
 * Read a JSONL file. Returns array of parsed objects or null if file doesn't exist.
 * Throws on malformed JSON in any line.
 */
export function readJsonlFile(agentxchainDir, filename) {
  const filePath = join(agentxchainDir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/**
 * Read a resource by its API path. Returns { data, format } or null.
 */
export function readResource(agentxchainDir, resourcePath) {
  const filename = RESOURCE_MAP[resourcePath];
  if (!filename) return null;

  if (filename.endsWith('.jsonl')) {
    const data = readJsonlFile(agentxchainDir, filename);
    return data !== null ? { data, format: 'jsonl' } : null;
  }
  const data = readJsonFile(agentxchainDir, filename);
  return data !== null ? { data, format: 'json' } : null;
}
