import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RELEASE_PAGE = read('website-v2/docs/releases/v2-102-0.mdx');
const BENCHMARK_SPEC = read('.planning/BENCHMARK_SPEC.md');

describe('v2.102.0 benchmark release notes truth boundary', () => {
  it('AT-BENCH-022: release-facing benchmark notes keep saved-artifact scope repo-local and restate coordinator verify-diff truth separately', () => {
    assert.match(RELEASE_PAGE, /repo-local run exports today, not coordinator exports/i);
    assert.match(RELEASE_PAGE, /not quietly exercising coordinator repo-status logic/i);
    assert.match(RELEASE_PAGE, /summary\.repo_run_statuses[\s\S]*raw coordinator snapshot metadata/i);
    assert.match(RELEASE_PAGE, /authority-first child repo status/i);
    assert.match(BENCHMARK_SPEC, /AT-BENCH-022/);
  });
});
