import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/tutorial.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const SITEMAP = read('website-v2/static/sitemap.xml');
const LLMS = read('website-v2/static/llms.txt');

describe('Tutorial walkthrough docs surface', () => {
  // AT-TUTORIAL-001
  it('ships the Docusaurus page with correct frontmatter', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'tutorial page must exist');
    assert.match(DOC, /title:.*Tutorial/i, 'frontmatter must include Tutorial in title');
  });

  // AT-TUTORIAL-002
  it('is wired into the sidebar', () => {
    assert.match(SIDEBARS, /'tutorial'/, 'sidebars.ts must include tutorial page');
  });

  // AT-TUTORIAL-003 — all lifecycle commands present
  it('contains all governed lifecycle commands', () => {
    assert.match(DOC, /init --governed/, 'must show init --governed');
    assert.match(DOC, /agentxchain step/, 'must show agentxchain step');
    assert.match(DOC, /approve-transition/, 'must show approve-transition');
    assert.match(DOC, /approve-completion/, 'must show approve-completion');
    assert.match(DOC, /agentxchain status/, 'must show agentxchain status');
    assert.match(DOC, /agentxchain report/, 'must show agentxchain report');
  });

  // AT-TUTORIAL-004
  it('shows manual-qa runtime config for zero API keys', () => {
    assert.match(DOC, /manual-qa/, 'must mention manual-qa runtime');
    assert.match(DOC, /zero API key/i, 'must explain zero API key requirement');
  });

  // AT-TUTORIAL-005 — exact gate file content
  it('shows exact gate file content', () => {
    assert.match(DOC, /Approved: YES/, 'must show PM_SIGNOFF with Approved: YES');
    assert.match(DOC, /PM_SIGNOFF\.md/, 'must reference PM_SIGNOFF.md');
    assert.match(DOC, /ROADMAP\.md/, 'must reference ROADMAP.md');
    assert.match(DOC, /SYSTEM_SPEC\.md/, 'must reference SYSTEM_SPEC.md');
    assert.match(DOC, /IMPLEMENTATION_NOTES\.md/, 'must reference IMPLEMENTATION_NOTES.md');
    assert.match(DOC, /acceptance-matrix\.md/, 'must reference acceptance-matrix.md');
    assert.match(DOC, /ship-verdict\.md/, 'must reference ship-verdict.md');
    assert.match(DOC, /RELEASE_NOTES\.md/, 'must reference RELEASE_NOTES.md');
  });

  // AT-TUTORIAL-006 — turn-result.json examples
  it('shows turn-result.json examples for all three roles', () => {
    assert.match(DOC, /"role":\s*"pm"/, 'must show PM turn result');
    assert.match(DOC, /"role":\s*"dev"/, 'must show dev turn result');
    assert.match(DOC, /"role":\s*"qa"/, 'must show QA turn result');
    assert.match(DOC, /run_completion_request/, 'must show run_completion_request in QA result');
    assert.match(DOC, /phase_transition_request/, 'must show phase_transition_request');
  });

  // AT-TUTORIAL-007 — links to reference pages
  it('links to getting-started and first-turn for reference', () => {
    assert.match(DOC, /\/docs\/getting-started/, 'must link to getting-started');
    assert.match(DOC, /\/docs\/first-turn/, 'must link to first-turn');
  });

  // AT-TUTORIAL-008 — discovery surfaces
  it('is listed in sitemap.xml', () => {
    assert.match(SITEMAP, /docs\/tutorial/, 'sitemap must include /docs/tutorial');
  });

  it('is listed in llms.txt', () => {
    assert.match(LLMS, /docs\/tutorial/, 'llms.txt must include /docs/tutorial');
  });

  // Narrative structure — not just a command list
  it('walks through all three phases explicitly', () => {
    assert.match(DOC, /planning/i, 'must cover planning phase');
    assert.match(DOC, /implementation/i, 'must cover implementation phase');
    assert.match(DOC, /QA/i, 'must cover QA phase');
  });

  it('explains what the operator just accomplished', () => {
    assert.match(DOC, /What you just did/i, 'must have a summary section');
  });
});
