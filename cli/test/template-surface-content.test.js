import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const QUICKSTART_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'quickstart.mdx'), 'utf8');
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');

describe('Template public surface', () => {
  it('documents the governed template flag in both READMEs', () => {
    assert.ok(ROOT_README.includes('--template'), 'root README must mention --template');
    assert.ok(CLI_README.includes('--template'), 'cli README must mention --template');
  });

  it('lists all built-in template ids in both READMEs', () => {
    for (const templateId of ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'enterprise-app']) {
      assert.ok(ROOT_README.includes(templateId), `root README must mention ${templateId}`);
      assert.ok(CLI_README.includes(templateId), `cli README must mention ${templateId}`);
    }
  });

  it('quickstart explains template-aware scaffold creation', () => {
    assert.ok(QUICKSTART_DOCS.includes('--template'), 'quickstart docs must mention --template');
    assert.ok(QUICKSTART_DOCS.includes('api-service'), 'quickstart docs must mention api-service');
    assert.ok(QUICKSTART_DOCS.includes('cli-tool'), 'quickstart docs must mention cli-tool');
    assert.ok(QUICKSTART_DOCS.includes('library'), 'quickstart docs must mention library');
    assert.ok(QUICKSTART_DOCS.includes('web-app'), 'quickstart docs must mention web-app');
    assert.ok(QUICKSTART_DOCS.includes('enterprise-app'), 'quickstart docs must mention enterprise-app');
  });

  it('cli docs document template-aware init and template set', () => {
    assert.ok(CLI_DOCS.includes('--template <id>') || CLI_DOCS.includes('--template'), 'cli docs must show template-aware init');
    assert.ok(CLI_DOCS.includes('template set'), 'cli docs must mention template set');
    assert.ok(CLI_DOCS.includes('template list'), 'cli docs must mention template list');
    assert.ok(CLI_DOCS.includes('template validate'), 'cli docs must mention template validate');
  });
});
