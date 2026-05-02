import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    assert.match(content, /committed.*project contract|commit this/i);
    assert.match(content, /gitignored by default|never commit/i);
  });

  it('AT-B11-003: lists key durable framework state files', () => {
    const content = readFileSync(structurePath, 'utf8');
    assert.match(content, /state\.json/);
    assert.match(content, /history\.jsonl/);
    assert.match(content, /events\.jsonl/);
    assert.match(content, /decision-ledger\.jsonl/);
    assert.match(content, /gitignored by default/i);
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
  it('AT-B11-008: fresh governed scaffold gitignore includes transient and framework-owned runtime paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-structure-'));
    try {
      scaffoldGoverned(root, 'Structure Test', `structure-${Date.now()}`);
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      assert.match(gitignore, /\.agentxchain\/staging\//);
      assert.match(gitignore, /\.agentxchain\/dispatch\//);
      assert.match(gitignore, /\.agentxchain\/transactions\//);
      assert.match(gitignore, /\.agentxchain\/state\.json/);
      assert.match(gitignore, /\.agentxchain\/SESSION_RECOVERY\.md/);
      assert.match(gitignore, /^TALK\.md$/m);
      assert.match(gitignore, /^HUMAN_TASKS\.md$/m);
      assert.match(gitignore, /\.env/);
      assert.match(gitignore, /framework-owned state/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-B11-009: governed scaffold preserves existing gitignore lines and appends missing runtime-state entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-structure-existing-ignore-'));
    try {
      const gitignorePath = join(root, '.gitignore');
      writeFileSync(gitignorePath, 'custom-cache/\n');
      scaffoldGoverned(root, 'Structure Test', `structure-${Date.now()}`);
      const gitignore = readFileSync(gitignorePath, 'utf8');
      assert.match(gitignore, /^custom-cache\/$/m);
      assert.match(gitignore, /\.agentxchain\/state\.json/);
      assert.match(gitignore, /^TALK\.md$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('B-11: Scaffold file-listing docs distinguish committed vs gitignored', () => {
  const readmePath = join(__dirname, '..', '..', 'README.md');
  const quickstartPath = join(DOCS_ROOT, 'quickstart.mdx');
  const firstTurnPath = join(DOCS_ROOT, 'first-turn.mdx');

  it('AT-B11-010: README scaffold listing annotates runtime state as gitignored', () => {
    const content = readFileSync(readmePath, 'utf8');
    assert.match(content, /state\.json.*gitignored by default/i);
    assert.match(content, /history\.jsonl.*gitignored by default/i);
    assert.match(content, /TALK\.md.*gitignored by default/i);
    assert.match(content, /agentxchain\.json.*commit this/i);
  });

  it('AT-B11-011: quickstart scaffold table distinguishes committed vs gitignored', () => {
    const content = readFileSync(quickstartPath, 'utf8');
    assert.match(content, /Runtime state.*Gitignored by default/i);
    assert.match(content, /Configuration.*Committed/i);
    assert.match(content, /Planning artifacts.*Committed/i);
  });

  it('AT-B11-012: first-turn scaffold tree annotates gitignored runtime state', () => {
    const content = readFileSync(firstTurnPath, 'utf8');
    assert.match(content, /state\.json.*gitignored by default/i);
    assert.match(content, /history\.jsonl.*gitignored by default/i);
    assert.match(content, /TALK\.md.*gitignored by default/i);
    assert.match(content, /agentxchain\.json.*commit this/i);
  });
});
