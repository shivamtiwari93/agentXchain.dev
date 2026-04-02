import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const WHY_PAGE = readFileSync(join(REPO_ROOT, 'website', 'why.html'), 'utf8');
const HOME_PAGE = readFileSync(join(REPO_ROOT, 'website', 'index.html'), 'utf8');
const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const LAUNCH_BRIEF = readFileSync(join(REPO_ROOT, '.planning', 'LAUNCH_BRIEF.md'), 'utf8');

describe('Why page public surface', () => {
  it('exists as a public linkable page with core metadata', () => {
    assert.ok(WHY_PAGE.includes('<title>Why Governed Multi-Agent Delivery Matters | AgentXchain</title>'));
    assert.ok(WHY_PAGE.includes('https://agentxchain.dev/why.html'));
    assert.ok(WHY_PAGE.includes('/docs/quickstart.html'));
    assert.ok(WHY_PAGE.includes('/docs/protocol.html'));
  });

  it('states the mechanism-first thesis', () => {
    assert.ok(WHY_PAGE.includes('coordination long before it breaks on intelligence'));
    assert.ok(WHY_PAGE.includes('manager-worker pattern'));
    assert.ok(WHY_PAGE.includes('mandatory challenge'));
    assert.ok(WHY_PAGE.includes('phase transitions') || WHY_PAGE.includes('phase transition'));
    assert.ok(WHY_PAGE.includes('run completion') || WHY_PAGE.includes('ship readiness'));
  });

  it('documents model-agnostic runtime modes', () => {
    assert.ok(WHY_PAGE.includes('<code>manual</code>'));
    assert.ok(WHY_PAGE.includes('<code>local_cli</code>'));
    assert.ok(WHY_PAGE.includes('<code>api_proxy</code>'));
  });
});

describe('Why page discoverability', () => {
  it('is linked from the homepage', () => {
    assert.ok(HOME_PAGE.includes('/why.html'));
  });

  it('is linked from both READMEs', () => {
    assert.ok(ROOT_README.includes('https://agentxchain.dev/why.html'));
    assert.ok(CLI_README.includes('https://agentxchain.dev/why.html'));
  });

  it('is reflected in the launch brief as a ready surface', () => {
    assert.ok(LAUNCH_BRIEF.includes('| Blog / Long-form Post | Ready |'));
    assert.ok(LAUNCH_BRIEF.includes('website/why.html'));
  });
});
