import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const HOME_PAGE = read('website-v2/src/pages/index.tsx');
const DOCUSAURUS_CONFIG = read('website-v2/docusaurus.config.ts');
const POSITIONING_MATRIX = read('.planning/COMPETITIVE_POSITIONING_MATRIX.md');

const pages = {
  crewai: read('website-v2/src/pages/compare/vs-crewai.mdx'),
  langgraph: read('website-v2/src/pages/compare/vs-langgraph.mdx'),
  openai: read('website-v2/src/pages/compare/vs-openai-agents-sdk.mdx'),
  autogen: read('website-v2/src/pages/compare/vs-autogen.mdx'),
};

const REQUIRED_ROUTES = [
  '/compare/vs-crewai',
  '/compare/vs-langgraph',
  '/compare/vs-openai-agents-sdk',
  '/compare/vs-autogen',
];

function assertCommonPageContract(page, competitorName) {
  assert.match(page, /^---[\s\S]*title:/, `${competitorName} page must include frontmatter`);
  assert.match(page, /^---[\s\S]*description:/, `${competitorName} page must include a description`);
  assert.match(page, /## The short answer/, `${competitorName} page must include the short-answer section`);
  assert.match(page, /## Comparison/, `${competitorName} page must include the comparison section`);
  assert.match(page, /## Choose .* when/, `${competitorName} page must include a choose-when section`);
  assert.match(page, /## A concrete workflow difference/, `${competitorName} page must include the workflow-difference section`);
  assert.match(page, /## Using both together/, `${competitorName} page must include the layering section`);
  assert.match(page, /```[a-z]+/, `${competitorName} page must include at least one fenced code block`);
  assert.match(page, /\[Quickstart\]\(\/docs\/quickstart\)/, `${competitorName} page must link to quickstart`);
  assert.match(page, /\[Protocol\]\(\/docs\/protocol\)/, `${competitorName} page must link to protocol`);
}

describe('comparison pages content', () => {
  it('keeps the homepage comparison surface linked to all shipped routes', () => {
    for (const route of REQUIRED_ROUTES) {
      assert.match(HOME_PAGE, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('keeps navbar and footer links aligned to all shipped routes', () => {
    for (const route of REQUIRED_ROUTES) {
      assert.match(DOCUSAURUS_CONFIG, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('keeps the CrewAI page honest and code-backed', () => {
    assertCommonPageContract(pages.crewai, 'CrewAI');
    assert.match(pages.crewai, /observability|provider support|flows/i);
    assert.match(pages.crewai, /governed software delivery|auditable repo delivery/i);
    // CrewAI has guardrails and checkpoint/resume — page must acknowledge them
    assert.match(pages.crewai, /guardrail/i, 'CrewAI page must acknowledge task-level guardrails');
    assert.match(pages.crewai, /checkpoint|resume/i, 'CrewAI page must acknowledge checkpoint/resume capability');
  });

  it('keeps the LangGraph page honest and code-backed', () => {
    assertCommonPageContract(pages.langgraph, 'LangGraph');
    assert.match(pages.langgraph, /durable execution|time-travel|interrupts/i);
    assert.match(pages.langgraph, /governed convergence|human-gated phase transitions|protocol-backed convergence/i);
  });

  it('keeps the OpenAI Agents SDK page aligned with current official strengths', () => {
    assertCommonPageContract(pages.openai, 'OpenAI Agents SDK');
    assert.match(pages.openai, /handoffs/i);
    assert.match(pages.openai, /tracing/i);
    assert.match(pages.openai, /sessions/i);
    assert.match(pages.openai, /provider-agnostic|100\+ other LLMs/i);
    assert.match(pages.openai, /RunState|interruptions|state\.approve/i);
    assert.match(pages.openai, /governed software delivery|delivery constitution/i);
  });

  it('keeps the AutoGen page honest about AG2 branding and orchestration patterns', () => {
    assertCommonPageContract(pages.autogen, 'AG2 / AutoGen');
    assert.match(pages.autogen, /AG2/i);
    assert.match(pages.autogen, /AutoPattern|RoundRobinPattern|ManualPattern|human_input_mode/i);
    assert.match(pages.autogen, /governed software delivery|auditable code convergence/i);
  });

  it('anchors public comparison claims to the competitive positioning matrix', () => {
    assert.match(POSITIONING_MATRIX, /\*\*CrewAI\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*LangGraph\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*OpenAI Agents SDK\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*AG2 \/ AutoGen\*\*/);
    assert.match(POSITIONING_MATRIX, /multi-provider|provider-agnostic/i);
    assert.match(POSITIONING_MATRIX, /OpenAI Swarm README/);
  });
});
