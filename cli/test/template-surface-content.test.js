import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const QUICKSTART_DOCS = readFileSync(join(REPO_ROOT, 'website', 'docs', 'quickstart.html'), 'utf8');
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website', 'docs', 'cli.html'), 'utf8');

describe('Template public surface', () => {
  it('documents the governed template flag in both READMEs', () => {
    assert.ok(ROOT_README.includes('--template'), 'root README must mention --template');
    assert.ok(CLI_README.includes('--template'), 'cli README must mention --template');
  });

  it('lists all built-in template ids in both READMEs', () => {
    for (const templateId of ['generic', 'api-service', 'cli-tool', 'web-app']) {
      assert.ok(ROOT_README.includes(templateId), `root README must mention ${templateId}`);
      assert.ok(CLI_README.includes(templateId), `cli README must mention ${templateId}`);
    }
  });

  it('quickstart explains template-aware scaffold creation', () => {
    assert.ok(QUICKSTART_DOCS.includes('--template &lt;id&gt;'), 'quickstart docs must mention --template <id>');
    assert.ok(QUICKSTART_DOCS.includes('api-service'), 'quickstart docs must mention api-service');
    assert.ok(QUICKSTART_DOCS.includes('cli-tool'), 'quickstart docs must mention cli-tool');
    assert.ok(QUICKSTART_DOCS.includes('web-app'), 'quickstart docs must mention web-app');
  });

  it('quickstart explains that status exposes template intent', () => {
    assert.ok(
      QUICKSTART_DOCS.includes('Template: web-app') || QUICKSTART_DOCS.includes('status') && QUICKSTART_DOCS.includes('Template:'),
      'quickstart docs must mention template visibility in status'
    );
  });

  it('cli docs document template-aware init and template-aware status', () => {
    assert.ok(CLI_DOCS.includes('init --governed [--template &lt;id&gt;]'), 'cli docs must show template-aware init');
    assert.ok(CLI_DOCS.includes('top-level <code>template</code> field'), 'cli docs must mention status --json template field');
  });
});
