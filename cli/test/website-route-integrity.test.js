import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WEBSITE_ROOT = join(REPO_ROOT, 'website-v2');
const DOCS_ROOT = join(WEBSITE_ROOT, 'docs');
const PAGES_ROOT = join(WEBSITE_ROOT, 'src', 'pages');
const STATIC_ROOT = join(WEBSITE_ROOT, 'static');

function walkFiles(root, extensions) {
  const files = [];
  for (const name of readdirSync(root)) {
    const filePath = join(root, name);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(filePath, extensions));
    } else if (extensions.has(extname(filePath))) {
      files.push(filePath);
    }
  }
  return files;
}

function normalizeRoute(route) {
  const clean = route.replace(/[#?].*$/, '').replace(/\/$/, '');
  return clean || '/';
}

// Mirror Docusaurus's heading-slug algorithm (github-slugger v1, which Docusaurus
// bundles). Two semantics must match exactly or the validator silently accepts
// links that 404 in production:
//   1. github-slugger strips a specific punctuation set (ASCII symbols plus the
//      Unicode "General Punctuation" block U+2000-U+206F which contains the
//      em-dash U+2014 and en-dash U+2013) — NOT "every non-alphanumeric char".
//   2. github-slugger replaces each single space char with `-` (`/ /g`), so two
//      consecutive spaces become two hyphens. Using `/\s+/g` collapses runs and
//      silently disagrees with real Docusaurus output on any heading that
//      contains stripped punctuation surrounded by spaces (e.g., "Foo — Bar"
//      renders `foo--bar`, not `foo-bar`).
// Regex mirrors `github-slugger/regex.js` for the ASCII + common-unicode cases
// that actually appear in our docs. Keep in sync with that package if we ever
// upgrade Docusaurus and it swaps the slugger.
const GITHUB_SLUGGER_BANNED = /[\0-\x1F!-,./:-@[-^`{-\xA9\xAB-\xB4\xB6-\xB9\xBB-\xBF\xD7\xF7\u2000-\u206F\u2E00-\u2E7F]/g;

function normalizeAnchor(anchor) {
  return anchor
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z0-9#]+;/gi, '')
    .replace(GITHUB_SLUGGER_BANNED, '')
    .replace(/ /g, '-');
}

function anchorsForMarkdown(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = normalizeAnchor(match[1].replace(/\s+\{#[^}]+\}\s*$/, ''));
    if (!base) {
      continue;
    }
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) {
    anchors.add(match[1]);
  }
  for (const match of text.matchAll(/\{#([^}]+)\}/g)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function frontMatter(text) {
  return text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
}

function frontMatterValue(text, key) {
  return frontMatter(text).match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))?.[1] ?? null;
}

function docsRouteForSource(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const slug = frontMatterValue(text, 'slug');
  if (slug) {
    return normalizeRoute(`/docs${slug.startsWith('/') ? slug : `/${slug}`}`);
  }

  const docId = relative(DOCS_ROOT, filePath)
    .split(sep)
    .join('/')
    .replace(/\.mdx$/, '')
    .replace(/\/index$/, '');
  return normalizeRoute(`/docs/${docId}`);
}

function pageRouteForSource(filePath) {
  const pageId = relative(PAGES_ROOT, filePath)
    .split(sep)
    .join('/')
    .replace(/\.(mdx|tsx)$/, '')
    .replace(/\/index$/, '');
  return normalizeRoute(`/${pageId}`);
}

function routeExists(route, docsRoutes, pageRoutes, anchorRoutes) {
  const clean = normalizeRoute(route);
  if (!clean.startsWith('/')) {
    return true;
  }
  if (clean.startsWith('/img/')) {
    return existsSync(join(STATIC_ROOT, clean));
  }
  if (clean.startsWith('/docs')) {
    if (!docsRoutes.has(clean)) {
      return false;
    }
  } else if (!pageRoutes.has(clean) && !existsSync(join(STATIC_ROOT, clean.slice(1)))) {
    return false;
  }

  const anchor = route.match(/#([^?]+)/)?.[1];
  if (!anchor) {
    return true;
  }
  return anchorRoutes.get(clean)?.has(anchor) === true;
}

describe('website route integrity', () => {
  it('keeps internal navbar, footer, redirect-target, markdown links, and anchors routed', () => {
    const docsRoutes = new Set(['/docs']);
    const anchorRoutes = new Map();
    for (const filePath of walkFiles(DOCS_ROOT, new Set(['.mdx']))) {
      const route = docsRouteForSource(filePath);
      docsRoutes.add(route);
      anchorRoutes.set(route, anchorsForMarkdown(readFileSync(filePath, 'utf8')));
    }

    const pageRoutes = new Set(['/']);
    for (const filePath of walkFiles(PAGES_ROOT, new Set(['.mdx', '.tsx']))) {
      const route = pageRouteForSource(filePath);
      pageRoutes.add(route);
      anchorRoutes.set(route, anchorsForMarkdown(readFileSync(filePath, 'utf8')));
    }

    const scannedFiles = [
      join(WEBSITE_ROOT, 'docusaurus.config.ts'),
      join(WEBSITE_ROOT, 'sidebars.ts'),
      join(WEBSITE_ROOT, 'src', 'data', 'integrations.mjs'),
      ...walkFiles(DOCS_ROOT, new Set(['.mdx'])),
      ...walkFiles(PAGES_ROOT, new Set(['.mdx', '.tsx'])),
    ];

    const missing = [];
    let scannedRouteCount = 0;
    let scannedHrefRouteCount = 0;
    let scannedLinkPropertyRouteCount = 0;
    for (const filePath of scannedFiles) {
      const content = readFileSync(filePath, 'utf8');
      const relativeFile = relative(REPO_ROOT, filePath);

      for (const match of content.matchAll(/(?:^|[,{;\s(])((?:to|href|link))\s*[:=]\s*['"](\/[^'"]+)['"]|\]\((\/[^)\s]+)\)/gm)) {
        const propertyName = match[1];
        const route = match[2] ?? match[3];
        if (!route || route.startsWith('//')) {
          continue;
        }
        if (propertyName === 'href') {
          scannedHrefRouteCount += 1;
        }
        if (propertyName === 'link') {
          scannedLinkPropertyRouteCount += 1;
        }
        scannedRouteCount += 1;
        if (!routeExists(route, docsRoutes, pageRoutes, anchorRoutes)) {
          missing.push(`${relativeFile}: ${route}`);
        }
      }
    }

    assert.deepEqual(missing, [], `missing internal routes:\n${missing.join('\n')}`);
    assert.ok(
      scannedRouteCount >= 20,
      `route scanner extracted only ${scannedRouteCount} internal routes — regex likely regressed. Expected >= 20 across navbar/footer/pages/docs.`,
    );
    assert.ok(
      scannedHrefRouteCount >= 20,
      `route scanner extracted only ${scannedHrefRouteCount} href: internal routes — integration cards and config hrefs are likely unguarded.`,
    );
    assert.ok(
      scannedLinkPropertyRouteCount >= 5,
      `route scanner extracted only ${scannedLinkPropertyRouteCount} link: internal routes — homepage layer links are likely unguarded.`,
    );
  });

  // Parity fixture pinned against real `github-slugger` v1 output (the copy
  // bundled by Docusaurus). Regenerate the `expected` values by running
  //   node -e "const S=require('github-slugger');const s=new S();console.log(s.slug('<heading>'))"
  // against `website-v2/node_modules/github-slugger`. If this test fails, the
  // route guard is silently disagreeing with production Docusaurus URLs.
  it('slugifies headings identically to github-slugger (production Docusaurus)', () => {
    const cases = [
      // Em-dash surrounded by spaces → double hyphen (NOT collapsed).
      ['Blueprint-backed templates — custom roles and phases', 'blueprint-backed-templates--custom-roles-and-phases'],
      ['CLI Proof — Happy Path', 'cli-proof--happy-path'],
      ['Step 1 — Scaffold', 'step-1--scaffold'],
      // ASCII punctuation stripped.
      ["Don't use X", 'dont-use-x'],
      ['What AgentXchain enforces — regardless of pattern', 'what-agentxchain-enforces--regardless-of-pattern'],
      // Hyphens preserved, no collapse.
      ['Blueprint-backed templates', 'blueprint-backed-templates'],
      // Multiple spaces preserved as multiple hyphens.
      ['Foo  Bar', 'foo--bar'],
      // Arrow U+2192 is in U+2E00–U+2E7F? No — U+2192 is in U+2190–U+21FF (Arrows block), NOT banned. It survives.
      // Intentionally not asserting on arrows; none of our docs use arrows inside heading text that is also targeted by an in-repo link.
    ];
    const actual = cases.map(([heading]) => [heading, normalizeAnchor(heading)]);
    assert.deepEqual(actual, cases, 'slug output drifted from github-slugger');
  });
});
