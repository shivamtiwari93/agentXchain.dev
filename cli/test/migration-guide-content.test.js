import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '..', '..', 'website-v2', 'docs');

describe('B-6: Manual-to-automated migration guide content contracts', () => {
  const migrationPath = join(DOCS_ROOT, 'manual-to-automated-migration.mdx');

  it('AT-B6-001: migration guide exists', () => {
    assert.ok(existsSync(migrationPath), 'manual-to-automated-migration.mdx must exist');
  });

  it('AT-B6-002: covers the 9-step numbered sequence', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /## Step 1/);
    assert.match(content, /## Step 2/);
    assert.match(content, /## Step 3.*runtime/i);
    assert.match(content, /## Step 4.*role/i);
    assert.match(content, /## Step 5.*connector.*check/i);
    assert.match(content, /## Step 6.*commit/i);
    assert.match(content, /## Step 7.*reissue/i);
    assert.match(content, /## Step 8.*first.*automated/i);
    assert.match(content, /## Step 9.*inject/i);
  });

  it('AT-B6-003: states that PM planning CAN be automated', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /PM.*automation.*real|PM.*planning.*can.*be.*automated/i);
  });

  it('AT-B6-004: includes commit-before-first-turn guidance', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /commit.*config.*changes/i);
    assert.match(content, /clean.*baseline|clean.*git/i);
  });

  it('AT-B6-005: links to local-cli-recipes', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /local-cli-recipes/);
  });

  it('AT-B6-006: links to automation-patterns', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /automation-patterns/);
  });

  it('AT-B6-007: includes the full-local-cli template alternative', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /full-local-cli/);
    assert.match(content, /--template full-local-cli/);
  });

  it('AT-B6-008: includes generic-to-CLI overlay pattern', () => {
    const content = readFileSync(migrationPath, 'utf8');
    assert.match(content, /overlay|overlay pattern|template.*overlay/i);
  });

  it('AT-B6-009: registered in sidebar', () => {
    const sidebars = readFileSync(join(DOCS_ROOT, '..', 'sidebars.ts'), 'utf8');
    assert.match(sidebars, /manual-to-automated-migration/);
  });
});
