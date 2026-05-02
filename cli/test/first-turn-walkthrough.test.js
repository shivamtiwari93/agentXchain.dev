import { describe, it } from 'vitest';
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

  it('documents the real step-based happy path', () => {
    assert.ok(content.includes('agentxchain step'), 'must show the default step command');
    assert.ok(content.includes('Initialized governed run'), 'must show run initialization output');
    assert.ok(content.includes('Staged result detected.'), 'must explain that step waits for the result');
    assert.ok(content.includes('Turn Accepted'), 'must show that step auto-accepts a valid staged result');
  });

  it('documents the real dispatch bundle files', () => {
    assert.ok(content.includes('ASSIGNMENT.json'), 'must mention ASSIGNMENT.json');
    assert.ok(content.includes('MANIFEST.json'), 'must mention MANIFEST.json');
    assert.ok(content.includes('PROMPT.md'), 'must mention PROMPT.md');
    assert.ok(content.includes('CONTEXT.md'), 'must mention CONTEXT.md');
    assert.ok(!content.includes('DISPATCH.json'), 'must not mention stale DISPATCH.json');
  });

  it('shows a decision ledger example', () => {
    assert.ok(content.includes('decision-ledger'), 'must reference decision ledger');
    assert.ok(content.includes('DEC-001'), 'must show at least one decision ID example');
  });

  it('teaches the evidence boundary instead of flattening everything into the ledger', () => {
    assert.ok(content.includes('agentxchain audit --format markdown'), 'must show audit command');
    assert.ok(content.includes('agentxchain export --format json > governance-export.json'), 'must show export command');
    assert.ok(content.includes('agentxchain report --input governance-export.json --format markdown'), 'must show report --input command');
    assert.ok(content.includes('live current repo or workspace'), 'must describe audit as live-state inspection');
    assert.ok(content.includes('existing export artifact'), 'must describe report as artifact-backed');
    assert.ok(content.includes('repo_ok_count'), 'must preserve partial coordinator export-health visibility');
    assert.ok(content.includes('repo_error_count'), 'must preserve partial coordinator export-health visibility');
    assert.ok(content.includes('failed repo row plus error'), 'must preserve failed repo row visibility');
  });

  it('shows an objection example', () => {
    assert.ok(content.includes('OBJ-001'), 'must show at least one objection ID example');
    assert.ok(content.includes('objections'), 'must explain objections');
  });

  it('links to quickstart and cli reference', () => {
    assert.ok(content.includes('/docs/quickstart'), 'must link to quickstart');
    assert.ok(content.includes('/docs/cli'), 'must link to CLI reference');
  });

  it('names the full shipped adapter surface in next steps', () => {
    assert.ok(
      content.includes('[Adapters](/docs/adapters) — configure all five shipped adapter paths (`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`)'),
      'must name all five shipped adapters in the next-steps adapters link',
    );
    assert.ok(
      !content.includes('[Adapters](/docs/adapters) — configure automated agents (local CLI, API proxy, MCP)'),
      'must not regress to the stale three-adapter onboarding wording',
    );
  });

  it('includes gate failure troubleshooting', () => {
    assert.ok(content.includes('planning_signoff'), 'must mention planning_signoff gate');
    assert.ok(content.includes('implementation_complete'), 'must mention implementation_complete gate');
    assert.ok(content.includes('qa_ship_verdict'), 'must mention qa_ship_verdict gate');
    assert.ok(content.includes('ROADMAP.md'), 'must mention ROADMAP.md as part of the planning gate');
    assert.ok(content.includes('SYSTEM_SPEC.md'), 'must mention SYSTEM_SPEC.md as part of the planning gate');
    assert.ok(content.includes('RELEASE_NOTES.md'), 'must mention RELEASE_NOTES.md as part of the QA gate');
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
