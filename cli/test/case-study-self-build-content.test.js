import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(__dirname, '../../website-v2/docs');
const page = readFileSync(resolve(docsDir, 'case-study-self-build.mdx'), 'utf8');
const sidebars = readFileSync(resolve(__dirname, '../../website-v2/sidebars.ts'), 'utf8');
const llms = readFileSync(resolve(__dirname, '../../website-v2/static/llms.txt'), 'utf8');
const homepage = readFileSync(resolve(__dirname, '../../website-v2/src/pages/index.tsx'), 'utf8');
const readme = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const config = readFileSync(resolve(__dirname, '../../website-v2/docusaurus.config.ts'), 'utf8');
const spec = readFileSync(resolve(__dirname, '../../.planning/CASE_STUDY_DISCOVERABILITY_SPEC.md'), 'utf8');

describe('Case Study: Self-Build docs content', () => {
  it('AT-CS-001: page names both collaborating agents', () => {
    assert.ok(page.includes('Claude Opus 4.6'), 'must name Claude Opus 4.6');
    assert.ok(page.includes('GPT 5.5'), 'must name GPT 5.5');
  });

  it('AT-CS-002: page includes concrete evidence metrics', () => {
    assert.ok(page.includes('1,140+'), 'must state commit count');
    assert.ok(page.includes('4,350+'), 'must state test count');
    assert.ok(page.includes('130+'), 'must state decision count');
    assert.ok(page.includes('190+'), 'must state turn count');
  });

  it('AT-CS-003: page describes challenge culture with real examples', () => {
    assert.ok(page.includes('Challenge Culture'), 'must have challenge culture section');
    assert.ok(page.includes('broke 7 tests'), 'must reference the 7 broken tests incident');
  });

  it('AT-CS-004: page describes decision discipline with DEC-* examples', () => {
    assert.ok(page.includes('DEC-GENERIC-TEMPLATE-001'), 'must reference a real DEC entry');
    assert.ok(page.includes('DEC-COST-STRATEGY-001'), 'must reference cost strategy decision');
  });

  it('AT-CS-005: page describes human sovereignty mechanisms', () => {
    assert.ok(page.includes('VISION.md'), 'must reference VISION.md');
    assert.ok(page.includes('HUMAN-ROADMAP.md'), 'must reference HUMAN-ROADMAP.md');
    assert.ok(page.includes('immutable by agents'), 'must state VISION.md is immutable');
  });

  it('AT-CS-006: page includes actionable try-it-yourself section', () => {
    assert.ok(page.includes('npm install -g agentxchain'), 'must include install command');
    assert.ok(page.includes('agentxchain init --governed --yes'), 'must include init command');
    assert.ok(page.includes('five-minute-tutorial'), 'must link to tutorial');
  });

  it('AT-CS-007: page is in sidebar', () => {
    assert.ok(sidebars.includes('case-study-self-build'), 'must be in sidebars.ts');
  });

  it('AT-CS-008: page is in llms.txt', () => {
    assert.ok(llms.includes('case-study-self-build'), 'must be in llms.txt');
  });

  it('AT-CS-009: case study is linked from homepage proof surface', () => {
    assert.ok(homepage.includes('/docs/case-study-self-build'), 'homepage must link to case study');
    assert.ok(homepage.includes('How AgentXchain built itself'), 'homepage must use self-build framing');
  });

  it('AT-CS-010: case study is linked from README and footer', () => {
    assert.ok(readme.includes('https://agentxchain.dev/docs/case-study-self-build'), 'README must link to case study');
    assert.ok(config.includes("'/docs/case-study-self-build'"), 'footer must link to case study');
    assert.ok(config.includes('Self-Build Case Study'), 'footer label must name the case study');
  });
});

describe('case-study discoverability spec', () => {
  it('AT-CS-011: records the discoverability contract and acceptance tests', () => {
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests', '## Open Questions']) {
      assert.ok(spec.includes(heading), `spec must include ${heading}`);
    }
    assert.ok(spec.includes('/docs/case-study-self-build'), 'spec must freeze the canonical path');
    assert.ok(spec.includes('README.md'), 'spec must require README discoverability');
    assert.ok(spec.includes('website-v2/docusaurus.config.ts'), 'spec must require footer discoverability');
  });
});
