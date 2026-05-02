import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const SPEC = read('.planning/REPLAY_TURN_COMMAND_SPEC.md');

describe('replay turn docs contract', () => {
  it('documents replay turn in the CLI docs and command map', () => {
    assert.match(CLI_DOCS, /\| `replay turn` \| Validation \|/);
    assert.match(CLI_DOCS, /### `replay turn`/);
    assert.match(CLI_DOCS, /agentxchain replay turn \[turn_id\]/);
    assert.match(CLI_DOCS, /--timeout <ms>/);
  });

  it('explains the boundary versus verify turn and accepted-turn history', () => {
    assert.match(CLI_DOCS, /verify turn.*staged active turn/is);
    assert.match(CLI_DOCS, /replay turn.*already accepted turn/is);
    assert.match(CLI_DOCS, /\.agentxchain\/history\.jsonl/);
    assert.match(CLI_DOCS, /fails closed on ambiguity/i);
    assert.match(CLI_DOCS, /does not mutate state, gate status, history, or ledgers/i);
  });

  it('ships a standalone spec with the replay-turn decision and acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /DEC-REPLAY-TURN-001/);
    assert.match(SPEC, /AT-RTURN-001/);
    assert.match(SPEC, /AT-RTURN-007/);
  });
});
