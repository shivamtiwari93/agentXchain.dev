/**
 * llms.txt release-page coverage guard.
 *
 * Every release-notes page under website-v2/docs/releases/ must have a
 * corresponding entry in website-v2/static/llms.txt. This guard exists
 * because llms.txt drifted silently on 2026-04-22: pages for v2.153.0,
 * v2.154.0, v2.154.1, v2.154.3, and v2.154.5 existed under docs/releases
 * but were never added to llms.txt. current-release-surface.test.js only
 * asserts the *current* release is listed; it does not cover historical
 * coverage, which is what LLM crawlers rely on for the full release index.
 *
 * Scope is intentionally narrow: one file:one entry presence check in both
 * directions. It does not police ordering, formatting, or titles.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RELEASES_DIR = join(REPO_ROOT, 'website-v2', 'docs', 'releases');
const LLMS_TXT_PATH = join(REPO_ROOT, 'website-v2', 'static', 'llms.txt');

describe('llms.txt release-page coverage', () => {
  it('keeps release-notes pages and llms.txt release routes in sync', () => {
    const pages = readdirSync(RELEASES_DIR)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => f.replace(/\.mdx$/, ''));

    assert.ok(pages.length > 0, 'expected release-notes pages to exist');

    const llms = readFileSync(LLMS_TXT_PATH, 'utf8');
    const missing = pages.filter((docId) => {
      const route = `/docs/releases/${docId}`;
      return !llms.includes(route);
    });

    assert.deepEqual(
      missing,
      [],
      `llms.txt is missing release-notes entries for: ${missing.join(', ')}`,
    );

    const pageSet = new Set(pages);
    const routeMatches = llms.matchAll(/\]\(https:\/\/agentxchain\.dev\/docs\/releases\/([^)]+)\)/g);
    const stale = Array.from(routeMatches, (match) => match[1]).filter((docId) => !pageSet.has(docId));

    assert.deepEqual(
      stale,
      [],
      `llms.txt contains release-notes routes without matching .mdx pages: ${stale.join(', ')}`,
    );
  });
});
