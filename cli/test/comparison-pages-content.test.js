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
const FRONTDOOR_SPEC = read('.planning/COMPARISON_LAUNCH_FRONTDOOR_SPEC.md');

const pages = {
  crewai: read('website-v2/docs/compare/vs-crewai.mdx'),
  langgraph: read('website-v2/docs/compare/vs-langgraph.mdx'),
  openai: read('website-v2/docs/compare/vs-openai-agents-sdk.mdx'),
  autogen: read('website-v2/docs/compare/vs-autogen.mdx'),
  warp: read('website-v2/docs/compare/vs-warp.mdx'),
  devin: read('website-v2/docs/compare/vs-devin.mdx'),
  metagpt: read('website-v2/docs/compare/vs-metagpt.mdx'),
  codegen: read('website-v2/docs/compare/vs-codegen.mdx'),
  openhands: read('website-v2/docs/compare/vs-openhands.mdx'),
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
  assert.match(page, /agentxchain init --governed .*--goal "/, `${competitorName} page must use mission-aware governed scaffold`);
  assert.match(page, /agentxchain doctor/, `${competitorName} page must route operators through doctor`);
  assert.doesNotMatch(page, /(^|\n)agentxchain init --governed\s*$/m, `${competitorName} page must not retain bare governed init`);
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
    assert.match(pages.crewai, /\| \*\*Governance posture\*\* \| App-defined workflows and approvals; no built-in repository-delivery constitution \|/);
    assert.match(pages.crewai, /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/);
    // CrewAI has guardrails and checkpoint/resume — page must acknowledge them
    assert.match(pages.crewai, /guardrail/i, 'CrewAI page must acknowledge task-level guardrails');
    assert.match(pages.crewai, /checkpoint|resume/i, 'CrewAI page must acknowledge checkpoint/resume capability');
    assert.match(pages.crewai, /A2A/i, 'CrewAI page must acknowledge first-class A2A delegation support');
    assert.match(pages.crewai, /Source baseline/, 'CrewAI page must expose the source baseline on-page');
    assert.match(pages.crewai, /https:\/\/docs\.crewai\.com\/en\/concepts\/tasks/, 'CrewAI page must link to official task docs');
    assert.match(pages.crewai, /https:\/\/docs\.crewai\.com\/en\/observability\/tracing/, 'CrewAI page must link to official tracing docs');
  });

  it('keeps the LangGraph page honest and code-backed', () => {
    assertCommonPageContract(pages.langgraph, 'LangGraph');
    assert.match(pages.langgraph, /durable execution|time-travel|interrupts/i);
    assert.match(pages.langgraph, /\| \*\*Governance posture\*\* \| App-defined orchestration; no built-in delivery-governance layer \|/);
    assert.match(pages.langgraph, /\| \*\*Recovery posture\*\* \| Durable checkpoints, time travel, and interrupt\/resume flows \|/);
    assert.match(pages.langgraph, /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/);
    assert.match(pages.langgraph, /Command/i, 'LangGraph page must acknowledge Command-based routing');
    assert.match(pages.langgraph, /subgraph|parallel/i, 'LangGraph page must acknowledge subgraphs or parallel fan-out');
    assert.match(pages.langgraph, /governed convergence|human-gated phase transitions|protocol-backed convergence/i);
    assert.match(pages.langgraph, /Source baseline/, 'LangGraph page must expose the source baseline on-page');
    assert.match(pages.langgraph, /https:\/\/docs\.langchain\.com\/oss\/python\/langgraph\/interrupts/, 'LangGraph page must link to official interrupts docs');
    assert.match(pages.langgraph, /https:\/\/docs\.langchain\.com\/oss\/python\/langgraph\/observability/, 'LangGraph page must link to official observability docs');
  });

  it('keeps the OpenAI Agents SDK page aligned with current official strengths', () => {
    assertCommonPageContract(pages.openai, 'OpenAI Agents SDK');
    assert.match(pages.openai, /handoffs/i);
    assert.match(pages.openai, /tracing/i);
    assert.match(pages.openai, /sessions/i);
    assert.match(pages.openai, /third-party provider adapters|LiteLLM-backed routing/i);
    assert.match(pages.openai, /RunState|interruptions|state\.approve/i);
    assert.match(pages.openai, /governed software delivery|delivery constitution/i);
    assert.match(pages.openai, /Source baseline/, 'OpenAI Agents SDK page must expose the source baseline on-page');
    assert.match(pages.openai, /https:\/\/developers\.openai\.com\/api\/docs\/guides\/agents/, 'OpenAI Agents SDK page must link to official Agents SDK guide');
    assert.match(pages.openai, /https:\/\/openai\.github\.io\/openai-agents-python\/human_in_the_loop\//, 'OpenAI Agents SDK page must link to official HITL docs');
    assert.match(pages.openai, /https:\/\/openai\.github\.io\/openai-agents-python\/ref\/extensions\/models\/litellm_provider\//, 'OpenAI Agents SDK page must link to official LiteLLM provider docs');
  });

  it('keeps the AutoGen page honest about AG2 branding and orchestration patterns', () => {
    assertCommonPageContract(pages.autogen, 'AG2 / AutoGen');
    assert.match(pages.autogen, /AG2/i);
    assert.match(pages.autogen, /\| \*\*Governance posture\*\* \| App-defined safeguards and approval patterns; no built-in repository-delivery governance layer \|/);
    assert.match(pages.autogen, /\| \*\*Recovery posture\*\* \| Resume-from-history and app-managed conversation durability \|/);
    assert.match(pages.autogen, /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/);
    assert.match(pages.autogen, /DefaultPattern|AutoPattern|RoundRobinPattern|ManualPattern/i);
    assert.match(pages.autogen, /governed software delivery|auditable code convergence/i);
    // AG2 has guardrails and safeguards — page must acknowledge both as distinct features
    assert.match(pages.autogen, /guardrail/i, 'AG2 page must acknowledge guardrails');
    assert.match(pages.autogen, /safeguard/i, 'AG2 page must acknowledge safeguards');
    assert.match(pages.autogen, /AG-UI/i, 'AG2 page must acknowledge AG-UI protocol support');
    assert.match(pages.autogen, /[Ss]warm/i, 'AG2 page must acknowledge Swarm (deprecated, merged into group chat)');
    assert.match(pages.autogen, /Source baseline/, 'AG2 page must expose the source baseline on-page');
    assert.match(pages.autogen, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/guardrails/, 'AG2 page must link to official guardrails docs');
    assert.match(pages.autogen, /https:\/\/docs\.ag2\.ai\/latest\/docs\/beta\/telemetry/, 'AG2 page must link to official telemetry docs');
  });

  it('keeps the Warp page honest about AI-native terminal framing', () => {
    assertCommonPageContract(pages.warp, 'Warp');
    assert.match(pages.warp, /Agentic Development Environment/i, 'Warp page must acknowledge current ADE framing');
    assert.match(pages.warp, /AI-native terminal/i);
    assert.match(pages.warp, /Warp Drive/i, 'Warp page must mention Warp Drive');
    assert.match(pages.warp, /Oz/i, 'Warp page must mention Oz');
    assert.match(pages.warp, /third-party CLI agents/i, 'Warp page must mention third-party CLI agent support');
    assert.match(pages.warp, /Full Terminal Use/i, 'Warp page must mention Full Terminal Use');
    assert.match(pages.warp, /Source baseline/, 'Warp page must expose the source baseline on-page');
    assert.match(pages.warp, /https:\/\/docs\.warp\.dev\/agent-platform\/capabilities\/agent-profiles-permissions/, 'Warp page must link to official profiles and permissions docs');
    assert.match(pages.warp, /https:\/\/docs\.warp\.dev\/reference\/cli\/cli/, 'Warp page must link to official Oz CLI docs');
    assert.match(pages.warp, /https:\/\/docs\.warp\.dev\/agent-platform\/cloud-agents\/platform/, 'Warp page must link to official Oz Platform docs');
    assert.match(pages.warp, /governed software delivery|delivery constitution/i);
  });

  it('keeps the Devin page honest about autonomous agent framing', () => {
    assertCommonPageContract(pages.devin, 'Devin');
    assert.match(pages.devin, /autonomous/i, 'Devin page must acknowledge autonomous agent capability');
    assert.match(pages.devin, /parallel/i, 'Devin page must acknowledge parallel Devin instances');
    assert.match(pages.devin, /Knowledge|Playbooks/i, 'Devin page must acknowledge Knowledge/Playbooks');
    assert.match(pages.devin, /governed software delivery|delivery governance protocol/i);
    assert.match(pages.devin, /Source baseline/, 'Devin page must expose the source baseline on-page');
    assert.match(pages.devin, /https:\/\/docs\.devin\.ai\/work-with-devin\/advanced-capabilities/, 'Devin page must link to official advanced capabilities docs');
    assert.match(pages.devin, /https:\/\/docs\.devin\.ai\/api-reference\/overview/, 'Devin page must link to official API overview docs');
    assert.match(pages.devin, /https:\/\/docs\.devin\.ai\/essential-guidelines\/sdlc-integration/, 'Devin page must link to official SDLC integration docs');
  });

  it('keeps the MetaGPT page honest about SOP-driven multi-agent framing', () => {
    assertCommonPageContract(pages.metagpt, 'MetaGPT');
    assert.match(pages.metagpt, /Standard Operating Procedure|SOP/i, 'MetaGPT page must acknowledge SOPs');
    assert.match(pages.metagpt, /Product Manager|Architect|Engineer/i, 'MetaGPT page must acknowledge role assignments');
    assert.match(pages.metagpt, /ICLR 2024|AFlow/i, 'MetaGPT page must acknowledge current research backing precisely');
    assert.match(pages.metagpt, /Data Interpreter|Researcher|Atoms/i, 'MetaGPT page must acknowledge current specialist or hosted-product surfaces');
    assert.match(pages.metagpt, /breakpoint recovery|Serialization/i, 'MetaGPT page must acknowledge scoped recovery rather than restart-only phrasing');
    assert.match(pages.metagpt, /governed software delivery|delivery protocol/i);
    assert.match(pages.metagpt, /honest overlap|overlap/i, 'MetaGPT page must honestly acknowledge category overlap');
    assert.match(pages.metagpt, /Source baseline/, 'MetaGPT page must expose the source baseline on-page');
    assert.match(pages.metagpt, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/tutorials\/human_engagement/, 'MetaGPT page must link to official human engagement docs');
    assert.match(pages.metagpt, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/in_depth_guides\/incremental_development/, 'MetaGPT page must link to official incremental development docs');
  });

  it('keeps the Codegen page honest about enterprise agent platform framing', () => {
    assertCommonPageContract(pages.codegen, 'Codegen');
    assert.match(pages.codegen, /managed|SaaS|platform/i, 'Codegen page must acknowledge managed platform model');
    assert.match(pages.codegen, /sandbox/i, 'Codegen page must acknowledge sandboxed execution');
    assert.match(pages.codegen, /agent rules|agent permissions|three-tier/i, 'Codegen page must acknowledge agent rules or permissions');
    assert.match(pages.codegen, /governed software delivery|governance protocol/i);
    assert.match(pages.codegen, /Source baseline/, 'Codegen page must expose the source baseline on-page');
    assert.match(pages.codegen, /https:\/\/docs\.codegen\.com\/settings\/repo-rules/, 'Codegen page must link to official agent rules docs');
    assert.match(pages.codegen, /https:\/\/docs\.codegen\.com\/sandboxes\/overview/, 'Codegen page must link to official sandboxes docs');
    assert.match(pages.codegen, /https:\/\/docs\.codegen\.com\/capabilities\/capabilities/, 'Codegen page must link to official capabilities docs');
  });

  it('keeps the OpenHands page honest about open-source agent platform framing', () => {
    assertCommonPageContract(pages.openhands, 'OpenHands');
    assert.match(pages.openhands, /open.source/i, 'OpenHands page must acknowledge open-source nature');
    assert.match(pages.openhands, /SDK/i, 'OpenHands page must acknowledge SDK');
    assert.match(pages.openhands, /sandbox/i, 'OpenHands page must acknowledge sandboxed execution');
    assert.match(pages.openhands, /provider.agnostic|model.agnostic/i, 'OpenHands page must acknowledge provider/model-agnostic execution');
    assert.match(pages.openhands, /Cloud.*RBAC|RBAC|Enterprise/i, 'OpenHands page must acknowledge Cloud/Enterprise tiers');
    assert.match(pages.openhands, /Source baseline/, 'OpenHands page must expose the source baseline on-page');
    assert.match(pages.openhands, /https:\/\/github\.com\/OpenHands\/software-agent-sdk\//, 'OpenHands page must link to official SDK README');
    assert.match(pages.openhands, /https:\/\/docs\.openhands\.dev\/sdk\/arch\/agent-server/, 'OpenHands page must link to official Agent Server docs');
    assert.match(pages.openhands, /https:\/\/docs\.openhands\.dev\/enterprise/, 'OpenHands page must link to official Enterprise docs');
    assert.match(pages.openhands, /governed software delivery|governance protocol/i);
  });

  it('anchors public comparison claims to the competitive positioning matrix', () => {
    assert.match(POSITIONING_MATRIX, /\*\*CrewAI\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*MetaGPT\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*LangGraph\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*OpenAI Agents SDK\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*AG2 \/ AutoGen\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*OpenHands\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*Devin\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*Codegen\*\*/);
    assert.match(POSITIONING_MATRIX, /\*\*Warp\*\*/);
    assert.match(POSITIONING_MATRIX, /Atoms|Data Interpreter|Researcher/i);
    assert.match(POSITIONING_MATRIX, /managed Devin child sessions/i);
    assert.match(POSITIONING_MATRIX, /Agentic Development Environment/i);
    assert.match(POSITIONING_MATRIX, /Command routing|parallel supersteps|subgraph composition/i);
    assert.match(POSITIONING_MATRIX, /multi-provider|provider-agnostic/i);
    assert.match(POSITIONING_MATRIX, /OpenAI Swarm README/);
  });

  it('records the comparison front-door contract in a standalone spec', () => {
    assert.match(FRONTDOOR_SPEC, /# Comparison And Launch Front-Door Spec/);
    assert.match(FRONTDOOR_SPEC, /AT-CLFD-001/);
    assert.match(FRONTDOOR_SPEC, /AT-CLFD-004/);
  });
});
