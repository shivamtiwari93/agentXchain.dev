/**
 * BUG-53 tester quote-back ask V5 must preserve the 2.154.7 minimum target,
 * the exact seven-key `session_continuation.payload` shape emitted by
 * `continuous-run.js`, the negative-case idle-exit evidence lane, the SUMMARY
 * counters block, and the reject rules that keep synthetic/local-checkout
 * evidence and cross-bug diagnostic contamination from sneaking past BUG-53
 * closure. This guard fails if a future edit silently weakens any of those.
 *
 * Scope: BUG-53 evidence path only. BUG-60 (perpetual idle-expansion) is
 * explicitly out of scope — the ask must reject BUG-60 concept leakage.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ASK_V5_PATH = '.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md';
const SPEC_PATH = '.planning/BUG_53_REENTRY_SPEC.md';
const CONTINUOUS_RUN_PATH = 'cli/src/lib/continuous-run.js';
const HUMAN_ROADMAP_PATH = '.planning/HUMAN-ROADMAP.md';

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function extractObjectLiteralAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `expected to find marker ${marker}`);
  const payloadIndex = source.indexOf('payload:', markerIndex);
  assert.notEqual(payloadIndex, -1, `expected to find payload after marker ${marker}`);
  const openBrace = source.indexOf('{', payloadIndex);
  assert.notEqual(openBrace, -1, `expected payload object after marker ${marker}`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, i);
      }
    }
  }
  assert.fail(`unterminated payload object after marker ${marker}`);
}

// The session_continuation payload shape is authoritative per
// cli/src/lib/continuous-run.js:930-938. The V5 ask must name exactly these
// seven keys; the source regex below double-locks against drift on either
// side. See DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001 (proposed).
const REQUIRED_PAYLOAD_KEYS = [
  'session_id',
  'previous_run_id',
  'next_run_id',
  'next_objective',
  'next_intent_id',
  'runs_completed',
  'trigger',
];

// Concrete BUG-54 and BUG-61 diagnostic keys that BUG-53's session_continuation
// payload must NOT carry, per BUG_53_REENTRY_SPEC.md §4/G3.
const BANNED_CROSS_BUG_KEYS = [
  'prompt_transport',
  'env_snapshot',
  'stdin_bytes',
  'watchdog_ms',
  'auto_retried_ghost',
  'ghost_retry_exhausted',
  'attempts_log',
  'diagnostic_bundle',
  'failure_type',
];

describe('BUG-53 tester quote-back ask V5', () => {
  it('pins the BUG-52-safe 2.154.7 minimum target', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /Target package:[\s\S]{0,200}`agentxchain@2\.154\.7`/,
      'V5 must pin 2.154.7 as the minimum target',
    );
    assert.match(
      ask,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7/,
      'V5 preflight must use the 2.154.7 published tarball',
    );
  });

  it('cross-links V1 (BUG-52), V2 (BUG-59/BUG-54), V3 (BUG-62), and V4 (BUG-61)', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V1\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V2\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V3\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V4\.md/);
  });

  it('requires three evidence blocks (positive chain, negative idle-exit, SUMMARY counters)', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /Block 1 — positive \(run 1 completes, run 2 auto-starts/);
    assert.match(ask, /Block 2 — negative \(same session vision exhausted/);
    assert.match(ask, /Block 3 — SUMMARY counters/);
  });

  it('captures BUG53_START_TS before the dogfood command so evidence is current-window only', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /export\s+BUG53_START_TS=\$\(date\s+-u\s+\+"%Y-%m-%dT%H:%M:%SZ"\)/,
      'V5 must capture a UTC ISO-8601 start timestamp before the dogfood run',
    );
    assert.match(
      ask,
      /--arg\s+since\s+"\$BUG53_START_TS"/,
      'V5 jq filters must scope to $BUG53_START_TS to avoid historical pollution',
    );
  });

  it('Block 1 jq names exactly the seven session_continuation.payload keys', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    const jqRegex = /select\(\.event_type == "session_continuation"[\s\S]{0,600}payload:\s*\{([^}]+)\}/;
    const match = ask.match(jqRegex);
    assert.ok(match, 'Block 1 jq must include a `payload: { ... }` projection');
    const projection = match[1];
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      assert.match(
        projection,
        new RegExp(`${key}:\\s*\\.payload\\.${key}`),
        `Block 1 payload projection must include ${key}: .payload.${key}`,
      );
    }
  });

  it('names the exact seven-key payload contract in the required-shape prose', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      assert.match(
        ask,
        new RegExp(`\`${key}\``),
        `Required-shape prose must name payload key \`${key}\``,
      );
    }
    assert.match(
      ask,
      /exactly these seven keys and no others/,
      'Prose must lock the seven-key payload set and reject additive fields',
    );
  });

  it('source contract: continuous-run.js still emits those exact seven payload keys', () => {
    const source = readRepoFile(CONTINUOUS_RUN_PATH);
    const payloadBlock = extractObjectLiteralAfter(source, "'session_continuation'");
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      assert.match(
        payloadBlock,
        new RegExp(`${key}:`),
        `continuous-run.js payload must still declare ${key}: — rename breaks the V5 quote-back`,
      );
    }
    // Negative guard: emission must not smuggle extra keys beyond the seven.
    // Count top-level key assignments in the payload object without relying on
    // indentation. This intentionally still fails if the payload is delegated
    // to a helper: the V5 ask must be updated alongside that contract change.
    const keyAssignments = payloadBlock
      .split('\n')
      .map((line) => line.trim().match(/^([a-z_]+):/))
      .filter(Boolean)
      .map((match) => match[1]);
    assert.deepEqual(
      keyAssignments.sort(),
      [...REQUIRED_PAYLOAD_KEYS].sort(),
      `continuous-run.js session_continuation payload keys must be exactly ${REQUIRED_PAYLOAD_KEYS.join(', ')}`,
    );
  });

  it('bans the concrete BUG-54/61 cross-bug diagnostic keys in the reject rules', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    // Reject rules must enumerate at least one BUG-54 key and at least one
    // BUG-61 key by name so drift on either side surfaces a failure.
    for (const key of BANNED_CROSS_BUG_KEYS) {
      assert.match(
        ask,
        new RegExp(`\`${key}\``),
        `Reject rules must name banned cross-bug key \`${key}\``,
      );
    }
    assert.match(
      ask,
      /Cross-bug contamination on this event is a reopener/,
      'V5 must explicitly mark cross-bug contamination as closure-blocking',
    );
  });

  it('explicitly rejects harness-only, synthetic-mock, and local-checkout evidence', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /reproduce-bug-54\.mjs/, 'V5 must name the harness it rejects');
    assert.match(ask, /synthetic mock executor/i, 'V5 must reject synthetic mock executors');
    assert.match(ask, /unversioned local checkout/, 'V5 must reject local-checkout evidence');
    assert.match(
      ask,
      /shipped-package, full adapter-path evidence/,
      'V5 must require shipped-package adapter-path evidence',
    );
  });

  it('rejects paused terminal state on clean completion (BUG-53 regression signature)', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /status == "paused"[\s\S]{0,400}regression signature/,
      'V5 must identify paused-on-clean-completion as the BUG-53 regression signature',
    );
    assert.match(
      ask,
      /session_paused_anomaly/,
      'Block 3 SUMMARY must track session_paused as an anomaly counter',
    );
  });

  it('requires multi-run chain evidence (runs_completed >= 2) for the positive block', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /runs_completed\s*>=\s*2/,
      'V5 must require runs_completed >= 2 so an actual chain transition is exercised',
    );
    assert.match(
      ask,
      /v2\.150\.0 tester evidence already covered `runs_completed == 0`/,
      'V5 must explain why runs_completed >= 2 is required (v2.150.0 only proved the 0 case)',
    );
  });

  it('requires idle_exit (not paused) as the negative-block terminal status', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /status[\s\S]{0,200}`idle_exit`/,
      'V5 must name idle_exit as the expected negative-block terminal status',
    );
    assert.match(
      ask,
      /NEVER `paused`/,
      'V5 must explicitly forbid paused as a terminal state for the negative block',
    );
    assert.match(
      ask,
      /`completed` means the max-run cap fired before vision exhaustion and does not close Block 2/,
      'V5 must reject completed as a substitute for the idle_exit negative case',
    );
  });

  it('requires a single current-window session for Blocks 1 and 2', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /Do not mix Block 1 evidence from one session with Block 2 evidence from another session/,
      'V5 must forbid cross-session evidence mixing',
    );
    assert.match(
      ask,
      /at least two, but fewer than `--max-runs`, concretely derivable goals/,
      'V5 must tell testers to set up fewer derivable goals than max_runs',
    );
    assert.match(
      ask,
      /--max-runs 4/,
      'V5 dogfood command should leave room for idle_exit after a two-goal chain',
    );
  });

  it('routes BUG-52-like pauses out of the BUG-53 closure lane', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(
      ask,
      /BUG-52-like phase-gate loop/,
      'V5 must call out BUG-52-like phase gate loops explicitly',
    );
    assert.match(
      ask,
      /belongs under BUG-52 V1 first/,
      'V5 must route phase-gate pauses to BUG-52 quote-back instead of BUG-53 closure',
    );
  });

  it('explicitly separates from BUG-60 (perpetual idle-expansion out of scope)', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /BUG-60[\s\S]{0,300}out of scope/i, 'V5 must name BUG-60 as out of scope');
    assert.match(
      ask,
      /on_idle: 'perpetual'/,
      'V5 must explicitly exclude BUG-60 perpetual branch from evidence requirements',
    );
    assert.match(
      ask,
      /BUG-60 is blocked behind its own two-agent pre-work AND the remaining BUG-59 shipped-package quote-back/,
      'V5 must reaffirm the current BUG-60 sequencing gate',
    );
    assert.match(
      ask,
      /BUG-52's separate shipped-package quote-back landed on `agentxchain@2\.154\.11`/,
      'V5 must record that BUG-52 is no longer a BUG-60 blocker',
    );
    assert.doesNotMatch(
      ask,
      /BUG-52 \+ BUG-59 shipped-package quote-back/,
      'V5 must not preserve stale BUG-52 gating after BUG-52 closure',
    );
  });

  it('SUMMARY counters block enforces session_continuation / run_completed / session_paused_anomaly invariants', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /session_continuation:\s*map\(select\(\.event_type == "session_continuation"/);
    assert.match(ask, /run_completed:\s*map\(select\(\.event_type == "run_completed"/);
    assert.match(ask, /session_paused_anomaly:\s*map\(select\(\.event_type == "session_paused"/);
    assert.match(
      ask,
      /session_continuation.*count.*runs_completed\s*-\s*1/i,
      'SUMMARY prose must lock the (runs_completed - 1) invariant for session_continuation count',
    );
  });

  it('references the BUG-53 re-entry spec as the behaviour contract', () => {
    const ask = readRepoFile(ASK_V5_PATH);
    assert.match(ask, /BUG_53_REENTRY_SPEC\.md/, 'V5 must link the spec');
    // Spec exists and declares the same seven payload keys.
    const spec = readRepoFile(SPEC_PATH);
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      assert.match(spec, new RegExp(key), `BUG_53_REENTRY_SPEC.md must declare ${key}`);
    }
  });

  it('HUMAN-ROADMAP top-of-file handoff line lists V5 alongside V1–V4', () => {
    const roadmap = readRepoFile(HUMAN_ROADMAP_PATH);
    assert.match(
      roadmap,
      /TESTER_QUOTEBACK_ASK_V5_BUG53\.md/,
      'HUMAN-ROADMAP top-of-file handoff line must point to V5 so the human can find it',
    );
  });
});
