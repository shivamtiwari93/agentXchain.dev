/**
 * BUG-61 tester quote-back ask V4 must preserve the 2.154.7 minimum target,
 * the strict full-auto OR `--auto-retry-on-ghost` opt-in precondition, the
 * real event types and payload fields emitted by `continuous-run.js` +
 * `run-events.js`, and the reject rules that keep harness-only evidence
 * from sneaking past BUG-61 closure. This guard fails if a future edit
 * silently weakens any of those.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ASK_V4_PATH = '.planning/TESTER_QUOTEBACK_ASK_V4.md';
const CONTINUOUS_RUN_PATH = 'cli/src/lib/continuous-run.js';
const RUN_EVENTS_PATH = 'cli/src/lib/run-events.js';
const HUMAN_ROADMAP_PATH = '.planning/HUMAN-ROADMAP.md';

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('BUG-61 tester quote-back ask V4', () => {
  it('pins the BUG-52-safe 2.154.7 minimum target', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(
      ask,
      /Target package:[\s\S]{0,200}`agentxchain@2\.154\.7`/,
      'V4 must pin 2.154.7 as the minimum target',
    );
    assert.match(
      ask,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7/,
      'V4 preflight must use the 2.154.7 published tarball',
    );
  });

  it('cross-links V1 (BUG-52), V2 (BUG-59/BUG-54), and V3 (BUG-62)', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V1\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V2\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V3\.md/);
  });

  it('states the strict full-auto OR explicit-flag opt-in precondition', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(ask, /approval_policy\.phase_transitions\.default === "auto_approve"/);
    assert.match(ask, /approval_policy\.run_completion\.action === "auto_approve"/);
    assert.match(ask, /--auto-retry-on-ghost/);
    assert.match(ask, /DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001/);
  });

  it('requires three evidence blocks (positive, negative exhaustion, SUMMARY counters)', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(ask, /Block 1 — positive/);
    assert.match(ask, /Block 2 — negative/);
    assert.match(ask, /Block 3 — SUMMARY counters/);
  });

  it('names the real event types emitted by continuous-run.js', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    const continuousRun = readRepoFile(CONTINUOUS_RUN_PATH);
    const runEvents = readRepoFile(RUN_EVENTS_PATH);
    for (const eventType of ['auto_retried_ghost', 'ghost_retry_exhausted']) {
      assert.match(ask, new RegExp(eventType), `V4 must name ${eventType}`);
      assert.match(
        continuousRun,
        new RegExp(`'${eventType}'|"${eventType}"`),
        `continuous-run.js must still emit ${eventType}`,
      );
      assert.match(
        runEvents,
        new RegExp(`'${eventType}'|"${eventType}"`),
        `run-events.js must still list ${eventType} in VALID_RUN_EVENTS`,
      );
    }
  });

  it('names the real payload fields the events carry', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    for (const field of [
      'attempt',
      'max_retries_per_run',
      'failure_type',
      'runtime_id',
      'old_turn_id',
      'new_turn_id',
      'running_ms',
      'threshold_ms',
      'exhaustion_reason',
      'signature_repeat',
      'diagnostic_bundle',
      'final_signature',
      'attempts_log',
    ]) {
      assert.match(ask, new RegExp(field), `V4 must extract the '${field}' field`);
    }
  });

  it('names the two typed startup failure classes as the only valid ghost scope', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(ask, /runtime_spawn_failed/);
    assert.match(ask, /stdout_attach_failed/);
  });

  it('names both exhaustion reasons that continuous-run.js actually emits', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    const continuousRun = readRepoFile(CONTINUOUS_RUN_PATH);
    for (const reason of ['retry_budget_exhausted', 'same_signature_repeat']) {
      assert.match(ask, new RegExp(reason), `V4 must name exhaustion reason '${reason}'`);
      assert.match(
        continuousRun,
        new RegExp(`'${reason}'|"${reason}"`),
        `continuous-run.js must still emit exhaustion reason '${reason}'`,
      );
    }
  });

  it('requires the manual reissue-turn recovery string to remain visible after exhaustion', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(ask, /reissue-turn --turn <id> --reason ghost/);
    assert.match(
      ask,
      /manual escape hatch must stay visible/,
      'V4 must explain that manual recovery is preserved after auto-retry gives up',
    );
  });

  it('rejects harness-only and local-checkout evidence', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(
      ask,
      /reproduce-bug-54\.mjs/,
      'V4 must explicitly reject the standalone BUG-54 repro harness as closure evidence',
    );
    assert.match(
      ask,
      /evidence comes from an unversioned local checkout/,
      'V4 must reject evidence produced from a local repo checkout',
    );
    assert.match(
      ask,
      /adapter path under `agentxchain run --continuous`/,
      'V4 must require adapter-path evidence',
    );
  });

  it('requires the closure-counter SUMMARY invariants to keep silent omissions out', () => {
    const ask = readRepoFile(ASK_V4_PATH);
    assert.match(
      ask,
      /auto_retried_ghost >= 1/,
      'V4 Block 3 positive invariant must be quoted exactly',
    );
    assert.match(
      ask,
      /ghost_retry_exhausted == 0/,
      'V4 Block 3 positive invariant must require zero exhaustion',
    );
    assert.match(
      ask,
      /ghost_retry_exhausted == 1/,
      'V4 Block 3 negative invariant must require exactly one exhaustion',
    );
    assert.match(
      ask,
      /runtime_spawn_failed \+ stdout_attach_failed >= auto_retried_ghost/,
      'V4 Block 3 must require a preceding typed failure for every auto-retry',
    );
  });

  it('is referenced from HUMAN-ROADMAP top-of-file handoff line', () => {
    const roadmap = readRepoFile(HUMAN_ROADMAP_PATH);
    assert.match(
      roadmap,
      /TESTER_QUOTEBACK_ASK_V4\.md/,
      'HUMAN-ROADMAP must list V4 next to V1/V2/V3 so the human knows to use it',
    );
  });
});
