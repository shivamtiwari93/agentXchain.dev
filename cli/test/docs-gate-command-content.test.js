import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const SPEC = read('.planning/GATE_INSPECTION_COMMAND_SPEC.md');

describe('gate command docs contract', () => {
  it('documents gate list and gate show in the CLI docs', () => {
    assert.match(CLI_DOCS, /### `gate list` \/ `gate show`/);
    assert.match(CLI_DOCS, /agentxchain gate list \[--json\]/);
    assert.match(CLI_DOCS, /agentxchain gate show <gate_id>/);
    assert.match(CLI_DOCS, /--evaluate/);
  });

  it('documents gate list and gate show in the command map table', () => {
    assert.match(CLI_DOCS, /\| `gate list` \| Inspection \|/);
    assert.match(CLI_DOCS, /\| `gate show` \| Inspection \|/);
  });

  it('explains linked phase, effective artifacts, verification, and --evaluate', () => {
    assert.match(CLI_DOCS, /linked phase/i);
    assert.match(CLI_DOCS, /effective artifacts/i);
    assert.match(CLI_DOCS, /workflow-kit/i);
    assert.match(CLI_DOCS, /latest accepted turn/i);
    assert.match(CLI_DOCS, /live runtime gate semantics/i);
  });

  it('has a shipped spec with the correct decision reference', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /DEC-GATE-INSPECT-001/);
    assert.match(SPEC, /AT-GATE-001/);
    assert.match(SPEC, /AT-GATE-009/);
  });
});
