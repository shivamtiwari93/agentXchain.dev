import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const BENCHMARK_SPEC = read('.planning/BENCHMARK_SPEC.md');
const BENCHMARK_OUTPUT_SPEC = read('.planning/BENCHMARK_OUTPUT_SPEC.md');
const BENCHMARK_WORKLOAD_SPEC = read('.planning/BENCHMARK_WORKLOAD_CATALOG_SPEC.md');

describe('benchmark docs truth boundary', () => {
  it('AT-BENCH-021: public benchmark docs scope saved proof bundles as repo-local and restate coordinator verify-diff truth separately', () => {
    assert.match(CLI_DOCS, /saved benchmark bundles are repo-local run exports today, not coordinator exports/i);
    assert.match(CLI_DOCS, /summary\.repo_run_statuses[\s\S]*raw coordinator snapshot metadata/i);
    assert.match(CLI_DOCS, /authority-first child repo status/i);
  });
});

describe('benchmark spec alignment', () => {
  it('AT-BENCH-021: durable benchmark specs freeze repo-local artifact scope and future coordinator verify-diff boundary', () => {
    assert.match(BENCHMARK_SPEC, /Saved benchmark proof currently uses repo-local run exports, not coordinator exports/i);
    assert.match(BENCHMARK_SPEC, /summary\.repo_run_statuses[\s\S]*coordinator snapshot metadata only/i);

    assert.match(BENCHMARK_OUTPUT_SPEC, /persisted `run-export\.json` bundle is a repo-local run export today, not a coordinator export/i);
    assert.match(BENCHMARK_OUTPUT_SPEC, /summary\.repo_run_statuses[\s\S]*stays raw coordinator metadata/i);
    assert.match(BENCHMARK_OUTPUT_SPEC, /authority-first child repo status/i);

    assert.match(BENCHMARK_WORKLOAD_SPEC, /They are repo-local exports today/i);
    assert.match(BENCHMARK_WORKLOAD_SPEC, /summary\.repo_run_statuses/i);
    assert.match(BENCHMARK_WORKLOAD_SPEC, /authority-first child repo-status contract/i);
  });
});
