import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const docsPath = join(repoRoot, 'website-v2', 'docs', 'delegation-chains.mdx');

describe('delegation-chains docs content', () => {
  const doc = readFileSync(docsPath, 'utf8');

  it('AT-DELDOC-001: delegation-chains.mdx exists', () => {
    assert.ok(existsSync(docsPath), 'delegation-chains.mdx should exist');
  });

  it('AT-DELDOC-002: docs name the delegation proof script and command', () => {
    assert.match(doc, /run-delegation-proof\.mjs/);
    assert.match(doc, /node examples\/governed-todo-app\/run-delegation-proof\.mjs --json/);
  });

  it('AT-DELDOC-003: docs record dated delegation proof evidence', () => {
    assert.match(doc, /2026-04-14/);
    assert.match(doc, /director -> dev -> qa -> director/i);
    assert.match(doc, /real `local_cli` adapter/i);
    assert.match(doc, /review-turn\.json/);
  });

  it('AT-DELDOC-004: docs preserve the v1 same-role sequential limitation', () => {
    assert.match(doc, /Same-role delegation parallelism/i);
    assert.match(doc, /cannot execute concurrently/i);
    assert.match(doc, /execute sequentially/i);
  });

  it('AT-DELDOC-005: docs name the failure-path proof script and command', () => {
    assert.match(doc, /run-delegation-failure-proof\.mjs/);
    assert.match(doc, /node examples\/governed-todo-app\/run-delegation-failure-proof\.mjs --json/);
  });

  it('AT-DELDOC-006: docs describe delegation failure handling behavior', () => {
    assert.match(doc, /Failure Handling/i);
    assert.match(doc, /mixed results/i);
    assert.match(doc, /failed_count.*1/);
    assert.match(doc, /completed_count.*1/);
  });

  it('AT-DELDOC-007: docs describe that failed delegations trigger review, not escalation', () => {
    assert.match(doc, /surfaced.*not swallowed/i);
    assert.match(doc, /reviewing role.*sees/i);
  });
});
