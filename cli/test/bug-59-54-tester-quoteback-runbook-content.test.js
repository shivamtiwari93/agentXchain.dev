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
const DOC_PATHS = [
  '.planning/BUG_54_BUG_59_TESTER_QUOTEBACK_CHECKLIST.md',
  '.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md',
];

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
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
    const runbook = readRepoFile('.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md');
    assert.match(runbook, /agentxchain run/);
    assert.match(runbook, /agentxchain step --role <role>/);
    assert.match(runbook, /agentxchain step --resume/);
  });

  it('treats decision-ledger.jsonl as JSONL, not a JSON array', () => {
    const checklist = readRepoFile('.planning/BUG_54_BUG_59_TESTER_QUOTEBACK_CHECKLIST.md');
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
});
