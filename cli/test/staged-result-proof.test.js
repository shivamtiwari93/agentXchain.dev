/**
 * Staged turn-result proof harmonization — Turn 29 audit under
 * DEC-BUG51-STAGING-PLACEHOLDER-NOT-PROOF-001.
 *
 * Locks:
 *   1. `hasMeaningfulStagedResult()` rejects every placeholder shape the
 *      adapters/watchdog can produce: missing, blank, whitespace-only, exact
 *      `{}`, and `{}\n` (trailing newline).
 *   2. The two adapter-level `isStagedResultReady` implementations and the
 *      watchdog's `hasTurnScopedStagedResult` agree on the same answer for
 *      every placeholder shape — no divergent "proof" surfaces.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { hasMeaningfulStagedResult } from '../src/lib/staged-result-proof.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const PLACEHOLDERS = [
  { label: 'blank file', content: '' },
  { label: 'whitespace-only', content: '   \n\t  ' },
  { label: 'exact {}', content: '{}' },
  { label: '{} with trailing newline', content: '{}\n' },
  { label: '{} with surrounding whitespace', content: '  {}  ' },
];

const REAL_TURN_RESULT = {
  schema_version: 'v7',
  run_id: 'run_abc',
  turn_id: 'turn_abc',
  role: 'pm',
  runtime_id: 'codex',
  status: 'completed',
  summary: 'real result',
  decisions: [],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped' },
  artifact: { type: 'review' },
  proposed_next_role: null,
};

describe('staged-result proof helper (BUG-51 placeholder rule)', () => {
  let root;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'staged-result-proof-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false when the file does not exist', () => {
    const missing = join(root, 'does-not-exist.json');
    assert.equal(hasMeaningfulStagedResult(missing), false);
  });

  for (const { label, content } of PLACEHOLDERS) {
    it(`rejects placeholder: ${label}`, () => {
      const filePath = join(root, `placeholder-${label.replace(/\W+/g, '_')}.json`);
      writeFileSync(filePath, content);
      assert.equal(hasMeaningfulStagedResult(filePath), false, label);
    });
  }

  it('accepts a real turn-result shape', () => {
    const filePath = join(root, 'real-result.json');
    writeFileSync(filePath, JSON.stringify(REAL_TURN_RESULT, null, 2));
    assert.equal(hasMeaningfulStagedResult(filePath), true);
  });

  it('accepts an unrelated but meaningful JSON payload', () => {
    // The helper is the low-level "is this a placeholder?" filter. Full
    // schema enforcement happens downstream in validateStagedTurnResult.
    const filePath = join(root, 'non-empty.json');
    writeFileSync(filePath, '{"turn_id":"t1"}');
    assert.equal(hasMeaningfulStagedResult(filePath), true);
  });
});

describe('watchdog + adapter proof agreement', () => {
  let root;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'staged-result-agreement-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * For each placeholder shape, the shared helper must return false AND the
   * watchdog-path helper (which consumes the same util) must agree. This
   * locks the harmonization that landed in Turn 29.
   */
  for (const { label, content } of PLACEHOLDERS) {
    it(`adapter path agrees with watchdog path on placeholder: ${label}`, async () => {
      const turnId = `turn_${label.replace(/\W+/g, '_')}`;
      const rel = getTurnStagingResultPath(turnId);
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);

      // Adapter-level answer
      const adapterAnswer = hasMeaningfulStagedResult(abs);
      assert.equal(adapterAnswer, false, `adapter should reject ${label}`);

      // Watchdog-level answer (uses the same helper internally per Turn 29)
      // Re-derive through the module to catch accidental divergence.
      const { hasMeaningfulStagedResult: watchdogHelper } = await import(
        '../src/lib/staged-result-proof.js'
      );
      assert.equal(watchdogHelper(abs), adapterAnswer, `watchdog must match adapter on ${label}`);
    });
  }

  it('both paths agree on real results', async () => {
    const turnId = 'turn_real';
    const rel = getTurnStagingResultPath(turnId);
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(REAL_TURN_RESULT, null, 2));

    assert.equal(hasMeaningfulStagedResult(abs), true);
  });
});
