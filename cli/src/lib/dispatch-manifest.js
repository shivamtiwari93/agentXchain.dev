/**
 * Dispatch manifest integrity — content-addressed bundle verification.
 *
 * Implements V2.1-F1: each finalized dispatch bundle gets a MANIFEST.json
 * containing SHA-256 digests and byte sizes for every file in the bundle.
 * Adapters verify the manifest before consuming bundle files.
 *
 * Timing:
 *   writeDispatchBundle()  → core files written
 *   after_dispatch hooks   → supplements added
 *   finalizeDispatchManifest() → MANIFEST.json sealed
 *   verifyDispatchManifest()   → adapter checks before execution
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getDispatchTurnDir, getDispatchManifestPath } from './turn-paths.js';

const MANIFEST_VERSION = '1.0';
const MANIFEST_FILENAME = 'MANIFEST.json';

/**
 * Finalize a dispatch bundle by writing MANIFEST.json with content-addressed entries.
 *
 * Must be called AFTER writeDispatchBundle() and after_dispatch hooks have completed.
 *
 * @param {string} root - project root directory
 * @param {string} turnId - turn identifier
 * @param {{ run_id: string, role: string }} identity - turn identity for manifest metadata
 * @returns {{ ok: boolean, manifestPath?: string, fileCount?: number, error?: string }}
 */
export function finalizeDispatchManifest(root, turnId, identity) {
  const bundleDir = join(root, getDispatchTurnDir(turnId));

  if (!existsSync(bundleDir)) {
    return { ok: false, error: 'Bundle directory does not exist' };
  }

  const entries = scanBundleFiles(bundleDir);
  if (entries.length === 0) {
    return { ok: false, error: 'Bundle directory is empty — no files to manifest' };
  }

  const manifest = {
    manifest_version: MANIFEST_VERSION,
    run_id: identity.run_id,
    turn_id: turnId,
    role: identity.role,
    finalized_at: new Date().toISOString(),
    files: entries,
  };

  const manifestPath = join(root, getDispatchManifestPath(turnId));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return { ok: true, manifestPath, fileCount: entries.length };
}

/**
 * Verify a dispatch bundle against its MANIFEST.json.
 *
 * @param {string} root - project root directory
 * @param {string} turnId - turn identifier
 * @returns {{ ok: boolean, errors?: Array<{ type: string, path?: string, detail: string }>, manifest?: object }}
 */
export function verifyDispatchManifest(root, turnId) {
  const bundleDir = join(root, getDispatchTurnDir(turnId));
  const manifestPath = join(root, getDispatchManifestPath(turnId));

  // Check manifest exists
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      errors: [{ type: 'missing_manifest', detail: 'MANIFEST.json does not exist in bundle directory' }],
    };
  }

  // Parse manifest
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      errors: [{ type: 'invalid_manifest', detail: `MANIFEST.json is malformed: ${err.message}` }],
    };
  }

  // Validate schema
  if (!manifest.manifest_version || !Array.isArray(manifest.files)) {
    return {
      ok: false,
      errors: [{ type: 'invalid_manifest', detail: 'MANIFEST.json missing required fields (manifest_version, files)' }],
    };
  }

  const errors = [];

  // Check each declared file
  for (const entry of manifest.files) {
    const filePath = join(bundleDir, entry.path);

    if (!existsSync(filePath)) {
      errors.push({ type: 'missing_file', path: entry.path, detail: `Declared file "${entry.path}" is missing from bundle` });
      continue;
    }

    const content = readFileSync(filePath);
    const actualSize = content.length;
    const actualDigest = createHash('sha256').update(content).digest('hex');

    if (actualSize !== entry.size) {
      errors.push({
        type: 'size_mismatch',
        path: entry.path,
        detail: `"${entry.path}" size mismatch: manifest=${entry.size}, actual=${actualSize}`,
      });
    }

    if (actualDigest !== entry.sha256) {
      errors.push({
        type: 'digest_mismatch',
        path: entry.path,
        detail: `"${entry.path}" SHA-256 mismatch: manifest=${entry.sha256}, actual=${actualDigest}`,
      });
    }
  }

  // Check for unexpected files
  const declaredPaths = new Set(manifest.files.map((f) => f.path));
  const actualFiles = scanFilenames(bundleDir);
  for (const actual of actualFiles) {
    if (!declaredPaths.has(actual)) {
      errors.push({
        type: 'unexpected_file',
        path: actual,
        detail: `Unexpected file "${actual}" not declared in manifest`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, manifest };
  }

  return { ok: true, manifest };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Scan a bundle directory and return manifest file entries.
 * Excludes MANIFEST.json itself.
 */
function scanBundleFiles(bundleDir) {
  const entries = [];
  const files = readdirSync(bundleDir);

  for (const filename of files) {
    if (filename === MANIFEST_FILENAME) continue;

    const filePath = join(bundleDir, filename);
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;

    const content = readFileSync(filePath);
    const digest = createHash('sha256').update(content).digest('hex');

    entries.push({
      path: filename,
      sha256: digest,
      size: content.length,
    });
  }

  // Sort for deterministic manifest output
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/**
 * Get all filenames in a bundle directory, excluding MANIFEST.json.
 */
function scanFilenames(bundleDir) {
  return readdirSync(bundleDir)
    .filter((f) => f !== MANIFEST_FILENAME && statSync(join(bundleDir, f)).isFile());
}
