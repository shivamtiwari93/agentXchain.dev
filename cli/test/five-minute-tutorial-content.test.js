import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'website-v2', 'docs');
const pagePath = join(DOCS, 'five-minute-tutorial.mdx');
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';
const sidebar = readFileSync(join(ROOT, 'website-v2', 'sidebars.ts'), 'utf8');
const quickstart = readFileSync(join(DOCS, 'quickstart.mdx'), 'utf8');
const gettingStarted = readFileSync(join(DOCS, 'getting-started.mdx'), 'utf8');
const llms = readFileSync(join(ROOT, 'website-v2', 'static', 'llms.txt'), 'utf8');
const spec = readFileSync(join(ROOT, '.planning', 'FIVE_MINUTE_TUTORIAL_SPEC.md'), 'utf8');

describe('five-minute tutorial docs page', () => {
  it('AT-5MIN-001: exists and is wired between getting-started and first-turn', () => {
    assert.ok(existsSync(pagePath), 'five-minute-tutorial.mdx must exist');
    const gsIdx = sidebar.indexOf("'getting-started'");
    const fiveIdx = sidebar.indexOf("'five-minute-tutorial'");
    const ftIdx = sidebar.indexOf("'first-turn'");
    assert.ok(gsIdx >= 0, 'sidebar must contain getting-started');
    assert.ok(fiveIdx >= 0, 'sidebar must contain five-minute-tutorial');
    assert.ok(ftIdx >= 0, 'sidebar must contain first-turn');
    assert.ok(fiveIdx > gsIdx, 'five-minute tutorial must come after getting-started');
    assert.ok(fiveIdx < ftIdx, 'five-minute tutorial must come before first-turn');
  });

  it('AT-5MIN-002: states the manual-first generic truth boundary', () => {
    assert.ok(page.includes('generic'), 'must name the generic scaffold');
    assert.ok(page.includes('manual-pm'), 'must mention manual-pm');
    assert.ok(page.includes('manual-dev'), 'must mention manual-dev');
    assert.ok(page.includes('manual-qa'), 'must mention manual-qa');
    assert.ok(page.includes('no API keys'), 'must explicitly reject API-key requirement');
    assert.ok(page.includes('no local coding CLI'), 'must explicitly reject local coding CLI requirement');
    assert.ok(page.includes('first accepted governed turn'), 'must scope the page to the first accepted turn');
  });

  it('AT-5MIN-003: documents the real command chain', () => {
    for (const token of [
      'npm install -g agentxchain',
      'agentxchain init --governed --goal "Ship a governed CLI that summarizes decision logs" --dir . -y',
      'agentxchain template validate',
      'agentxchain doctor',
      'agentxchain step',
      'Ctrl+C',
      'agentxchain turn show --artifact assignment --json',
      'agentxchain accept-turn',
      'agentxchain status',
    ]) {
      assert.ok(page.includes(token), `five-minute tutorial must include: ${token}`);
    }
  });

  it('AT-5MIN-004: uses CLI inspection instead of manual ID copy-paste', () => {
    assert.ok(page.includes('AGENTXCHAIN_ACTIVE_TURN_JSON'), 'must use an external scratch path for assignment JSON');
    assert.ok(page.includes('mktemp'), 'must create the assignment scratch file with mktemp');
    assert.ok(page.includes('assignmentEnvelope.artifact.content'), 'must parse turn metadata from turn show output');
    assert.ok(page.includes('run_id: assignment.run_id'), 'must stage the real run_id from CLI inspection');
    assert.ok(page.includes('turn_id: assignment.turn_id'), 'must stage the real turn_id from CLI inspection');
  });

  it('AT-5MIN-005: is linked from quickstart and getting-started and included in llms', () => {
    assert.ok(quickstart.includes('/docs/five-minute-tutorial'), 'quickstart must link to five-minute tutorial');
    assert.ok(gettingStarted.includes('/docs/five-minute-tutorial'), 'getting-started must link to five-minute tutorial');
    assert.ok(llms.includes('/docs/five-minute-tutorial'), 'llms.txt must include the new page');
  });
});

describe('five-minute tutorial spec', () => {
  it('AT-5MIN-006: records the behavior and acceptance tests', () => {
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests', '## Open Questions']) {
      assert.ok(spec.includes(heading), `spec must include ${heading}`);
    }
    assert.ok(spec.includes('turn show --artifact assignment --json'), 'spec must freeze the inspection path');
    assert.ok(spec.includes('generic'), 'spec must name the generic template');
    assert.ok(spec.includes('no API keys'), 'spec must record the no-key boundary');
    assert.ok(spec.includes('accept-turn'), 'spec must record accept-turn as the commit step');
  });
});
