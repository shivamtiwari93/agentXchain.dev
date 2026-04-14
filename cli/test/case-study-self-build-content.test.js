import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(__dirname, '../../website-v2/docs');
const page = readFileSync(resolve(docsDir, 'case-study-self-build.mdx'), 'utf8');
const sidebars = readFileSync(resolve(__dirname, '../../website-v2/sidebars.ts'), 'utf8');
const llms = readFileSync(resolve(__dirname, '../../website-v2/static/llms.txt'), 'utf8');

describe('Case Study: Self-Build docs content', () => {
  it('AT-CS-001: page names both collaborating agents', () => {
    assert.ok(page.includes('Claude Opus 4.6'), 'must name Claude Opus 4.6');
    assert.ok(page.includes('GPT 5.4'), 'must name GPT 5.4');
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
});
