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
const SPEC = read('.planning/RUN_EXPORT_SPEC.md');

describe('Export CLI docs contract', () => {
  it('registers export with --format and --output in the CLI entrypoint', () => {
    const exportBlock = CLI_ENTRY.match(/\.command\('export'\)[\s\S]*?\.action\(exportCommand\)/);
    assert.ok(exportBlock, 'export command block found');
    assert.match(exportBlock[0], /--format <format>/);
    assert.match(exportBlock[0], /--output <path>/);
  });

  it('documents export in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `export` \| Inspection \| Emit a single JSON audit artifact for the current governed run \|/);
    assert.match(CLI_DOCS, /### `export`/);
  });

  it('documents the flag contract and scope boundary truthfully', () => {
    assert.match(CLI_DOCS, /agentxchain export \[--format json\] \[--output <path>\]/);
    assert.match(CLI_DOCS, /Only `json` is supported in this slice/);
    assert.match(CLI_DOCS, /Governed projects only/i);
    assert.match(CLI_DOCS, /stdout by default/i);
    assert.match(CLI_DOCS, /dispatch bundles, staging artifacts, hook audit/i);
  });
});

describe('Run export spec alignment', () => {
  it('ships a standalone run export spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-EXPORT-001/);
    assert.match(SPEC, /AT-EXPORT-008/);
    assert.match(SPEC, /Governed projects only/);
  });
});
