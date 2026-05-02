import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('parallel-turns docs content', () => {
  const docsPath = join(repoRoot, 'website-v2', 'docs', 'parallel-turns.mdx');
  const sidebarsPath = join(repoRoot, 'website-v2', 'sidebars.ts');
  const llmsPath = join(repoRoot, 'website-v2', 'static', 'llms.txt');

  it('AT-PARDOC-001: parallel-turns.mdx exists', () => {
    assert.ok(existsSync(docsPath), 'parallel-turns.mdx should exist');
  });

  it('AT-PARDOC-002: docs page explains max_concurrent_turns config', () => {
    const content = readFileSync(docsPath, 'utf8');
    assert.ok(content.includes('max_concurrent_turns'), 'should explain max_concurrent_turns');
    assert.ok(content.includes('routing'), 'should mention routing config');
  });

  it('AT-PARDOC-003: docs page covers concurrent dispatch and sequential acceptance', () => {
    const content = readFileSync(docsPath, 'utf8');
    assert.ok(content.includes('concurrent') || content.includes('Concurrent'), 'should mention concurrent dispatch');
    assert.ok(content.includes('sequential') || content.includes('Sequential') || content.includes('serial'), 'should mention sequential acceptance');
  });

  it('AT-PARDOC-004: docs page documents limitations', () => {
    const content = readFileSync(docsPath, 'utf8');
    assert.ok(content.includes('Maximum 4') || content.includes('maximum 4') || content.includes('hard cap of 4'), 'should document max 4 limit');
    assert.ok(content.includes('One active turn per role') || content.includes('one active turn per role'), 'should document per-role exclusion');
  });

  it('AT-PARDOC-005: docs page documents parallel_dispatch event', () => {
    const content = readFileSync(docsPath, 'utf8');
    assert.ok(content.includes('parallel_dispatch'), 'should document parallel_dispatch event');
  });

  it('AT-PARDOC-006: sidebar includes parallel-turns', () => {
    const sidebar = readFileSync(sidebarsPath, 'utf8');
    assert.ok(sidebar.includes("'parallel-turns'"), 'sidebars.ts should include parallel-turns');
  });

  it('AT-PARDOC-007: llms.txt includes parallel-turns', () => {
    const llms = readFileSync(llmsPath, 'utf8');
    assert.ok(llms.includes('parallel-turns'), 'llms.txt should include parallel-turns URL');
  });
});

describe('parallel proof script contract', () => {
  const proofPath = join(repoRoot, 'examples', 'governed-todo-app', 'run-parallel-proof.mjs');

  it('AT-PARPROOF-001: parallel proof script exists', () => {
    assert.ok(existsSync(proofPath), 'run-parallel-proof.mjs should exist');
  });

  it('AT-PARPROOF-002: proof script configures max_concurrent_turns > 1', () => {
    const content = readFileSync(proofPath, 'utf8');
    assert.ok(content.includes('max_concurrent_turns: 2'), 'should configure max_concurrent_turns: 2');
  });

  it('AT-PARPROOF-003: proof script validates both impl roles participated', () => {
    const content = readFileSync(proofPath, 'utf8');
    assert.ok(content.includes('backend_dev') && content.includes('frontend_dev'), 'should check both impl roles');
    assert.ok(content.includes('both_impl_roles_participated'), 'should validate both roles participated');
  });

  it('AT-PARPROOF-004: proof script uses real CLI binary', () => {
    const content = readFileSync(proofPath, 'utf8');
    assert.ok(content.includes('agentxchain.js'), 'should reference agentxchain.js binary');
    assert.ok(content.includes('--auto-approve'), 'should use --auto-approve flag');
  });

  it('AT-PARPROOF-005: proof script validates governance artifacts', () => {
    const content = readFileSync(proofPath, 'utf8');
    assert.ok(content.includes('history.jsonl'), 'should validate history');
    assert.ok(content.includes('decision-ledger.jsonl'), 'should validate decision ledger');
    assert.ok(content.includes('export_exists'), 'should check export report');
  });
});
