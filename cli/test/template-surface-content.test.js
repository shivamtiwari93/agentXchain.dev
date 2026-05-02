import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const GETTING_STARTED_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'getting-started.mdx'), 'utf8');
const QUICKSTART_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'quickstart.mdx'), 'utf8');
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const TEMPLATES_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'templates.mdx'), 'utf8');

describe('Template public surface', () => {
  it('documents the governed template flag in both READMEs', () => {
    assert.ok(ROOT_README.includes('--template'), 'root README must mention --template');
    assert.ok(CLI_README.includes('--template'), 'cli README must mention --template');
  });

  it('lists all built-in template ids in both READMEs', () => {
    for (const templateId of ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'full-local-cli', 'enterprise-app']) {
      assert.ok(ROOT_README.includes(templateId), `root README must mention ${templateId}`);
      assert.ok(CLI_README.includes(templateId), `cli README must mention ${templateId}`);
    }
  });

  it('keeps template discovery visible in both READMEs', () => {
    for (const docSource of [ROOT_README, CLI_README]) {
      assert.ok(docSource.includes('https://agentxchain.dev/docs/templates/'), 'README surface must link to templates docs');
      assert.ok(docSource.includes('agentxchain template list'), 'README surface must mention template list');
      assert.ok(docSource.includes('agentxchain template list --phase-templates'), 'README surface must mention phase-template discovery');
    }
  });

  it('quickstart explains template-aware scaffold creation', () => {
    assert.ok(QUICKSTART_DOCS.includes('--template'), 'quickstart docs must mention --template');
    assert.ok(QUICKSTART_DOCS.includes('api-service'), 'quickstart docs must mention api-service');
    assert.ok(QUICKSTART_DOCS.includes('cli-tool'), 'quickstart docs must mention cli-tool');
    assert.ok(QUICKSTART_DOCS.includes('library'), 'quickstart docs must mention library');
    assert.ok(QUICKSTART_DOCS.includes('web-app'), 'quickstart docs must mention web-app');
    assert.ok(QUICKSTART_DOCS.includes('full-local-cli'), 'quickstart docs must mention full-local-cli');
    assert.ok(QUICKSTART_DOCS.includes('enterprise-app'), 'quickstart docs must mention enterprise-app');
  });

  it('cli docs document template-aware init and template set', () => {
    assert.ok(CLI_DOCS.includes('--template <id>') || CLI_DOCS.includes('--template'), 'cli docs must show template-aware init');
    assert.ok(CLI_DOCS.includes('template set'), 'cli docs must mention template set');
    assert.ok(CLI_DOCS.includes('template list'), 'cli docs must mention template list');
    assert.ok(CLI_DOCS.includes('template validate'), 'cli docs must mention template validate');
  });

  it('cli docs document --phase-templates flag for template list', () => {
    assert.ok(CLI_DOCS.includes('--phase-templates'), 'cli docs must mention --phase-templates flag');
    assert.ok(CLI_DOCS.includes('workflow-kit phase templates'), 'cli docs must explain what --phase-templates lists');
  });

  it('templates docs document the phase-templates CLI discovery surface', () => {
    assert.ok(TEMPLATES_DOCS.includes('template list --phase-templates'), 'templates docs must show the CLI command for listing phase templates');
    assert.ok(TEMPLATES_DOCS.includes('--json'), 'templates docs must mention JSON output for phase templates');
  });

  it('getting started docs keep phase-template discovery visible for custom phases', () => {
    assert.ok(GETTING_STARTED_DOCS.includes('template list --phase-templates'), 'getting started docs must show phase-template discovery');
    assert.ok(GETTING_STARTED_DOCS.includes('template list --phase-templates --json'), 'getting started docs must mention JSON phase-template discovery');
    assert.ok(GETTING_STARTED_DOCS.includes('/docs/templates'), 'getting started docs must link to templates docs');
  });
});
