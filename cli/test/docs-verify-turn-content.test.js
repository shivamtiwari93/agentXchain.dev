import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const SPEC = read('.planning/VERIFY_TURN_COMMAND_SPEC.md');

describe('verify turn docs contract', () => {
  it('documents verify turn in the CLI docs and command map', () => {
    assert.match(CLI_DOCS, /\| `verify turn` \| Validation \|/);
    assert.match(CLI_DOCS, /### `verify turn`/);
    assert.match(CLI_DOCS, /agentxchain verify turn \[turn_id\]/);
    assert.match(CLI_DOCS, /--timeout <ms>/);
  });

  it('explains the boundary versus validate --mode turn and machine_evidence replay', () => {
    assert.match(CLI_DOCS, /validate --mode turn/i);
    assert.match(CLI_DOCS, /verification\.machine_evidence/i);
    assert.match(CLI_DOCS, /verification\.commands/i);
    assert.match(CLI_DOCS, /verification\.evidence_summary/i);
    assert.match(CLI_DOCS, /not executable proof on their own/i);
    assert.match(CLI_DOCS, /Replay is not a sandbox/i);
    assert.match(CLI_DOCS, /does not mutate state, gate status, history, or ledgers/i);
  });

  it('ships a standalone spec with the verify-turn decision and acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /DEC-VERIFY-TURN-001/);
    assert.match(SPEC, /AT-VTURN-001/);
    assert.match(SPEC, /AT-VTURN-008/);
  });
});
