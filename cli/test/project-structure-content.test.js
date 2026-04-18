import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '..', '..', 'website-v2', 'docs');

describe('B-11: Project structure page content contracts', () => {
  const structurePath = join(DOCS_ROOT, 'project-structure.mdx');

  it('AT-B11-001: project-structure.mdx exists', () => {
    assert.ok(existsSync(structurePath), 'project-structure.mdx must exist');
  });

  it('AT-B11-002: explains committed vs. ignored split', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /commit.*this|committed.*governed.*state/i);
    assert.match(content, /gitignored|never commit/i);
  });

  it('AT-B11-003: lists all key committed governed state files', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /state\.json/);
    assert.match(content, /history\.jsonl/);
    assert.match(content, /events\.jsonl/);
    assert.match(content, /decision-ledger\.jsonl/);
    assert.match(content, /agentxchain\.json/);
  });

  it('AT-B11-004: lists transient artifacts that must be gitignored', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /staging\//);
    assert.match(content, /dispatch\//);
    assert.match(content, /transactions\//);
  });

  it('AT-B11-005: explains .planning/ layer and VISION.md ownership', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /\.planning\//);
    assert.match(content, /VISION\.md.*human.owned|human.*never modify/i);
  });

  it('AT-B11-006: includes freshly scaffolded project anatomy tree', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /my-project\/|scaffolded.*project.*anatomy/i);
  });

  it('AT-B11-007: registered in sidebar', () => {
    const sidebars = readFileSync(join(DOCS_ROOT, '..', 'sidebars.ts'), 'utf8');
    assert.match(sidebars, /project-structure/);
  });
});

describe('B-11: Scaffold .gitignore includes inline comments', () => {
  it('AT-B11-008: fresh governed scaffold gitignore includes transient execution paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-structure-'));
    try {
      scaffoldGoverned(root, 'Structure Test', `structure-${Date.now()}`);
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      assert.match(gitignore, /\.agentxchain\/staging\//);
      assert.match(gitignore, /\.agentxchain\/dispatch\//);
      assert.match(gitignore, /\.agentxchain\/transactions\//);
      assert.match(gitignore, /\.env/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
