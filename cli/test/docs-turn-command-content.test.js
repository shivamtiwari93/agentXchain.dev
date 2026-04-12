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
const SPEC = read('.planning/TURN_INSPECTION_COMMAND_SPEC.md');

describe('Turn command docs contract', () => {
  it('registers turn show with artifact and json flags', () => {
    const block = CLI_ENTRY.match(/const turnCmd = program[\s\S]*?\.action\(turnShowCommand\);/);
    assert.ok(block, 'turn command block found');
    assert.match(block[0], /\.command\('show \[turn_id\]'\)/);
    assert.match(block[0], /--artifact <name>/);
    assert.match(block[0], /--json/);
  });

  it('documents turn show in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `turn show` \| Inspection \|/);
    assert.match(CLI_DOCS, /### `turn show`/);
  });

  it('documents dispatch-bundle inspection semantics and artifact usage', () => {
    assert.match(CLI_DOCS, /dispatch bundle/i);
    assert.match(CLI_DOCS, /If multiple active turns exist, pass the `turn_id` explicitly/i);
    assert.match(CLI_DOCS, /--artifact prompt/);
    assert.match(CLI_DOCS, /assignment`, `prompt`, `context`, or `manifest`/);
  });
});

describe('Turn command spec alignment', () => {
  it('ships a standalone turn inspection spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-TURN-001/);
    assert.match(SPEC, /AT-TURN-006/);
    assert.match(SPEC, /agentxchain turn show \[turn_id\]/);
  });
});
