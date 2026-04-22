/**
 * BUG-52 v2.152.0 tester quote-back runbook — jq-expression regression.
 *
 * Turn 187-190 confirmed BUG-52 third variant shipped in agentxchain@2.152.0
 * and the positive/negative command-chain proof already lives in
 * `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js`.
 * Closure waits on real tester quote-back against the shipped package, driven
 * from `.planning/BUG_52_2152_TESTER_QUOTEBACK_RUNBOOK.md`.
 *
 * Turn 191 discovered the runbook's `jq` expressions read top-level fields
 * (`phase`, `status`, `phase_gate_status`, ...) from `agentxchain status --json`
 * output — but that output nests run state under `.state`. Running the runbook
 * verbatim returned `{phase: null, status: null, ...}`, which no tester can
 * quote back as valid pre-/post-unblock state. Every field null looks like the
 * fix is broken even when it isn't.
 *
 * The fix prepends `.state |` to the two offending jq expressions so the
 * pipeline reads the nested run-state object. This test guards that the
 * runbook never regresses back to the defective top-level shape.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_52_2152_TESTER_QUOTEBACK_RUNBOOK.md';
const RUNBOOK = readFileSync(join(REPO_ROOT, RUNBOOK_PATH), 'utf8');

describe('BUG-52 v2.152.0 tester quote-back runbook jq expressions', () => {
  it('pins the shipped package version so quote-back is tied to 2.152.0', () => {
    assert.match(RUNBOOK, /agentxchain@2\.152\.0/);
  });

  it('reads run-state fields from the .state nested object, not top-level', () => {
    // Every `status --json | jq '...'` line must route through `.state | ...`
    // because the governed status JSON schema nests run state under .state.
    const jqLines = RUNBOOK.split('\n').filter((line) =>
      /status --json\s*\|\s*jq\s/.test(line),
    );
    assert.ok(jqLines.length >= 2, `runbook must contain at least two status --json | jq lines; got ${jqLines.length}`);
    for (const line of jqLines) {
      assert.match(
        line,
        /jq\s+'\.state\s*\|/,
        `runbook jq line must begin with .state | to read nested run state; got: ${line.trim()}`,
      );
    }
  });

  it('does NOT ship the defective top-level field pattern', () => {
    // The original broken form queried top-level {phase, status, ...} which
    // always returned null because those fields live under .state. If that
    // pattern reappears, testers will quote back all-null output and think
    // the fix is broken.
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
});
