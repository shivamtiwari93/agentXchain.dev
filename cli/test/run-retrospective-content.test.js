import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const SPEC = read('.planning/RUN_RETROSPECTIVE_SPEC.md');

describe('run retrospective docs contract', () => {
  it('documents terminal retrospective in inherited context and run history docs', () => {
    assert.match(CLI_DOCS, /terminal retrospective/);
    assert.match(CLI_DOCS, /run-history\.jsonl.*retrospective/s);
    assert.match(CLI_DOCS, /inherited_context/);
  });
});

describe('run retrospective spec alignment', () => {
  it('keeps the frozen spec aligned to the shipped additive fields', () => {
    assert.match(SPEC, /retrospective/);
    assert.match(SPEC, /parent_retrospective/);
    assert.match(SPEC, /AT-RR-001/);
    assert.match(SPEC, /AT-RR-005/);
  });
});
