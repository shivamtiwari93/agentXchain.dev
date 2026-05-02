/**
 * BUG-53 re-entry spec drift guards.
 *
 * Locks `.planning/BUG_53_REENTRY_SPEC.md` against silent drift:
 *   - separation from BUG-60 (must not implement perpetual branch)
 *   - acceptance matrix rows A1..A7 present
 *   - cited source locations still match real file:line anchors in
 *     `cli/src/lib/continuous-run.js`
 *   - the `session_continuation` payload key set named in the spec matches
 *     what `continuous-run.js:916-940` actually emits
 *
 * Written Turn 233 (Claude Opus 4.7) per GPT 5.4's Turn 232 next action.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'BUG_53_REENTRY_SPEC.md');
const CONTINUOUS_RUN_PATH = join(REPO_ROOT, 'cli', 'src', 'lib', 'continuous-run.js');

function readSpec() {
  return readFileSync(SPEC_PATH, 'utf8');
}

function readContinuousRun() {
  return readFileSync(CONTINUOUS_RUN_PATH, 'utf8');
}

describe('BUG-53 re-entry spec — drift guards', () => {
  it('spec file exists and names BUG-53 re-entry scope in the title', () => {
    const spec = readSpec();
    assert.match(spec, /BUG-53 Spec.*Continuous Session Re-Entry After Run Completion/);
  });

  it('spec explicitly preserves the BUG-60 block and does not implement perpetual mode', () => {
    const spec = readSpec();
    // Positive: must say BUG-60 stays blocked / deferred
    assert.match(spec, /BUG-60.*blocked|BUG-60's two-agent pre-work|deferred to BUG-60/);
    // Positive: must name the two-agent pre-work tags
    assert.match(spec, /BUG-60-RESEARCH-CLAUDE/);
    assert.match(spec, /BUG-60-REVIEW-GPT/);
    // Positive: must name BUG-52 + BUG-59 shipped quote-back gate
    assert.match(spec, /BUG-52 \+\s*BUG-59 shipped(?:[- ]package)? quote-back/s);
    // Negative: must NOT introduce perpetual-mode schema keys
    assert.doesNotMatch(spec, /on_idle:\s*['"]perpetual['"]\s*—\s*this spec (ships|introduces|adds)/);
    assert.doesNotMatch(spec, /spec introduces `max_idle_expansions`/);
    assert.doesNotMatch(spec, /spec ships .*vision_expansion_exhausted/);
  });

  it('spec names exactly the seven session_continuation payload keys from continuous-run.js', () => {
    const spec = readSpec();
    const expectedKeys = [
      'session_id',
      'previous_run_id',
      'next_run_id',
      'next_objective',
      'next_intent_id',
      'runs_completed',
      'trigger',
    ];
    for (const key of expectedKeys) {
      assert.match(spec, new RegExp(`\\b${key}\\b`), `spec must name payload key ${key}`);
    }
    // Cross-check against the real emission in continuous-run.js
    const src = readContinuousRun();
    for (const key of expectedKeys) {
      assert.match(
        src,
        new RegExp(`\\b${key}\\b`),
        `continuous-run.js must still emit payload key ${key} — if this fails, spec §3/A5 and §7 DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001 must be updated`,
      );
    }
  });

  it('spec acceptance matrix contains rows A1 through A7', () => {
    const spec = readSpec();
    for (const row of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']) {
      assert.match(spec, new RegExp(`\\|\\s*${row}\\s*\\|`), `acceptance matrix row ${row} missing`);
    }
  });

  it('spec lists four gap remediation items G1..G4 and names G4 as the closure gate', () => {
    const spec = readSpec();
    for (const gap of ['G1', 'G2', 'G3', 'G4']) {
      assert.match(spec, new RegExp(`\\b${gap}\\b`), `gap ${gap} missing`);
    }
    assert.match(spec, /G1 — Idle-exit shorter-than-max-runs path \(already covered\)/);
    assert.match(spec, /Turn 234 implemented this/);
    assert.match(spec, /known to belong on other\s+surfaces/s);
    // G4 must be named as the closure artifact, not merely the final agent-side gap.
    assert.match(spec, /G4 is the \*\*closure artifact\*\*|Closure requires G4/);
  });

  it('spec pins tester quote-back to the shipped-package flow (no harness-only, no local-checkout)', () => {
    const spec = readSpec();
    assert.match(spec, /agentxchain@2\.154\.7\+/);
    assert.match(spec, /Reject synthetic or local-checkout evidence|require shipped-package/);
  });

  it('spec cross-references still match real continuous-run.js line anchors', () => {
    const src = readContinuousRun();
    // §2 cites continuous-run.js:688-692 for the max-runs terminal check.
    // We do not lock to exact line numbers (code moves) but we do require the
    // literal emission patterns the spec depends on to still exist.
    assert.match(src, /runs_completed >= contOpts\.maxRuns/);
    assert.match(src, /idle_cycles >= contOpts\.maxIdleCycles/);
    assert.match(src, /session\.runs_completed \+= 1/);
    assert.match(src, /emitRunEvent\([^,]+,\s*'session_continuation'/);
    assert.match(src, /isBlockedContinuousExecution/);
  });

  it('spec rejects the four non-goals explicitly', () => {
    const spec = readSpec();
    assert.match(spec, /Changing default `maxIdleCycles` or `maxRuns` values.*Out of scope/);
    assert.match(spec, /Adding new CLI flags/);
    assert.match(spec, /Changing `session_continuation` event emission order/);
    assert.match(spec, /Reworking `paused` semantics/);
  });

  it('spec proposes two decision records tagged BUG53 and forbids speculative filing', () => {
    const spec = readSpec();
    assert.match(spec, /DEC-BUG53-CLEAN-COMPLETION-NEVER-PAUSES-001/);
    assert.match(spec, /DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001/);
    assert.match(spec, /Do NOT file these DECs speculatively/);
  });

  it('spec closure definition requires G4 tester quote-back — no earlier step closes BUG-53', () => {
    const spec = readSpec();
    assert.match(spec, /Closure requires G4/);
    // Negative: must not allow closure from G1/G2/G3 alone
    assert.doesNotMatch(spec, /G1 alone closes BUG-53/);
    assert.doesNotMatch(spec, /G2 alone closes BUG-53/);
    assert.doesNotMatch(spec, /G3 alone closes BUG-53/);
  });
});
