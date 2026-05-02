import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const EXPECTED_COMPARE_PAGES = [
  'vs-autogen.mdx',
  'vs-codegen.mdx',
  'vs-crewai.mdx',
  'vs-devin.mdx',
  'vs-langgraph.mdx',
  'vs-metagpt.mdx',
  'vs-openai-agents-sdk.mdx',
  'vs-openhands.mdx',
  'vs-warp.mdx',
];

describe('compare page architecture', () => {
  it('AT-CPC-001: no compare pages exist under src/pages/compare/', () => {
    const standaloneDir = join(REPO_ROOT, 'website-v2', 'src', 'pages', 'compare');
    assert.ok(
      !existsSync(standaloneDir),
      'src/pages/compare/ directory must not exist after consolidation',
    );
  });

  it('AT-CPC-002: no compare-*.mdx files exist directly under docs/', () => {
    const docsDir = join(REPO_ROOT, 'website-v2', 'docs');
    const topLevelCompare = readdirSync(docsDir).filter(f => f.startsWith('compare-') && f.endsWith('.mdx'));
    assert.deepStrictEqual(
      topLevelCompare,
      [],
      'Old compare-*.mdx files must not exist directly under docs/',
    );
  });

  it('AT-CPC-003: exactly 9 compare files exist under docs/compare/', () => {
    const compareDir = join(REPO_ROOT, 'website-v2', 'docs', 'compare');
    const files = readdirSync(compareDir).filter(f => f.endsWith('.mdx')).sort();
    assert.deepStrictEqual(files, EXPECTED_COMPARE_PAGES);
  });

  it('AT-CPC-004: sidebar config includes all 9 compare pages', () => {
    const sidebars = read('website-v2/sidebars.ts');
    for (const page of EXPECTED_COMPARE_PAGES) {
      const id = `compare/${page.replace('.mdx', '')}`;
      assert.ok(
        sidebars.includes(`'${id}'`),
        `Sidebar must include '${id}'`,
      );
    }
  });

  it('AT-CPC-005: navbar compare dropdown links to /docs/compare/vs-* paths', () => {
    const config = read('website-v2/docusaurus.config.ts');
    for (const page of EXPECTED_COMPARE_PAGES) {
      const slug = page.replace('.mdx', '');
      assert.ok(
        config.includes(`'/docs/compare/${slug}'`),
        `Navbar must link to /docs/compare/${slug}`,
      );
    }
    assert.ok(
      !config.includes("to: '/compare/vs-"),
      'Navbar must not link to old /compare/vs-* standalone paths',
    );
  });

  it('AT-CPC-006: homepage links to /docs/compare/vs-* paths', () => {
    const homepage = read('website-v2/src/pages/index.tsx');
    assert.ok(
      !homepage.includes('to="/compare/vs-'),
      'Homepage must not link to old /compare/vs-* standalone paths',
    );
    assert.ok(
      homepage.includes('to="/docs/compare/vs-'),
      'Homepage must link to /docs/compare/vs-* paths',
    );
  });

  it('AT-CPC-007: redirect config maps old standalone and old docs URLs', () => {
    const config = read('website-v2/docusaurus.config.ts');
    // Old standalone redirects
    assert.ok(config.includes("from: '/compare/vs-autogen'"), 'Must redirect /compare/vs-autogen');
    assert.ok(config.includes("from: '/compare/vs-warp'"), 'Must redirect /compare/vs-warp');
    // Old docs redirects
    assert.ok(config.includes("from: '/docs/compare-autogen'"), 'Must redirect /docs/compare-autogen');
    assert.ok(config.includes("from: '/docs/compare-crewai'"), 'Must redirect /docs/compare-crewai');
    assert.ok(config.includes("from: '/docs/compare-langgraph'"), 'Must redirect /docs/compare-langgraph');
  });
});
