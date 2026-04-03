import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const TEMPLATES_SPEC = read('.planning/TEMPLATES_DOC_PAGE_SPEC.md');
const TEMPLATES_DOC_SOURCE = read('website-v2/docs/templates.mdx');
const QUICKSTART_DOC_SOURCE = read('website-v2/docs/quickstart.mdx');
const CLI_DOC_SOURCE = read('website-v2/docs/cli.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');

describe('Templates docs surface', () => {
  it('ships the templates doc source', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2', 'docs', 'templates.mdx')));
  });

  it('documents the shipped template commands and built-in ids', () => {
    for (const term of [
      'agentxchain init --governed --template <id>',
      'agentxchain template list',
      'agentxchain template set <id>',
      'generic',
      'api-service',
      'cli-tool',
      'web-app',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
    }
  });

  it('explains that template choice is scaffold intent and template set is additive', () => {
    assert.ok(TEMPLATES_DOC_SOURCE.includes('scaffold intent'), 'templates docs must explain scaffold intent');
    assert.ok(TEMPLATES_DOC_SOURCE.includes('additive, not destructive'), 'templates docs must explain additive mutation semantics');
    assert.ok(TEMPLATES_DOC_SOURCE.includes('agentxchain.json'), 'templates docs must mention config storage');
    assert.ok(TEMPLATES_DOC_SOURCE.includes('decision-ledger.jsonl'), 'templates docs must mention decision ledger recording');
  });

  it('is wired into the docs sidebar and linked from quickstart and CLI docs', () => {
    assert.ok(SIDEBARS.includes("'templates'"), 'sidebars.ts must include the templates docs page');
    assert.ok(QUICKSTART_DOC_SOURCE.includes('/docs/templates'), 'quickstart docs must link to /docs/templates');
    assert.ok(CLI_DOC_SOURCE.includes('/docs/templates'), 'cli docs must link to /docs/templates');
  });

  it('keeps the spec aligned with the shipped docs route and commands', () => {
    assert.ok(TEMPLATES_SPEC.includes('/docs/templates'));
    assert.ok(TEMPLATES_SPEC.includes('template list'));
    assert.ok(TEMPLATES_SPEC.includes('template set <id>'));
    assert.ok(TEMPLATES_SPEC.includes('status --json'));
  });
});
