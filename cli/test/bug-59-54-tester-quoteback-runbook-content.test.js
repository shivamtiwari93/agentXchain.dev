/**
 * BUG-59 / BUG-54 tester quote-back docs must reference real public CLI
 * surfaces and JSONL-correct ledger commands.
 *
 * Turn 192 audited the active BUG-59/BUG-54 quote-back docs after the BUG-52
 * runbook jq defect. Two drift hazards were found:
 *   1. docs referenced `agentxchain dispatch-turn`, which is not a public CLI
 *      command in `cli/bin/agentxchain.js`.
 *   2. the checklist used a JSON-array timestamp example for
 *      `.agentxchain/decision-ledger.jsonl`, which is newline-delimited JSON.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md';
const CHECKLIST_PATH = '.planning/BUG_54_BUG_59_TESTER_QUOTEBACK_CHECKLIST.md';
const LEGACY_RUNBOOK_PATH = '.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md';
const RELEASE_151_PATH = 'website-v2/docs/releases/v2-151-0.mdx';
const DOC_PATHS = [CHECKLIST_PATH, RUNBOOK_PATH];

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function fileExists(relPath) {
  try {
    readFileSync(join(REPO_ROOT, relPath), 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('BUG-59 / BUG-54 tester quote-back docs', () => {
  it('matches the current public command surface', () => {
    const bin = readRepoFile('cli/bin/agentxchain.js');
    assert.match(bin, /\.command\('run'\)/);
    assert.match(bin, /\.command\('step'\)/);
    assert.doesNotMatch(bin, /\.command\('dispatch-turn'\)/);
  });

  it('does not tell testers to run a non-existent dispatch-turn command', () => {
    for (const relPath of DOC_PATHS) {
      const doc = readRepoFile(relPath);
      assert.doesNotMatch(
        doc,
        /agentxchain\s+dispatch-turn/,
        `${relPath} must only reference public adapter-invoking commands`,
      );
    }
  });

  it('names public adapter-path commands for no-derivable-work BUG-54 diagnostics', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.match(runbook, /agentxchain run/);
    assert.match(runbook, /agentxchain step --role <role>/);
    assert.match(runbook, /agentxchain step --resume/);
  });

  it('treats decision-ledger.jsonl as JSONL, not a JSON array', () => {
    const checklist = readRepoFile(CHECKLIST_PATH);
    assert.doesNotMatch(
      checklist,
      /jq\s+'\.?\[0\]\.timestamp'/,
      'decision-ledger.jsonl freshness examples must not use JSON-array indexing',
    );
    assert.match(
      checklist,
      /jq -r 'select\(\.type == "approval_policy"\) \| \.timestamp' \.agentxchain\/decision-ledger\.jsonl \| head -n 1/,
      'checklist must provide a JSONL-safe approval_policy timestamp command',
    );
  });

  it('lives at the unversioned canonical path (legacy versioned filename absent)', () => {
    // Turn 209: BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md was renamed to drop the
    // version suffix so a BUG-59 minimum-version change does not silently rot the
    // canonical runbook path. Same correction pattern as BUG-52 Turn 207.
    assert.equal(
      fileExists(LEGACY_RUNBOOK_PATH),
      false,
      `Legacy versioned runbook ${LEGACY_RUNBOOK_PATH} must not reappear — use the unversioned ${RUNBOOK_PATH}`,
    );
    assert.equal(
      fileExists(RUNBOOK_PATH),
      true,
      `Canonical runbook ${RUNBOOK_PATH} must exist`,
    );
  });

  it('recommends 2.154.7 (BUG-52-safe target) and names the version matrix', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.match(
      runbook,
      /agentxchain@2\.154\.7/,
      'runbook must pin the recommended 2.154.7 target',
    );
    assert.match(
      runbook,
      /BUG-52 third-variant/i,
      'runbook must name the BUG-52 third-variant interaction that drives the 2.154.7 recommendation',
    );
    assert.match(
      runbook,
      /\|\s*`?2\.151\.0`?\s*\|/,
      'runbook must include the version-matrix row for 2.151.0 so testers can tell which older patches still loop on BUG-52',
    );
    assert.match(
      runbook,
      /\|\s*`?2\.154\.7`?\+?\s*\|/,
      'runbook must include the version-matrix row for 2.154.7+',
    );
  });

  it('no longer pins commands to the stale 2.151.0 npx target', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.doesNotMatch(
      runbook,
      /npx\s+--yes\s+-p\s+agentxchain@2\.151\.0/,
      'runbook must not pin command lines to 2.151.0; use 2.154.7 so testers do not hit the BUG-52 third-variant loop',
    );
    assert.doesNotMatch(
      runbook,
      /npx\s+--yes\s+-p\s+agentxchain@2\.15[0-3]\.0/,
      'runbook must not pin command lines to 2.150.x / 2.151.x / 2.152.x / 2.153.x — none of those carry the full BUG-52 third-variant fix',
    );
  });

  it('checklist retargets package-proof commands to 2.154.7', () => {
    const checklist = readRepoFile(CHECKLIST_PATH);
    assert.match(
      checklist,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7/,
      'checklist must pin package-proof verification to 2.154.7',
    );
    assert.match(
      checklist,
      /npm\s+view\s+agentxchain@2\.154\.7\s+version/,
      'agent cross-check must verify 2.154.7 is published',
    );
    assert.match(
      checklist,
      new RegExp(RUNBOOK_PATH.replace(/\./g, '\\.').replace(/\//g, '\\/')),
      'checklist must link to the canonical unversioned runbook path',
    );
  });

  it('public v2.151.0 release page points current BUG-59/54 quote-back to 2.154.7', () => {
    const releasePage = readRepoFile(RELEASE_151_PATH);
    assert.match(
      releasePage,
      /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.151.0 public release notes must warn that current BUG-59/54 quote-back uses the BUG-52-safe 2.154.7 target',
    );
    assert.match(
      releasePage,
      /BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.151.0 release notes must link operators to the canonical BUG-59/54 runbook',
    );
    assert.match(
      releasePage,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.151.0 tester contract command must use the current 2.154.7 target',
    );
    assert.doesNotMatch(
      releasePage,
      /npx\s+--yes\s+-p\s+agentxchain@2\.151\.0\s+-c "agentxchain --version"/,
      'v2.151.0 release notes may mention the historical version, but must not keep a live npx command pinned to it',
    );
    assert.match(
      releasePage,
      /default 180,000 ms threshold/,
      'BUG-54 public quote-back wording must match the current 180,000 ms default',
    );
    assert.doesNotMatch(
      releasePage,
      /startup watchdog default raised to 120,000 ms/,
      'v2.151.0 release notes must not preserve the stale 120,000 ms BUG-54 default',
    );
    assert.doesNotMatch(
      releasePage,
      /startup watchdog default\*\* raised from 30s to 120s/,
      'v2.151.0 intro must not preserve the stale 120s BUG-54 summary',
    );
  });
});
