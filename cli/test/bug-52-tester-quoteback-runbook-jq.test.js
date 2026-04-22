/**
 * BUG-52 tester quote-back runbook — invariant regressions.
 *
 * The tester quote-back runbook is the single source of truth for closing
 * BUG-52 third variant. It must stay pinned to the shipped version that
 * carries the full fix stack (Turns 176, 203, 204, 205, 206) and must use
 * jq expressions that actually read the nested run-state shape.
 *
 * Turn 191 discovered the runbook's `jq` expressions read top-level fields
 * (`phase`, `status`, `phase_gate_status`, ...) from `agentxchain status --json`
 * output — but that output nests run state under `.state`. Running the runbook
 * verbatim returned `{phase: null, status: null, ...}`, which no tester can
 * quote back as valid pre-/post-unblock state. Every field null looks like the
 * fix is broken even when it isn't.
 *
 * Turn 207 retargeted the runbook to `2.154.7` (the first release carrying the
 * Turn 205 realistic `needs_human + proposed_next_role: "human"` predicate and
 * the Turn 206 verification-gated standing-source safety) and renamed the file
 * to drop the version suffix so a minor patch bump does not silently rot it.
 * This test guards:
 *   1. The file lives at the unversioned canonical path.
 *   2. The minimum target is `2.154.7`.
 *   3. All `status --json | jq` expressions route through `.state | ...`.
 *   4. The runbook explicitly requires the realistic Turn 205 shape
 *      (`proposed_next_role: "human"`, `phase_transition_request: null`).
 *   5. The runbook explicitly requires a shipped-package install check.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md';
const LEGACY_PATH = '.planning/BUG_52_2152_TESTER_QUOTEBACK_RUNBOOK.md';
const TESTER_ASK_V1_PATH = '.planning/TESTER_QUOTEBACK_ASK_V1.md';
const RUNBOOK = readFileSync(join(REPO_ROOT, RUNBOOK_PATH), 'utf8');
const TESTER_ASK_V1 = readFileSync(join(REPO_ROOT, TESTER_ASK_V1_PATH), 'utf8');
const RELEASE_148 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-148-0.mdx'), 'utf8');
const RELEASE_1490 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-149-0.mdx'), 'utf8');
const RELEASE_1491 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-149-1.mdx'), 'utf8');
const RELEASE_1492 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-149-2.mdx'), 'utf8');
const RELEASE_150 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-150-0.mdx'), 'utf8');
const RELEASE_152 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-152-0.mdx'), 'utf8');
const RELEASE_1540 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-154-0.mdx'), 'utf8');
const RELEASE_1541 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-154-1.mdx'), 'utf8');
const RELEASE_1543 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-154-3.mdx'), 'utf8');
const RELEASE_1545 = readFileSync(join(REPO_ROOT, 'website-v2/docs/releases/v2-154-5.mdx'), 'utf8');

describe('BUG-52 tester quote-back runbook invariants', () => {
  it('lives at the unversioned canonical path', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, RUNBOOK_PATH)),
      `expected runbook at ${RUNBOOK_PATH}`,
    );
    assert.ok(
      !existsSync(join(REPO_ROOT, LEGACY_PATH)),
      `legacy versioned runbook path must not exist: ${LEGACY_PATH}`,
    );
  });

  it('pins the shipped package target to 2.154.7 (or later)', () => {
    // The full fix stack landed in 2.154.7. Earlier versions still loop on
    // the realistic needs_human + proposed_next_role: "human" shape, so the
    // runbook must not invite quote-back from any earlier release.
    assert.match(RUNBOOK, /agentxchain@2\.154\.7/);
  });

  it('reads run-state fields from the .state nested object, not top-level', () => {
    // Every `status --json | jq '...'` line must route through `.state | ...`
    // because the governed status JSON schema nests run state under .state.
    const jqLines = RUNBOOK.split('\n').filter((line) =>
      /status --json\s*\|\s*jq\s/.test(line),
    );
    assert.ok(
      jqLines.length >= 2,
      `runbook must contain at least two status --json | jq lines; got ${jqLines.length}`,
    );
    for (const line of jqLines) {
      assert.match(
        line,
        /jq\s+'\.state\s*\|/,
        `runbook jq line must begin with .state | to read nested run state; got: ${line.trim()}`,
      );
    }
  });

  it('does NOT ship the defective top-level field pattern', () => {
    assert.doesNotMatch(
      RUNBOOK,
      /jq\s+'\{phase,\s*status,/,
      'runbook must not query {phase, status, ...} at the top level of status --json',
    );
    assert.doesNotMatch(
      RUNBOOK,
      /jq\s+'\{phase,\s*status,\s*planning_signoff:/,
      'runbook must not query {phase, status, planning_signoff: .phase_gate_status...} at the top level',
    );
  });

  it('requires the Turn 205 realistic PM handoff shape explicitly', () => {
    // The third-variant defect reproduces on the realistic PM shape where the
    // PM hands off to human without requesting a phase transition. If the
    // runbook does not name that shape, a tester could reproduce the Turn 176
    // path (phase_transition_request: "implementation") and quote back a
    // green result that does not exercise the live defect.
    assert.match(
      RUNBOOK,
      /proposed_next_role:\s*"human"/,
      'runbook must require proposed_next_role: "human" on the PM result',
    );
    assert.match(
      RUNBOOK,
      /phase_transition_request:\s*null/,
      'runbook must require phase_transition_request: null on the PM result',
    );
    assert.match(
      RUNBOOK,
      /status:\s*"needs_human"/,
      'runbook must require status: "needs_human" on the PM result',
    );
  });

  it('requires a shipped-package install preflight', () => {
    // Without a version preflight the tester can quote a local dev build and
    // nothing ties the evidence to the shipped tarball.
    assert.match(
      RUNBOOK,
      /npx[^\n]*agentxchain@2\.154\.7[^\n]*agentxchain --version/,
      'runbook must include a shipped-package version preflight',
    );
  });

  it('requires a negative counter-case that exits non-zero', () => {
    // The fix must remain evidence-gated — a missing required-file case must
    // still block phase advance.
    assert.match(
      RUNBOOK,
      /exit:\s*1/,
      'runbook negative counter-case must expect exit: 1',
    );
    assert.match(
      RUNBOOK,
      /proposed_next_role:\s*"dev"/,
      'runbook negative counter-case must force the continuation path before proving missing evidence blocks it',
    );
    assert.match(
      RUNBOOK,
      /PM_SIGNOFF\.md absent before accept\/checkpoint/,
      'runbook negative counter-case must make evidence missing before accept/checkpoint',
    );
    assert.doesNotMatch(
      RUNBOOK,
      /rm -f \.planning\/PM_SIGNOFF\.md/,
      'runbook must not test the negative case by deleting PM_SIGNOFF after checkpoint; that proves dirty-worktree blocking instead',
    );
    assert.match(
      RUNBOOK,
      /generic scaffold's planning route does not allow[\s\S]{0,120}dev directly from planning by default/,
      'runbook must explain why the scratch negative case adjusts generic planning routing',
    );
    assert.match(
      RUNBOOK,
      /config\.routing\.planning\.allowed_next_roles[\s\S]{0,220}'dev'/,
      'runbook negative counter-case must make proposed_next_role "dev" routing-legal in the scratch project',
    );
    assert.match(
      RUNBOOK,
      /agentxchain resume --role pm[\s\S]*agentxchain accept-turn[\s\S]*agentxchain checkpoint-turn --turn "\$TURN"[\s\S]*agentxchain unblock "\$HESC"/,
      'runbook negative counter-case must preserve the shipped-package command chain through resume, accept, checkpoint, and unblock',
    );
    assert.match(
      RUNBOOK,
      /Make real post-dispatch PM edits so checkpoint-turn proves declared files/,
      'runbook negative counter-case must not declare files_changed without making post-dispatch edits',
    );
  });

  it('short tester ask preserves the BUG-52 seven-field quote-back contract', () => {
    assert.match(
      TESTER_ASK_V1,
      /full runbook is `\.planning\/BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md`/,
      'V1 ask must point testers back to the canonical BUG-52 runbook',
    );
    assert.match(
      TESTER_ASK_V1,
      /Target package:[\s\S]{0,80}`agentxchain@2\.154\.7`/,
      'V1 ask must keep the first BUG-52-safe shipped package target visible',
    );
    for (const required of [
      /Pre-unblock state JSON/,
      /Full `agentxchain unblock "\$HESC"` stdout, stderr, and exit code/,
      /Immediate post-unblock state JSON/,
      /Durable event rows for `phase_entered`, `phase_cleanup`, and `gate_passed`/,
      /Ghost-turn check output/,
      /Negative counter-case output/,
    ]) {
      assert.match(TESTER_ASK_V1, required);
    }
    assert.match(
      TESTER_ASK_V1,
      /Version is lower than `2\.154\.7`/,
      'V1 ask must reject quote-back from packages that predate the full BUG-52 fix stack',
    );
    assert.match(
      TESTER_ASK_V1,
      /negative counter-case exits `0` or advances the phase/,
      'V1 ask must preserve the evidence-gated negative counter-case',
    );
    assert.match(
      TESTER_ASK_V1,
      /keep BUG-60 blocked until the separate BUG-59 shipped-package quote-back from `\.planning\/TESTER_QUOTEBACK_ASK_V2\.md` also lands and BUG-60's own two-agent research\/review pre-work is complete/,
      'V1 ask must not imply BUG-52 quote-back alone unlocks BUG-60',
    );
    assert.doesNotMatch(
      TESTER_ASK_V1,
      /only then unlock BUG-60 work/,
      'V1 ask must preserve the BUG-59 quote-back and BUG-60 pre-work blockers',
    );
  });

  it('public v2.150.0 release page redirects still-open BUG-52 / BUG-54 / BUG-53 closure to 2.154.7', () => {
    // v2.150.0 predates both the BUG-54 watchdog raise (2.151.0) and the full
    // BUG-52 third-variant fix stack (2.154.7). Its original Tester Re-Run
    // Contract invited testers to quote closure evidence on 2.150.0, which
    // can reproduce the BUG-52 standing-gate loop on any run that traverses
    // phase-gate recovery. Turn 213: retargeted every still-open closure pin
    // to 2.154.7 and added the BUG-52-safe admonition + canonical runbook
    // links. Same pattern as Turn 210 on v2-152-0 and Turn 211 on v2-154-5.
    assert.match(
      RELEASE_150,
      /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.150.0 release notes must warn that current still-open closure quote-back uses the 2.154.7 fix stack',
    );
    assert.match(
      RELEASE_150,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.150.0 release notes must link operators to the canonical BUG-52 runbook',
    );
    assert.match(
      RELEASE_150,
      /BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.150.0 release notes must link operators to the canonical BUG-59/54 runbook',
    );
    assert.match(
      RELEASE_150,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.150.0 tester contract command must use the current 2.154.7 target',
    );
    assert.doesNotMatch(
      RELEASE_150,
      /All prior shipped-package closure contracts remain in force on `agentxchain@2\.150\.0`/,
      'v2.150.0 must not keep the defective "closure contracts in force on 2.150.0" framing',
    );
    assert.doesNotMatch(
      RELEASE_150,
      /bug54-v2-150-0\.json/,
      'v2.150.0 must not carry the stale /tmp/bug54-v2-150-0.json discriminator pin in the rerun contract',
    );
  });

  it('public v2.148/v2.149 release pages redirect stale live quote-back pins to 2.154.7', () => {
    const olderPages = [
      ['v2.148.0', RELEASE_148, /agentxchain@2\.148\.0/],
      ['v2.149.0', RELEASE_1490, /agentxchain@2\.149\.0/],
      ['v2.149.1', RELEASE_1491, /agentxchain@2\.149\.1/],
      ['v2.149.2', RELEASE_1492, /agentxchain@2\.149\.2/],
    ];

    for (const [label, releasePage, staleCommandPattern] of olderPages) {
      assert.match(
        releasePage,
        /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
        `${label} release notes must warn that current still-open closure quote-back uses the 2.154.7 fix stack`,
      );
      assert.match(
        releasePage,
        /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
        `${label} release notes must link operators to the canonical BUG-52 runbook`,
      );
      assert.match(
        releasePage,
        /BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md/,
        `${label} release notes must link operators to the canonical BUG-59/54 runbook`,
      );
      assert.match(
        releasePage,
        /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
        `${label} tester contract command must use the current 2.154.7 target`,
      );
      assert.doesNotMatch(
        releasePage,
        new RegExp(`npx\\s+--yes\\s+-p\\s+${staleCommandPattern.source}\\s+-c "agentxchain --version"`),
        `${label} release notes may mention the historical version, but must not keep a live npx command pinned to it`,
      );
    }
  });

  it('public v2.152.0 release page points current BUG-52 quote-back to 2.154.7', () => {
    assert.match(
      RELEASE_152,
      /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.152.0 public release notes must warn that current BUG-52 quote-back uses the full 2.154.7 fix stack',
    );
    assert.match(
      RELEASE_152,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.152.0 release notes must link operators to the canonical BUG-52 runbook',
    );
    assert.match(
      RELEASE_152,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.152.0 tester contract command must use the current 2.154.7 target',
    );
    assert.doesNotMatch(
      RELEASE_152,
      /npx\s+--yes\s+-p\s+agentxchain@2\.152\.0\s+-c "agentxchain --version"/,
      'v2.152.0 release notes may mention the historical version, but must not keep a live npx command pinned to it',
    );
  });

  it('public v2.154.5 release page redirects BUG-52 quote-back to 2.154.7', () => {
    // v2.154.5 was a BUG-52 third-variant release but shipped before the
    // Turn 205 realistic PM handoff predicate. A tester following its original
    // quote-back command would reproduce the loop and conclude BUG-52 is
    // unfixed.
    assert.match(
      RELEASE_1545,
      /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.154.5 release notes must warn that current BUG-52 quote-back uses 2.154.7+',
    );
    assert.match(
      RELEASE_1545,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.154.5 release notes must link the canonical BUG-52 runbook',
    );
    assert.match(
      RELEASE_1545,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.154.5 tester contract command must use the current 2.154.7 target',
    );
    assert.doesNotMatch(
      RELEASE_1545,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.5\s+-c "agentxchain --version"/,
      'v2.154.5 release notes must not keep a live npx command pinned to the stale version',
    );
  });

  it('public v2.154.3 release page redirects BUG-52 still-open footer to 2.154.7', () => {
    // v2.154.3 is a BUG-61 release; its BUG-61 primary quote-back can stay
    // pinned to 2.154.3, but the still-open BUG-52 footer must redirect.
    assert.match(
      RELEASE_1543,
      /Current BUG-52 quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.154.3 release notes must warn that BUG-52 quote-back uses 2.154.7+',
    );
    assert.match(
      RELEASE_1543,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.154.3 release notes must link the canonical BUG-52 runbook',
    );
    assert.match(
      RELEASE_1543,
      /still-open BUG-52 closure proof, pin to `agentxchain@2\.154\.7`/,
      'v2.154.3 still-open BUG-52 footer must redirect to 2.154.7 pin',
    );
  });

  it('public v2.154.1 release page redirects BUG-52 still-open footer to 2.154.7', () => {
    assert.match(
      RELEASE_1541,
      /Current BUG-52 quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.154.1 release notes must warn that BUG-52 quote-back uses 2.154.7+',
    );
    assert.match(
      RELEASE_1541,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.154.1 release notes must link the canonical BUG-52 runbook',
    );
    assert.match(
      RELEASE_1541,
      /still-open BUG-52 closure proof, pin to `agentxchain@2\.154\.7`/,
      'v2.154.1 still-open BUG-52 footer must redirect to 2.154.7 pin',
    );
  });

  it('public v2.154.0 release page no longer directs BUG-52 quote-back to 2.152.0 window', () => {
    // v2.154.0 previously said BUG-52 third-variant closure accepted
    // `agentxchain@2.152.0 or newer`, which includes the entire realistic-PM
    // loop window (2.152.0–2.154.5). The BUG-52 footer must redirect.
    assert.match(
      RELEASE_1540,
      /Current BUG-52 quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.154.0 release notes must warn that BUG-52 quote-back uses 2.154.7+',
    );
    assert.match(
      RELEASE_1540,
      /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.154.0 release notes must link the canonical BUG-52 runbook',
    );
    assert.doesNotMatch(
      RELEASE_1540,
      /agentxchain@2\.152\.0.{0,8}or newer/,
      'v2.154.0 release notes must not direct BUG-52 closure to 2.152.0-or-newer, which includes the loop window',
    );
    assert.match(
      RELEASE_1540,
      /BUG-52 third-variant closure requires tester-quoted shipped-package[\s\S]{0,40}`agentxchain@2\.154\.7`/,
      'v2.154.0 release notes must require 2.154.7+ for BUG-52 third-variant closure',
    );
  });
});
