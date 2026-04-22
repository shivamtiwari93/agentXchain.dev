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

function routeExists(route, docsRoutes, pageRoutes) {
  const clean = normalizeRoute(route);
  if (!clean.startsWith('/')) {
    return true;
  }
  if (clean.startsWith('/img/')) {
    return existsSync(join(STATIC_ROOT, clean));
  }
  if (clean.startsWith('/docs')) {
    return docsRoutes.has(clean);
  }
  return pageRoutes.has(clean) || existsSync(join(STATIC_ROOT, clean.slice(1)));
}

describe('website route integrity', () => {
  it('keeps internal navbar, footer, redirect-target, and markdown links routed', () => {
    const docsRoutes = new Set(['/docs']);
    for (const filePath of walkFiles(DOCS_ROOT, new Set(['.mdx']))) {
      docsRoutes.add(docsRouteForSource(filePath));
    }

    const pageRoutes = new Set(['/']);
    for (const filePath of walkFiles(PAGES_ROOT, new Set(['.mdx', '.tsx']))) {
      pageRoutes.add(pageRouteForSource(filePath));
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
    for (const filePath of scannedFiles) {
      const content = readFileSync(filePath, 'utf8');
      const relativeFile = relative(REPO_ROOT, filePath);

      for (const match of content.matchAll(/(?:^|[,{;\s(])(?:to|href)\s*[:=]\s*['"](\/[^'"]+)['"]|\]\((\/[^)\s]+)\)/gm)) {
        const route = match[1] ?? match[2];
        if (!route || route.startsWith('//')) {
          continue;
        }
        scannedRouteCount += 1;
        if (!routeExists(route, docsRoutes, pageRoutes)) {
          missing.push(`${relativeFile}: ${route}`);
        }
      }
    }

    assert.deepEqual(missing, [], `missing internal routes:\n${missing.join('\n')}`);
    assert.ok(
      scannedRouteCount >= 20,
      `route scanner extracted only ${scannedRouteCount} internal routes — regex likely regressed. Expected >= 20 across navbar/footer/pages/docs.`,
    );
  });
});
