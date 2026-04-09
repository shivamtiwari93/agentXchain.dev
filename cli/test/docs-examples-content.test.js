import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const EXAMPLES_PAGE = read('website-v2/docs/examples.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCUSAURUS_CONFIG = read('website-v2/docusaurus.config.ts');
const HOME_PAGE = read('website-v2/src/pages/index.tsx');

const PRODUCT_EXAMPLES = [
  'habit-board',
  'trail-meals-mobile',
  'async-standup-bot',
  'decision-log-linter',
  'schema-guard',
];

const CATEGORY_LABELS = [
  'Consumer SaaS',
  'Mobile',
  'B2B SaaS',
  'Developer Tool',
  'Open Source Library',
];

describe('examples docs page content', () => {
  it('AT-EDS-001: page file exists', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2/docs/examples.mdx')));
  });

  it('AT-EDS-002: page contains all five product example names', () => {
    for (const name of PRODUCT_EXAMPLES) {
      assert.match(EXAMPLES_PAGE, new RegExp(name), `missing example: ${name}`);
    }
  });

  it('AT-EDS-003: page contains category labels', () => {
    for (const label of CATEGORY_LABELS) {
      assert.match(EXAMPLES_PAGE, new RegExp(label), `missing category: ${label}`);
    }
  });

  it('AT-EDS-004: sidebar includes Examples entry', () => {
    assert.match(SIDEBARS, /'examples'/);
  });

  it('AT-EDS-005: footer includes Examples link', () => {
    assert.match(DOCUSAURUS_CONFIG, /label: 'Examples'/);
    assert.match(DOCUSAURUS_CONFIG, /to: '\/docs\/examples'/);
  });

  it('AT-EDS-006: page mentions provenance (TALK.md, git history, template validate)', () => {
    assert.match(EXAMPLES_PAGE, /TALK\.md/);
    assert.match(EXAMPLES_PAGE, /[Gg]it history/);
    assert.match(EXAMPLES_PAGE, /template validate/);
  });

  it('AT-EDS-007: each example section includes run commands', () => {
    for (const name of PRODUCT_EXAMPLES) {
      assert.match(EXAMPLES_PAGE, new RegExp(`examples/${name}`), `missing run path for ${name}`);
    }
    assert.match(EXAMPLES_PAGE, /node --test/);
    assert.match(EXAMPLES_PAGE, /npm test/);
  });
});

describe('examples homepage section', () => {
  it('homepage includes examples section with link to docs page', () => {
    assert.match(HOME_PAGE, /Browse all examples/);
    assert.match(HOME_PAGE, /\/docs\/examples/);
  });

  it('homepage lists all five product categories', () => {
    for (const label of CATEGORY_LABELS) {
      assert.match(HOME_PAGE, new RegExp(label), `missing homepage category: ${label}`);
    }
  });
});
