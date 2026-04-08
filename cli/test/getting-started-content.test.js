import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'website-v2', 'docs');
const pagePath = join(DOCS, 'getting-started.mdx');
const content = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';
const sidebar = readFileSync(join(ROOT, 'website-v2', 'sidebars.ts'), 'utf8');
const quickstart = readFileSync(join(DOCS, 'quickstart.mdx'), 'utf8');
const launchPage = readFileSync(join(ROOT, 'website-v2', 'src', 'pages', 'launch.mdx'), 'utf8');
const spec = readFileSync(join(ROOT, '.planning', 'GETTING_STARTED_TUTORIAL_SPEC.md'), 'utf8');

describe('getting-started tutorial docs', () => {
  it('exists and is wired into the sidebar between quickstart and first-turn', () => {
    assert.ok(existsSync(pagePath), 'getting-started.mdx must exist');
    const qsIdx = sidebar.indexOf("'quickstart'");
    const gsIdx = sidebar.indexOf("'getting-started'");
    const ftIdx = sidebar.indexOf("'first-turn'");
    assert.ok(qsIdx >= 0, 'sidebar must contain quickstart');
    assert.ok(gsIdx >= 0, 'sidebar must contain getting-started');
    assert.ok(ftIdx >= 0, 'sidebar must contain first-turn');
    assert.ok(gsIdx > qsIdx, 'getting-started must come after quickstart');
    assert.ok(gsIdx < ftIdx, 'getting-started must come before first-turn');
  });

  it('documents the real command chain from demo through completion', () => {
    for (const token of [
      'npx agentxchain demo',
      'npx agentxchain init --governed --template cli-tool -y',
      'agentxchain step',
      'agentxchain approve-transition',
      'agentxchain step --role dev --verbose',
      'agentxchain step --role qa',
      'agentxchain approve-completion',
    ]) {
      assert.ok(content.includes(token), `getting-started must include: ${token}`);
    }
  });

  it('states the mixed-mode truth boundary honestly', () => {
    assert.ok(content.includes('manual-pm'), 'must mention manual-pm');
    assert.ok(content.includes('local-dev'), 'must mention local-dev');
    assert.ok(content.includes('api-qa'), 'must mention api-qa');
    assert.ok(content.includes('ANTHROPIC_API_KEY'), 'must mention default QA auth requirement');
    assert.ok(content.includes('Do not pretend the default scaffold is fully no-key end to end'),
      'must explicitly reject the dishonest no-key claim');
  });

  it('links back to first-turn for artifact detail and is surfaced from front-door pages', () => {
    assert.ok(content.includes('/docs/first-turn'), 'getting-started must link to first-turn');
    assert.ok(quickstart.includes('/docs/getting-started'), 'quickstart must link to getting-started');
    assert.ok(launchPage.includes('/docs/getting-started'), 'launch page must link to getting-started');
  });
});

describe('getting-started tutorial spec', () => {
  it('records the behavior and acceptance tests', () => {
    assert.ok(spec.includes('## Purpose'));
    assert.ok(spec.includes('## Interface'));
    assert.ok(spec.includes('## Behavior'));
    assert.ok(spec.includes('## Acceptance Tests'));
    assert.ok(spec.includes('ANTHROPIC_API_KEY'));
  });
});
