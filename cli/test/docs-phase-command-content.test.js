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
const SPEC = read('.planning/PHASE_INSPECTION_COMMAND_SPEC.md');

describe('Phase command docs contract', () => {
  it('registers phase list and phase show with json support', () => {
    const block = CLI_ENTRY.match(/const phaseCmd = program[\s\S]*?\.action\(\(phaseId, opts\) => phaseCommand\('show', phaseId, opts\)\);/);
    assert.ok(block, 'phase command block found');
    assert.match(block[0], /\.command\('list'\)/);
    assert.match(block[0], /\.command\('show \[phase\]'\)/);
    assert.match(block[0], /--json/);
  });

  it('documents phase inspection in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `phase list` \| Inspection \|/);
    assert.match(CLI_DOCS, /\| `phase show` \| Inspection \|/);
    assert.match(CLI_DOCS, /### `phase list` \/ `phase show`/);
  });

  it('documents workflow and routing inspection semantics', () => {
    assert.match(CLI_DOCS, /routing order/i);
    assert.match(CLI_DOCS, /entry role/i);
    assert.match(CLI_DOCS, /workflow-kit/i);
    assert.match(CLI_DOCS, /default workflow-kit/i);
  });
});

describe('Phase command spec alignment', () => {
  it('ships a standalone phase inspection spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-PHASE-001/);
    assert.match(SPEC, /AT-PHASE-006/);
    assert.match(SPEC, /agentxchain phase show \[phase\]/);
  });
});
