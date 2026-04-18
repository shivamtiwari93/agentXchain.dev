import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, '..', '..', 'website-v2', 'docs');
const page = readFileSync(resolve(docsRoot, 'choosing-a-template.mdx'), 'utf8');

describe('Choosing a template docs page', () => {
  it('AT-CHTEMPL-001: distinguishes manual-first baseline from project-type templates', () => {
    assert.ok(page.includes('Manual-first baseline'), 'must name manual-first baseline category');
    assert.ok(page.includes('Project-type templates'), 'must name project-type templates category');
  });

  it('AT-CHTEMPL-002: names generic as the zero-dependency cold start', () => {
    assert.ok(page.includes('generic') && page.includes('zero dependencies'), 'must describe generic as zero-dependency');
    assert.ok(page.includes('manual'), 'must mention manual runtimes');
  });

  it('AT-CHTEMPL-003: lists all shipped templates including the automation-pattern blueprint', () => {
    const templates = ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'full-local-cli', 'enterprise-app'];
    for (const t of templates) {
      assert.ok(page.includes(t), `must mention template: ${t}`);
    }
    assert.ok(page.includes('Automation-pattern template'), 'must name the automation-pattern category');
  });

  it('AT-CHTEMPL-004: explains when to pick generic vs project-type', () => {
    assert.ok(page.includes('Pick `generic` when'), 'must have generic decision guidance');
    assert.ok(page.includes('Pick a project-type template when'), 'must have project-type decision guidance');
  });

  it('AT-CHTEMPL-005: documents upgrade path from generic', () => {
    assert.ok(page.includes('template set'), 'must mention template set for upgrading');
  });

  it('AT-CHTEMPL-006: documents how to connect automation after scaffold', () => {
    assert.ok(page.includes('local_cli') || page.includes('api_proxy'), 'must mention connecting automation');
    assert.ok(page.includes('config --set'), 'must mention config --set for runtime changes');
  });
});
