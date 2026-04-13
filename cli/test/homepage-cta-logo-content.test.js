import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const SPEC = read('.planning/WEBSITE_HOMEPAGE_CTA_LOGO_ALIGNMENT_SPEC.md');
const HOME_PAGE = read('website-v2/src/pages/index.tsx');
const CSS = read('website-v2/src/css/custom.css');
const CTA_FUNCTION = HOME_PAGE.match(/function CTA\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';

describe('homepage CTA logo alignment contract', () => {
  it('records the centering contract and acceptance tests', () => {
    assert.match(SPEC, /# Website Homepage CTA Logo Alignment Spec/);
    assert.match(SPEC, /AT-CTA-LOGO-001/);
    assert.match(SPEC, /AT-CTA-LOGO-003/);
  });

  it('uses a CTA-specific logo class in the end-of-page CTA', () => {
    assert.match(HOME_PAGE, /<section className="cta-section">/);
    assert.match(CTA_FUNCTION, /className="cta-logo"/);
    assert.doesNotMatch(CTA_FUNCTION, /className="hero-logo"/);
  });

  it('centers the CTA logo in CSS instead of relying on text alignment', () => {
    assert.match(CSS, /\.cta-section \.cta-logo \{/);
    assert.match(CSS, /\.cta-section \.cta-logo \{[\s\S]*display:\s*block;/);
    assert.match(CSS, /\.cta-section \.cta-logo \{[\s\S]*margin:\s*0 auto 1\.5rem;/);
  });
});
