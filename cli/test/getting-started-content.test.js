import { describe, it } from 'vitest';
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
      'npx --yes -p agentxchain@latest -c "agentxchain demo"',
      'npm install -g agentxchain',
      'agentxchain init --governed --template cli-tool --goal "Build a CLI that lints decision logs" --dir . -y',
      'agentxchain step',
      'agentxchain approve-transition',
      'agentxchain step --role dev --verbose',
      'agentxchain step --role qa',
      'agentxchain approve-completion',
    ]) {
      assert.ok(content.includes(token), `getting-started must include: ${token}`);
    }
  });

  it('states the generic-vs-project-template truth boundary honestly', () => {
    assert.ok(content.includes('manual-pm'), 'must mention manual-pm');
    assert.ok(content.includes('manual-dev'), 'must mention manual-dev');
    assert.ok(content.includes('manual-qa'), 'must mention manual-qa');
    assert.ok(content.includes('local-dev'), 'must mention local-dev');
    assert.ok(content.includes('api-qa'), 'must mention api-qa');
    assert.ok(content.includes('ANTHROPIC_API_KEY'), 'must mention cli-tool QA auth requirement');
    assert.ok(content.includes('Do not pretend the `cli-tool` walkthrough is fully no-key end to end.'),
      'must explicitly reject the dishonest no-key claim for the mixed-mode walkthrough');
  });

  it('documents the custom phase extension boundary', () => {
    assert.ok(content.includes('Custom phases'), 'getting-started must mention custom phases');
    assert.ok(content.includes('planning → implementation → qa') || content.includes('planning, implementation, qa'),
      'getting-started must name the default phase order');
    assert.ok(content.includes('routing'), 'getting-started must reference routing config for custom phases');
    assert.ok(content.includes('/docs/adapters'), 'getting-started must link to adapters for full custom-phase contract');
  });

  it('documents explicit workflow_kit for custom-phase artifacts', () => {
    assert.ok(content.includes('workflow_kit'), 'getting-started must mention workflow_kit');
    assert.ok(content.includes('section_check'), 'getting-started must show a real workflow_kit semantics example');
    assert.ok(content.includes('agentxchain init --governed --dir . -y'),
      'getting-started must document the in-place re-init path for explicit workflow_kit');
    assert.ok(content.includes('agentxchain template validate'),
      'getting-started must document template validate after adding workflow_kit');
    assert.ok(content.includes('workflow_kit: {}'),
      'getting-started must document the explicit empty opt-out boundary');
  });

  it('documents doctor as a readiness check in the scaffold flow', () => {
    assert.ok(content.includes('agentxchain doctor'),
      'getting-started must introduce doctor between scaffold validation and first turn');
  });

  it('does not teach a second in-place init just to add project goal', () => {
    assert.ok(content.includes('Do not re-run `init --governed` in place just to add the goal.'),
      'getting-started must reject the misleading in-place init-for-goal flow');
    assert.ok(content.includes('agentxchain config --set project.goal'),
      'getting-started must route omitted-goal recovery through config --set instead of manual JSON edits');
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
    assert.ok(spec.includes('manual-dev'));
    assert.ok(spec.includes('manual-qa'));
    assert.ok(spec.includes('workflow_kit'));
    assert.ok(spec.includes('template validate'));
  });
});
