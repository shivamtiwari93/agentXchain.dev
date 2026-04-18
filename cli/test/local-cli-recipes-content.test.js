import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '..', '..', 'website-v2', 'docs');

describe('B-9: Local CLI recipes page content contracts', () => {
  const recipesPath = join(DOCS_ROOT, 'local-cli-recipes.mdx');

  it('AT-B9-001: local-cli-recipes.mdx exists', () => {
    assert.ok(existsSync(recipesPath), 'local-cli-recipes.mdx must exist');
  });

  it('AT-B9-002: includes Claude Code recipe with --dangerously-skip-permissions', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /## Claude Code/);
    assert.match(content, /--dangerously-skip-permissions/);
    assert.match(content, /"stdin"/);
  });

  it('AT-B9-003: includes Codex recipe with --dangerously-bypass-approvals-and-sandbox', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /## OpenAI Codex CLI/);
    assert.match(content, /--dangerously-bypass-approvals-and-sandbox/);
    assert.match(content, /\{prompt\}/);
    assert.match(content, /"argv"/);
  });

  it('AT-B9-004: warns that --full-auto is NOT sufficient for Codex authoritative', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /--full-auto.*NOT.*sufficient/i);
  });

  it('AT-B9-005: documents all three prompt transports', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /stdin/);
    assert.match(content, /argv/);
    assert.match(content, /dispatch_bundle_only/);
  });

  it('AT-B9-006: clarifies that Cursor/Windsurf are not CLI runtimes', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /Cursor.*Windsurf/);
    assert.match(content, /not.*headless CLI|not.*governed.*local CLI/i);
  });

  it('AT-B9-007: includes troubleshooting section', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /## Troubleshooting/);
    assert.match(content, /times out|hangs/i);
    assert.match(content, /authority_intent/);
    assert.match(content, /transport_intent/);
  });

  it('AT-B9-008: registered in sidebar', () => {
    const sidebars = readFileSync(join(DOCS_ROOT, '..', 'sidebars.ts'), 'utf8');
    assert.match(sidebars, /local-cli-recipes/);
  });

  it('AT-B9-009: automation-patterns links to local-cli-recipes', () => {
    const content = readFileSync(join(DOCS_ROOT, 'automation-patterns.mdx'), 'utf8');
    assert.match(content, /local-cli-recipes/i);
  });

  it('AT-B9-010: includes review_only + local_cli invalidity note', () => {
    const content = readFileSync(recipesPath, 'utf8');
    assert.match(content, /review_only.*Invalid.*local_cli|Invalid.*local_cli.*review_only/i);
  });
});
