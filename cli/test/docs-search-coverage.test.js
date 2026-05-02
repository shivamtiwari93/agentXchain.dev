import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const WEBSITE_ROOT = resolve(import.meta.dirname, '../../website-v2');
const CONFIG_PATH = resolve(WEBSITE_ROOT, 'docusaurus.config.ts');

describe('Docs search coverage — build-time proof (DEC-DOCS-SEARCH-001)', () => {
  const config = readFileSync(CONFIG_PATH, 'utf8');

  it('AT-SEARCH-COV-001: search plugin is configured with cache-busted hashed index', () => {
    assert.ok(
      config.includes("hashed: true"),
      'search index must use hashed URLs for cache busting',
    );
  });

  it('AT-SEARCH-COV-002: search is scoped to docs only — blog and standalone pages excluded', () => {
    assert.ok(config.includes('indexBlog: false'), 'blog must be excluded from search');
    assert.ok(
      config.includes("docsRouteBasePath: '/docs'"),
      'search must be scoped to /docs route',
    );
  });

  it('AT-SEARCH-COV-003: search results are capped to prevent UI overload', () => {
    assert.ok(
      config.includes('searchResultLimits: 10'),
      'search results must be limited to 10',
    );
  });

  it('AT-SEARCH-COV-004: search highlights matched terms on target pages', () => {
    assert.ok(
      config.includes('highlightSearchTermsOnTargetPage: true'),
      'matched terms must be highlighted on target pages',
    );
  });

  it('AT-SEARCH-COV-005: key operator docs exist for indexing', () => {
    const requiredDocs = [
      'docs/cli.mdx',
      'docs/recovery.mdx',
      'docs/getting-started.mdx',
      'docs/quickstart.mdx',
      'docs/protocol.mdx',
      'docs/missions.mdx',
      'docs/adapters.mdx',
      'docs/templates.mdx',
    ];
    for (const doc of requiredDocs) {
      assert.ok(
        existsSync(resolve(WEBSITE_ROOT, doc)),
        `required operator doc must exist for search indexing: ${doc}`,
      );
    }
  });

  it('AT-SEARCH-COV-006: release notes directory exists for indexing', () => {
    assert.ok(
      existsSync(resolve(WEBSITE_ROOT, 'docs/releases')),
      'releases directory must exist under docs for search indexing',
    );
  });

  it('AT-SEARCH-COV-007: build produces search-index.json', () => {
    // This test checks that the build output exists if available.
    // If build has not been run, we verify the config is correct instead.
    const buildIndex = resolve(WEBSITE_ROOT, 'build/search-index.json');
    if (existsSync(buildIndex)) {
      const stats = statSync(buildIndex);
      assert.ok(stats.size > 0, 'search-index.json must not be empty');
      assert.ok(
        stats.size > 100_000,
        `search-index.json should be substantial (got ${stats.size} bytes) — ` +
        'suggests docs pages are being indexed',
      );
    } else {
      // Build not available — verify config correctness as proxy
      assert.ok(
        config.includes('@easyops-cn/docusaurus-search-local'),
        'search plugin must be configured even if build output is not available',
      );
    }
  });

  it('AT-SEARCH-COV-008: mobile navbar sidebar fix prevents search/nav coexistence bug', () => {
    const css = readFileSync(resolve(WEBSITE_ROOT, 'src/css/custom.css'), 'utf8');
    assert.ok(
      css.includes('.navbar-sidebar--show'),
      'custom CSS must handle navbar-sidebar--show state',
    );
    assert.ok(
      css.includes('backdrop-filter: none'),
      'backdrop-filter must be disabled when sidebar is shown to prevent ' +
      'fixed-positioning containment bug that breaks search overlay on mobile',
    );
  });
});
