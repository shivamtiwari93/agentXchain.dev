import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Adapter contract content guard', () => {
  const contract = read('.planning/ADAPTER_CONTRACT.md');

  it('AT-ACC-001: api_proxy contract documents proposed plus review_only support', () => {
    assert.match(contract, /Write authority support:\*\* `review_only` and `proposed`/);
    assert.doesNotMatch(contract, /review_only` ONLY/i);
    assert.match(contract, /rejects `authoritative`/i);
  });

  it('AT-ACC-002: api_proxy contract documents the load-bearing extraction pipeline', () => {
    assert.match(contract, /raw parse → markdown fence extraction → JSON boundary detection/);
    assert.match(contract, /contract invariant, not optional cleanup/i);
    assert.match(contract, /must not perform field-level repair/i);
  });

  it('AT-ACC-003: api_proxy contract documents all supported bundled providers', () => {
    assert.match(contract, /Supported providers:\*\* `anthropic`, `openai`, `google`, `ollama`/);
  });
});
