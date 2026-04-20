/**
 * Staged turn-result proof helpers.
 *
 * Per DEC-BUG51-STAGING-PLACEHOLDER-NOT-PROOF-001: a turn-scoped staged-result
 * file is proof of execution only when it contains meaningful result content.
 * Adapter-authored placeholders (`{}`, blank, whitespace-only) are cleanup
 * artifacts — watchdog, adapter, and recovery code must treat them as absent.
 *
 * This module centralizes that check so every surface (local-cli adapter,
 * manual adapter, stale-turn watchdog) uses the same rule.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * Returns true when the staged-result file at `filePath` exists AND contains
 * content that is not a placeholder (empty, whitespace-only, or `{}`).
 *
 * Trim-aware: `{}\n`, `  {}\n`, and `{}` are all rejected. Legitimate turn
 * results carry the full governed schema and are far larger than the
 * placeholder shapes this function filters.
 *
 * @param {string} filePath - absolute path to the staged-result file
 * @returns {boolean}
 */
export function hasMeaningfulStagedResult(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '{}') {
    return false;
  }
  return true;
}
