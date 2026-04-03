import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const WHY_PAGE = readFileSync(join(REPO_ROOT, 'website-v2', 'src', 'pages', 'why.mdx'), 'utf8');
const DOCUSAURUS_CONFIG = readFileSync(join(REPO_ROOT, 'website-v2', 'docusaurus.config.ts'), 'utf8');
const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const LAUNCH_BRIEF = readFileSync(join(REPO_ROOT, '.planning', 'LAUNCH_BRIEF.md'), 'utf8');

describe('Why page public surface', () => {
  it('exists as a Docusaurus source page', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2', 'src', 'pages', 'why.mdx')));
  });

  it('states the mechanism-first thesis', () => {
    assert.ok(WHY_PAGE.includes('coordination'));
    assert.ok(WHY_PAGE.includes('manager-worker pattern'));
    assert.ok(WHY_PAGE.includes('mandatory challenge'));
    assert.ok(WHY_PAGE.includes('phase transition') || WHY_PAGE.includes('Phase transition'));
  });

  it('documents model-agnostic runtime modes', () => {
    assert.ok(WHY_PAGE.includes('`manual`'));
    assert.ok(WHY_PAGE.includes('`local_cli`'));
    assert.ok(WHY_PAGE.includes('`api_proxy`'));
  });
});

describe('Why page discoverability', () => {
  it('is linked from the site navbar', () => {
    assert.ok(DOCUSAURUS_CONFIG.includes("to: '/why'"), 'Docusaurus config must link to /why in the navbar');
  });

  it('is linked from both READMEs', () => {
    assert.ok(ROOT_README.includes('https://agentxchain.dev/why'));
    assert.ok(CLI_README.includes('https://agentxchain.dev/why'));
  });

  it('is reflected in the launch brief as a ready surface', () => {
    assert.ok(LAUNCH_BRIEF.includes('| Blog / Long-form Post | Ready |'));
  });
});
