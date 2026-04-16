import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const V2_98_RELEASE = read('website-v2/docs/releases/v2-98-0.mdx');
const V2_100_RELEASE = read('website-v2/docs/releases/v2-100-0.mdx');
const SPEC = read('.planning/VERIFY_DIFF_RELEASE_HISTORY_SPEC.md');

describe('verify diff release-notes truth boundary', () => {
  it('AT-REL-VD-001: v2.98.0 keeps coordinator export drift tied to authority-first child repo status', () => {
    assert.match(V2_98_RELEASE, /authority-first child repo status/i);
    assert.match(V2_98_RELEASE, /nested child exports are readable/i);
    assert.match(V2_98_RELEASE, /summary\.repo_run_statuses[\s\S]*raw coordinator snapshot metadata/i);
    assert.match(SPEC, /AT-REL-VD-001/);
  });

  it('AT-REL-VD-002: v2.100.0 keeps coordinator regressions off raw snapshot metadata alone', () => {
    assert.match(V2_100_RELEASE, /authority-first child repo status/i);
    assert.match(V2_100_RELEASE, /nested child exports are readable/i);
    assert.match(V2_100_RELEASE, /Stale `summary\.repo_run_statuses` alone does not create a coordinator repo-status regression/i);
    assert.match(SPEC, /AT-REL-VD-002/);
  });
});
