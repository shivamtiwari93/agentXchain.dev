/**
 * Project Registry — file-backed registry mapping project IDs to root directories.
 *
 * Persists to <primaryRoot>/.agentxchain/org-registry.json.
 * The primary project is always registered and cannot be unregistered.
 *
 * @module project-registry
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Derive a deterministic project ID from a normalized absolute path.
 * Uses first 12 hex chars of SHA-256.
 */
function deriveProjectId(absolutePath) {
  const normalized = resolve(absolutePath);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Create a project registry persisted in the primary project's .agentxchain/ directory.
 * @param {string} primaryRoot - primary project root (always registered)
 * @returns {ProjectRegistry}
 */
export function createProjectRegistry(primaryRoot) {
  const normalizedPrimary = resolve(primaryRoot);
  const axDir = join(normalizedPrimary, '.agentxchain');
  const registryPath = join(axDir, 'org-registry.json');

  /** @type {Map<string, RegistryEntry>} */
  const entries = new Map();

  // Always register the primary project
  const primaryId = deriveProjectId(normalizedPrimary);
  entries.set(primaryId, {
    id: primaryId,
    name: basename(normalizedPrimary),
    root: normalizedPrimary,
    is_primary: true,
    registered_at: Date.now(),
  });

  // Try to load existing registry from disk
  load();

  function load() {
    try {
      if (!existsSync(registryPath)) return;
      const raw = readFileSync(registryPath, 'utf8').trim();
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.projects)) return;
      for (const proj of data.projects) {
        if (!proj.id || !proj.root) continue;
        entries.set(proj.id, {
          id: proj.id,
          name: proj.name || basename(proj.root),
          root: proj.root,
          is_primary: proj.id === primaryId,
          registered_at: proj.registered_at || Date.now(),
        });
      }
      // Ensure primary is always present
      if (!entries.has(primaryId)) {
        entries.set(primaryId, {
          id: primaryId,
          name: basename(normalizedPrimary),
          root: normalizedPrimary,
          is_primary: true,
          registered_at: Date.now(),
        });
      }
    } catch {
      // Graceful: corrupt file → keep primary-only registry
    }
  }

  function save() {
    try {
      if (!existsSync(axDir)) {
        mkdirSync(axDir, { recursive: true });
      }
      const data = {
        version: 1,
        projects: Array.from(entries.values()),
      };
      writeFileSync(registryPath, JSON.stringify(data, null, 2));
    } catch {
      // Best-effort persistence
    }
  }

  function register(root, name) {
    const normalizedRoot = resolve(root);

    // Validate: must be a governed project
    if (!existsSync(join(normalizedRoot, 'agentxchain.json'))) {
      throw new Error(`no agentxchain.json found at ${normalizedRoot}`);
    }

    const id = deriveProjectId(normalizedRoot);
    const existing = entries.get(id);

    if (existing) {
      // Idempotent: update name only
      if (name) existing.name = name;
      save();
      return { ...existing };
    }

    const entry = {
      id,
      name: name || basename(normalizedRoot),
      root: normalizedRoot,
      is_primary: id === primaryId,
      registered_at: Date.now(),
    };
    entries.set(id, entry);
    save();
    return { ...entry };
  }

  function unregister(projectId) {
    const entry = entries.get(projectId);
    if (!entry) return false;
    // Primary project cannot be unregistered
    if (entry.is_primary) return false;
    entries.delete(projectId);
    save();
    return true;
  }

  function list() {
    return Array.from(entries.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => ({ ...e }));
  }

  function get(projectId) {
    const entry = entries.get(projectId);
    return entry ? { ...entry } : null;
  }

  return { register, unregister, list, get, save, load };
}
