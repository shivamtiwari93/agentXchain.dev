import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const MULTI_PAGE = read('website-v2/docs/multi-repo.mdx');
const SPEC = read('.planning/MULTI_REPO_QUICKSTART_SPEC.md');

describe('multi-repo quickstart docs contract', () => {
  it('documents child repo scaffolds under repos/', () => {
    assert.match(QUICKSTART, /--dir repos\/api/);
    assert.match(QUICKSTART, /--dir repos\/web/);
    assert.match(QUICKSTART, /template validate/);
  });

  it('documents the coordinator config and command loop', () => {
    for (const token of [
      'agentxchain-multi.json',
      'agentxchain multi init',
      'agentxchain multi step --json',
      'agentxchain multi approve-gate',
      'qa_sync',
    ]) {
      assert.match(QUICKSTART, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('documents the two-level gate model explicitly', () => {
    assert.match(QUICKSTART, /accept-turn/);
    assert.match(QUICKSTART, /approve-transition/);
    assert.match(QUICKSTART, /coordinator does not erase child repo gates/i);
    assert.match(QUICKSTART, /repo-local .*approve-transition/i);
  });

  it('documents coordinator context artifacts for downstream repos', () => {
    assert.match(QUICKSTART, /COORDINATOR_CONTEXT\.json/);
    assert.match(QUICKSTART, /COORDINATOR_CONTEXT\.md/);
  });

  it('documents the coordinator-child phase alignment rule', () => {
    assert.match(QUICKSTART, /default governed scaffold uses `planning -> implementation -> qa`/i);
    assert.match(QUICKSTART, /multi init.*rejects mismatches/i);
  });

  it('links the deep-dive multi-repo page back to the quickstart section', () => {
    assert.match(MULTI_PAGE, /\/docs\/quickstart#multi-repo-cold-start/);
  });
});

describe('multi-repo quickstart spec alignment', () => {
  it('ships a standalone spec with the cold-start acceptance contract', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+Shipped/i);
    assert.match(SPEC, /AT-MRQ-001/);
    assert.match(SPEC, /AT-MRQ-006/);
    assert.match(SPEC, /repo-local `approve-transition`/);
  });
});
