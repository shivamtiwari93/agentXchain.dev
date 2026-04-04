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
const EXPORT_LIB = read('cli/src/lib/export.js');
const EXPORT_VERIFIER = read('cli/src/lib/export-verifier.js');
const SPEC = read('.planning/EXPORT_VERIFICATION_SPEC.md');

describe('verify export docs contract', () => {
  it('registers verify export with --input and --format', () => {
    const verifyExportBlock = CLI_ENTRY.match(/\.command\('export'\)[\s\S]*?\.action\(verifyExportCommand\)/);
    assert.ok(verifyExportBlock, 'verify export command block found');
    assert.match(verifyExportBlock[0], /--input <path>/);
    assert.match(verifyExportBlock[0], /--format <format>/);
  });

  it('documents verify export in the command map and verification section', () => {
    assert.match(CLI_DOCS, /\| `verify export` \| Conformance \|/);
    assert.match(CLI_DOCS, /### `verify export`/);
    assert.match(CLI_DOCS, /agentxchain verify export \[--input <path>\|-] \[--format text\|json]/);
  });

  it('documents file-path and stdin input modes truthfully', () => {
    assert.match(CLI_DOCS, /read the export JSON from a file, or pass `-` to read from stdin/i);
    assert.match(CLI_DOCS, /`--input <path>`/);
    assert.match(CLI_DOCS, /`-` .*stdin|stdin.*`-`/i);
  });

  it('documents integrity behavior based on content_base64 and summary checks', () => {
    assert.match(CLI_DOCS, /content_base64/);
    assert.match(CLI_DOCS, /re-derive|recompute/i);
    assert.match(CLI_DOCS, /summary/i);
    assert.match(EXPORT_LIB, /content_base64/);
    assert.match(EXPORT_VERIFIER, /content_base64/);
  });

  it('documents exit-code semantics truthfully', () => {
    assert.match(CLI_DOCS, /\| `0` \| Export artifact verification passed \|/);
    assert.match(CLI_DOCS, /\| `1` \| Export artifact parsed but failed integrity or structural verification \|/);
    assert.match(CLI_DOCS, /\| `2` \| Command or input error \|/);
  });
});

describe('verify export spec alignment', () => {
  it('ships a standalone export verification spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-VERIFY-EXPORT-001/);
    assert.match(SPEC, /AT-VERIFY-EXPORT-008/);
    assert.match(SPEC, /content_base64/);
  });
});
