import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/multi-session.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const SITEMAP = read('website-v2/static/sitemap.xml');
const LLMS = read('website-v2/static/llms.txt');

describe('Multi-session continuity docs surface', () => {
  it('ships the Docusaurus page', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'multi-session docs page must exist');
  });

  it('is wired into the sidebar', () => {
    assert.match(SIDEBARS, /'multi-session'/, 'sidebars.ts must include multi-session page');
  });

  it('has correct frontmatter', () => {
    assert.match(DOC, /title:\s*Multi-Session Continuity/);
  });

  it('documents the resume workflow', () => {
    assert.match(DOC, /agentxchain resume/);
  });

  it('documents blocked recovery across sessions', () => {
    assert.match(DOC, /agentxchain escalate/);
    assert.match(DOC, /blocked/i);
  });

  it('documents cross-session phase-transition approval', () => {
    assert.match(DOC, /phase_transition_request/);
    assert.match(DOC, /approve-transition/);
    assert.match(DOC, /planning to implementation/i);
  });

  it('documents cross-session completion', () => {
    assert.match(DOC, /approve-completion/);
    assert.match(DOC, /pending_run_completion/);
  });

  it('documents state persistence files', () => {
    assert.match(DOC, /state\.json/);
    assert.match(DOC, /history\.jsonl/);
    assert.match(DOC, /decision-ledger\.jsonl/);
  });

  it('documents the invariants', () => {
    assert.match(DOC, /run_id/);
    assert.match(DOC, /append-only/i);
    assert.match(DOC, /monotonic/i);
  });

  it('is included in sitemap.xml', () => {
    assert.match(SITEMAP, /multi-session/, 'sitemap must include multi-session page');
  });

  it('is included in llms.txt', () => {
    assert.match(LLMS, /multi-session/, 'llms.txt must include multi-session page');
  });
});
