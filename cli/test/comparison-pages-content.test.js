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
  warp: read('website-v2/src/pages/compare/vs-warp.mdx'),
  devin: read('website-v2/src/pages/compare/vs-devin.mdx'),
  metagpt: read('website-v2/src/pages/compare/vs-metagpt.mdx'),
  codegen: read('website-v2/src/pages/compare/vs-codegen.mdx'),
  openhands: read('website-v2/src/pages/compare/vs-openhands.mdx'),
};

const REQUIRED_ROUTES = [
  '/compare/vs-crewai',
  '/compare/vs-langgraph',
  '/compare/vs-openai-agents-sdk',
  '/compare/vs-autogen',
  '/compare/vs-warp',
  '/compare/vs-devin',
  '/compare/vs-metagpt',
  '/compare/vs-codegen',
  '/compare/vs-openhands',
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
    assert.match(pages.langgraph, /Command/i, 'LangGraph page must acknowledge Command-based routing');
    assert.match(pages.langgraph, /subgraph|parallel/i, 'LangGraph page must acknowledge subgraphs or parallel fan-out');
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
    // AG2 has guardrails and A2A/AG-UI — page must acknowledge them
    assert.match(pages.autogen, /guardrail/i, 'AG2 page must acknowledge guardrails');
    assert.match(pages.autogen, /A2A|AG-UI/i, 'AG2 page must acknowledge A2A or AG-UI protocol support');
    assert.match(pages.autogen, /[Ss]warm/i, 'AG2 page must acknowledge Swarm-style orchestration');
  });

  it('keeps the Warp page honest about AI-native terminal framing', () => {
    assertCommonPageContract(pages.warp, 'Warp');
    assert.match(pages.warp, /AI-native terminal/i);
    assert.match(pages.warp, /Warp Drive/i, 'Warp page must mention Warp Drive');
    assert.match(pages.warp, /Oz/i, 'Warp page must mention Oz CLI');
    assert.match(pages.warp, /governed software delivery|delivery constitution/i);
  });

  it('keeps the Devin page honest about autonomous agent framing', () => {
    assertCommonPageContract(pages.devin, 'Devin');
    assert.match(pages.devin, /autonomous/i, 'Devin page must acknowledge autonomous agent capability');
    assert.match(pages.devin, /parallel/i, 'Devin page must acknowledge parallel Devin instances');
    assert.match(pages.devin, /fine-tun/i, 'Devin page must acknowledge fine-tunability');
    assert.match(pages.devin, /governed software delivery|delivery governance protocol/i);
  });

  it('keeps the MetaGPT page honest about SOP-driven multi-agent framing', () => {
    assertCommonPageContract(pages.metagpt, 'MetaGPT');
    assert.match(pages.metagpt, /Standard Operating Procedure|SOP/i, 'MetaGPT page must acknowledge SOPs');
    assert.match(pages.metagpt, /Product Manager|Architect|Engineer/i, 'MetaGPT page must acknowledge role assignments');
    assert.match(pages.metagpt, /ICLR/i, 'MetaGPT page must acknowledge research backing');
    assert.match(pages.metagpt, /governed software delivery|delivery protocol/i);
    assert.match(pages.metagpt, /honest overlap|overlap/i, 'MetaGPT page must honestly acknowledge category overlap');
  });

  it('keeps the Codegen page honest about enterprise agent platform framing', () => {
    assertCommonPageContract(pages.codegen, 'Codegen');
    assert.match(pages.codegen, /managed|SaaS|platform/i, 'Codegen page must acknowledge managed platform model');
    assert.match(pages.codegen, /sandbox/i, 'Codegen page must acknowledge sandboxed execution');
    assert.match(pages.codegen, /repository rules|repo rules|agent permissions/i, 'Codegen page must acknowledge repository governance features');
    assert.match(pages.codegen, /governed software delivery|governance protocol/i);
  });

  it('keeps the OpenHands page honest about open-source agent platform framing', () => {
    assertCommonPageContract(pages.openhands, 'OpenHands');
    assert.match(pages.openhands, /open.source/i, 'OpenHands page must acknowledge open-source nature');
    assert.match(pages.openhands, /SDK/i, 'OpenHands page must acknowledge SDK');
    assert.match(pages.openhands, /sandbox/i, 'OpenHands page must acknowledge sandboxed execution');
    assert.match(pages.openhands, /model.agnostic/i, 'OpenHands page must acknowledge model-agnostic execution');
    assert.match(pages.openhands, /governed software delivery|governance protocol/i);
  });

  it('anchors public comparison claims to the competitive positioning matrix', () => {
    assert.match(POSITIONING_MATRIX, /\*\*CrewAI\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*LangGraph\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*OpenAI Agents SDK\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*AG2 \/ AutoGen\*\*/);
    assert.match(POSITIONING_MATRIX, /Command routing|parallel supersteps|subgraph composition/i);
    assert.match(POSITIONING_MATRIX, /multi-provider|provider-agnostic/i);
    assert.match(POSITIONING_MATRIX, /OpenAI Swarm README/);
  });
});
