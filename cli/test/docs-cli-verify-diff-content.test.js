import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const SPEC = read('.planning/VERIFY_DIFF_SPEC.md');

describe('verify diff docs contract', () => {
  it('registers verify diff with positional exports and --format', () => {
    const verifyDiffBlock = CLI_ENTRY.match(/\.command\('diff <left_export> <right_export>'\)[\s\S]*?\.action\(verifyDiffCommand\)/);
    assert.ok(verifyDiffBlock, 'verify diff command block found');
    assert.match(verifyDiffBlock[0], /--format <format>/);
  });

  it('documents verify diff in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `verify diff` \| Conformance \|/);
    assert.match(CLI_DOCS, /### `verify diff`/);
    assert.match(CLI_DOCS, /agentxchain verify diff <left_export\.json> <right_export\.json> \[--format text\|json]/);
  });

  it('documents the verification-before-diff fail-closed contract', () => {
    assert.match(CLI_DOCS, /verifies both export artifacts first/i);
    assert.match(CLI_DOCS, /skips the diff entirely if either artifact fails verification/i);
    assert.match(CLI_DOCS, /Governance Regressions/i);
    assert.match(CLI_DOCS, /authority-first child repo status/i);
    assert.match(CLI_DOCS, /summary\.repo_run_statuses[\s\S]*raw coordinator snapshot metadata/i);
  });

  it('documents exit-code semantics truthfully', () => {
    assert.match(CLI_DOCS, /\| `0` \| Both exports verify and no governance regressions are detected \|/);
    assert.match(CLI_DOCS, /\| `1` \| Export verification fails or governance regressions are detected \|/);
    assert.match(CLI_DOCS, /\| `2` \| Command or input error \(for example missing file or mismatched export kinds\) \|/);
  });
});

describe('verify diff spec alignment', () => {
  it('ships a standalone verify-diff spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-VERIFY-DIFF-001/);
    assert.match(SPEC, /AT-VERIFY-DIFF-007/);
    assert.match(SPEC, /skip regression diff construction/i);
    assert.match(SPEC, /summary\.repo_run_statuses[\s\S]*coordinator metadata only/i);
  });
});
