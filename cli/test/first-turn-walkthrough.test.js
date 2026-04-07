import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'website-v2', 'docs');

describe('first-turn walkthrough docs', () => {
  const pagePath = join(DOCS, 'first-turn.mdx');

  it('first-turn.mdx exists', () => {
    assert.ok(existsSync(pagePath), 'first-turn.mdx must exist in website-v2/docs/');
  });

  const content = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';

  it('mentions PM_SIGNOFF.md gate semantics', () => {
    assert.ok(content.includes('PM_SIGNOFF.md'), 'must reference PM_SIGNOFF.md');
    assert.ok(content.includes('Approved: NO'), 'must show the blocked default');
    assert.ok(content.includes('Approved: YES'), 'must show the approved state');
  });

  it('mentions approve-transition and approve-completion', () => {
    assert.ok(content.includes('approve-transition'), 'must reference approve-transition');
    assert.ok(content.includes('approve-completion'), 'must reference approve-completion');
  });

  it('shows a decision ledger example', () => {
    assert.ok(content.includes('decision-ledger'), 'must reference decision ledger');
    assert.ok(content.includes('DEC-001'), 'must show at least one decision ID example');
  });

  it('shows an objection example', () => {
    assert.ok(content.includes('OBJ-001'), 'must show at least one objection ID example');
    assert.ok(content.includes('objections'), 'must explain objections');
  });

  it('links to quickstart and cli reference', () => {
    assert.ok(content.includes('/docs/quickstart'), 'must link to quickstart');
    assert.ok(content.includes('/docs/cli'), 'must link to CLI reference');
  });

  it('includes gate failure troubleshooting', () => {
    assert.ok(content.includes('planning_signoff'), 'must mention planning_signoff gate');
    assert.ok(content.includes('implementation_complete'), 'must mention implementation_complete gate');
    assert.ok(content.includes('qa_ship_verdict'), 'must mention qa_ship_verdict gate');
  });

  it('sidebar includes first-turn between quickstart and cli', () => {
    const sidebarPath = join(ROOT, 'website-v2', 'sidebars.ts');
    const sidebar = readFileSync(sidebarPath, 'utf8');
    const qsIdx = sidebar.indexOf("'quickstart'");
    const ftIdx = sidebar.indexOf("'first-turn'");
    const cliIdx = sidebar.indexOf("'cli'");
    assert.ok(qsIdx >= 0, 'sidebar must contain quickstart');
    assert.ok(ftIdx >= 0, 'sidebar must contain first-turn');
    assert.ok(cliIdx >= 0, 'sidebar must contain cli');
    assert.ok(ftIdx > qsIdx, 'first-turn must come after quickstart');
    assert.ok(ftIdx < cliIdx, 'first-turn must come before cli');
  });
});
