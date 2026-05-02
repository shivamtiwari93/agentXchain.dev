/**
 * Contract test: every beta-tester bug (BUG-1 through BUG-30, excluding BUG-24
 * which was never assigned) MUST have a dedicated scenario file under
 * cli/test/beta-tester-scenarios/.
 *
 * This test fails closed if any required file is missing — preventing the
 * "files exist as decoration" failure mode that caused the false closures
 * documented in BETA_FALSE_CLOSURE_POSTMORTEM.md.
 *
 * Added: Turn 145 (Claude Opus 4.6) per HUMAN-ROADMAP P0 discipline requirement.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, 'beta-tester-scenarios');

// BUG-24 was never assigned (numbering skipped 23 → 25)
const REQUIRED_BUGS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23,
  25, 26, 27, 28, 29, 30,
];

const BUG_FILE_PREFIX = {
  1:  'bug-1-dirty-workspace-false-acceptance',
  2:  'bug-2-session-state-baseline-agreement',
  3:  'bug-3-acceptance-failure-state-transition',
  4:  'bug-4-acceptance-failed-event',
  5:  'bug-5-dispatch-dirty-workspace-warning',
  6:  'bug-6-stream-flag',
  7:  'bug-7-reissue-turn',
  8:  'bug-8-reject-baseline-refresh',
  9:  'bug-9-reassign-gate-removal',
  10: 'bug-10-restart-drift-recovery-commands',
  11: 'bug-11-manual-intake-consumption',
  12: 'bug-12-intent-id-propagation',
  13: 'bug-13-prompt-intent-foregrounding',
  14: 'bug-14-intent-coverage-validation',
  15: 'bug-15-status-pending-intents',
  16: 'bug-16-unified-intake-consumption',
  17: 'bug-17-restart-atomicity',
  18: 'bug-18-state-bundle-integrity',
  19: 'bug-19-gate-reconciliation',
  20: 'bug-20-intent-satisfaction-lifecycle',
  21: 'bug-21-intent-id-restart',
  22: 'bug-22-stale-staging-detection',
  23: 'bug-23-checkpoint-turn',
  25: 'bug-25-reissue-turn-runtime-undefined',
  26: 'bug-26-doctor-spawn-parity',
  27: 'bug-27-restart-ghost-turn',
  28: 'bug-28-stale-gate-state',
  29: 'bug-29-satisfied-intents-still-pending',
  30: 'bug-30-intent-id-null-in-events',
};

describe('Beta-tester scenario completeness', () => {
  it('scenarios directory exists', () => {
    assert.ok(existsSync(SCENARIOS_DIR), `Missing directory: ${SCENARIOS_DIR}`);
  });

  it('every required BUG-N has a scenario file', () => {
    const files = readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.test.js'));
    const missing = [];

    for (const bugNum of REQUIRED_BUGS) {
      const prefix = BUG_FILE_PREFIX[bugNum];
      const expectedFile = `${prefix}.test.js`;
      if (!files.includes(expectedFile)) {
        missing.push(`BUG-${bugNum}: expected ${expectedFile}`);
      }
    }

    assert.equal(
      missing.length, 0,
      `Missing beta-tester scenario files:\n${missing.join('\n')}`
    );
  });

  it('no scenario file is empty (> 100 bytes)', () => {
    const files = readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.test.js'));
    const empty = [];

    for (const file of files) {
      const path = join(SCENARIOS_DIR, file);
      const stat = statSync(path);
      if (stat.size < 100) {
        empty.push(`${file} (${stat.size} bytes)`);
      }
    }

    assert.equal(
      empty.length, 0,
      `Empty or stub scenario files:\n${empty.join('\n')}`
    );
  });

  it(`has exactly ${REQUIRED_BUGS.length} required bugs tracked`, () => {
    assert.equal(REQUIRED_BUGS.length, 29); // 1-23 + 25-30 = 29
  });
});
