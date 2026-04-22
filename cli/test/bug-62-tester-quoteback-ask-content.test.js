/**
 * BUG-62 tester quote-back ask V3 must preserve the three-block evidence
 * contract, the 2.154.7 minimum target, the real error-class names emitted by
 * `operator-commit-reconcile.js`, and the scratch-only instruction so future
 * edits cannot silently weaken the ask.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ASK_V3_PATH = '.planning/TESTER_QUOTEBACK_ASK_V3.md';
const RECONCILE_LIB_PATH = 'cli/src/lib/operator-commit-reconcile.js';

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('BUG-62 tester quote-back ask V3', () => {
  it('pins the BUG-52-safe 2.154.7 minimum target', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /Target package:[\s\S]{0,160}`agentxchain@2\.154\.7`/,
      'V3 must pin 2.154.7 as the minimum target',
    );
    assert.match(
      ask,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7/,
      'V3 preflight must use the 2.154.7 published tarball',
    );
  });

  it('cross-links V1 (BUG-52) and V2 (BUG-59/BUG-54)', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V1\.md/);
    assert.match(ask, /TESTER_QUOTEBACK_ASK_V2\.md/);
  });

  it('requires all three evidence blocks (positive + two negatives)', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(ask, /Block 1 — positive reconcile/);
    assert.match(ask, /Block 2 — negative \(operator commit modifies governed state\)/);
    assert.match(ask, /Block 3 — negative \(history rewrite/);
  });

  it('names the real event type emitted by reconcileOperatorHead', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    const lib = readRepoFile(RECONCILE_LIB_PATH);
    assert.match(
      ask,
      /state_reconciled_operator_commits/,
      'V3 must name the actual event type',
    );
    assert.match(
      lib,
      /state_reconciled_operator_commits/,
      'reconcile library must still emit the event name V3 asks testers to quote',
    );
  });

  it('names the real error classes emitted by classifyUnsafeCommit / history check', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    const lib = readRepoFile(RECONCILE_LIB_PATH);
    // Positive assertions against the ask.
    assert.match(
      ask,
      /Reconcile refused \(governance_state_modified\)/,
      'V3 must quote the exact governance_state_modified refusal string',
    );
    assert.match(
      ask,
      /Reconcile refused \(history_rewrite\)/,
      'V3 must quote the exact history_rewrite refusal string',
    );
    // Backstop: the shipped error class strings must still exist in the library
    // so the ask does not drift out of sync silently.
    assert.match(lib, /governance_state_modified/);
    assert.match(lib, /history_rewrite/);
  });

  it('requires shipped-package evidence, not local checkout', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /evidence comes from an unversioned local checkout[\s\S]{0,120}published tarball/,
      'V3 must reject evidence produced from a local repo checkout',
    );
  });

  it('uses a heredoc state mutation instead of a brittle inline node -e command', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /node --input-type=module <<'NODE'[\s\S]*state\.operator_touched = true;[\s\S]*NODE/,
      'V3 Block 2 must use the portable heredoc mutation pattern',
    );
    assert.doesNotMatch(
      ask,
      /node -e 'const fs=require/,
      'V3 must not rely on shell-sensitive inline node -e quoting',
    );
  });

  it('describes the history rewrite as a divergent scratch commit, not an orphan commit', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /make a divergent commit so the[\s\S]{0,120}accepted_head/,
      'V3 Block 3 must describe the actual non-ancestor shape',
    );
    assert.doesNotMatch(
      ask,
      /orphan commit/,
      'V3 Block 3 must not mislabel the reset-plus-empty-commit shape as orphan history',
    );
    assert.match(
      ask,
      /Block 3 intentionally rewrites this scratch repo's history/,
      'V3 cleanup note must explain that only the scratch repo history is rewritten',
    );
  });

  it('requires scratch-only execution to avoid polluting real projects', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /do \*\*not\*\* run in `tusq\.dev` or any other real project/i,
      'V3 must warn testers against running the drift-creating blocks in a real project',
    );
  });

  it('does not claim automatic continuous-mode reconcile is still pending', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(
      ask,
      /auto_safe_only[\s\S]{0,180}already shipped in `agentxchain@2\.154\.7`/,
      'V3 must acknowledge the automatic continuous-mode reconcile policy shipped in 2.154.7',
    );
    assert.match(
      ask,
      /file it as a narrow BUG-62 follow-up/,
      'V3 must route newly discovered auto_safe_only edge cases to a narrow follow-up',
    );
    assert.doesNotMatch(
      ask,
      /automatic continuous-mode reconciliation[\s\S]{0,160}(still pending|currently still pending|begin the)/i,
      'V3 must not tell agents to begin already-shipped automatic reconciliation work after quote-back',
    );
  });

  it('lists concrete reject rules covering each block', () => {
    const ask = readRepoFile(ASK_V3_PATH);
    assert.match(ask, /Block 1 .*(exits non-zero|paths_touched|post-reconcile drift)/);
    assert.match(ask, /Block 2 exits `0`/);
    assert.match(ask, /Block 3 exits `0`/);
  });
});
