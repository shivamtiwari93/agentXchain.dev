import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (relPath) => readFileSync(join(REPO_ROOT, relPath), 'utf8');

const SPEC = read('.planning/COMPARISON_PAGE_SPEC.md');
const MATRIX = read('.planning/COMPETITIVE_POSITIONING_MATRIX.md');
const HOME = read('website-v2/src/pages/index.tsx');
const CONFIG = read('website-v2/docusaurus.config.ts');

const PAGES = [
  {
    relPath: 'website-v2/src/pages/compare/vs-crewai.mdx',
    route: '/compare/vs-crewai',
    competitor: 'CrewAI',
    strengthTerms: ['crew', 'flow', 'observability'],
  },
  {
    relPath: 'website-v2/src/pages/compare/vs-langgraph.mdx',
    route: '/compare/vs-langgraph',
    competitor: 'LangGraph',
    strengthTerms: ['durable', 'graph', 'LangSmith'],
  },
  {
    relPath: 'website-v2/src/pages/compare/vs-openai-agents-sdk.mdx',
    route: '/compare/vs-openai-agents-sdk',
    competitor: 'OpenAI Agents SDK',
    strengthTerms: ['handoff', 'guardrail', 'tracing'],
  },
  {
    relPath: 'website-v2/src/pages/compare/vs-autogen.mdx',
    route: '/compare/vs-autogen',
    competitor: 'AG2 / AutoGen',
    strengthTerms: ['RoundRobinPattern', 'human_input_mode', 'conversation'],
  },
];

describe('Comparison page surface', () => {
  it('keeps the spec aligned with the Docusaurus routes and acceptance contract', () => {
    for (const term of [
      '/compare/vs-crewai',
      '/compare/vs-langgraph',
      '/compare/vs-openai-agents-sdk',
      '/compare/vs-autogen',
      'website-v2/src/pages/compare/',
      'AT-COMP-001',
      'AT-COMP-007',
    ]) {
      assert.match(SPEC, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.doesNotMatch(SPEC, /website\/docs\/vs-crewai\.html/);
    assert.doesNotMatch(SPEC, /website\/index\.html/);
  });

  it('links every comparison page from the homepage, navbar, and footer', () => {
    for (const { route } of PAGES) {
      assert.match(HOME, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(CONFIG, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('Comparison page content', () => {
  for (const page of PAGES) {
    const source = read(page.relPath);

    it(`${page.competitor} page exists and follows the required structure`, () => {
      assert.ok(existsSync(join(REPO_ROOT, page.relPath)));

      for (const section of [
        '## The short answer',
        '## Comparison',
        '## Choose',
        '## A concrete workflow difference',
        '## Using both together',
      ]) {
        assert.match(source, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }

      assert.match(source, /```/);
      assert.match(source, /\/docs\/quickstart/);
      assert.match(source, /\/docs\/protocol/);
      assert.match(source, /mandatory challenge|protocol-enforced/i);
      assert.match(source, /append-only|decision ledger|objection/i);
    });

    it(`${page.competitor} page stays honest about competitor strengths`, () => {
      for (const term of page.strengthTerms) {
        assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }

      assert.match(source, /Choose .* when/);
      assert.doesNotMatch(source, /replaces? .*AgentXchain/i);
      assert.doesNotMatch(source, /best general orchestration/i);
    });
  }
});

describe('Comparison page positioning alignment', () => {
  it('stays consistent with the competitive positioning matrix', () => {
    for (const term of [
      'CrewAI',
      'AG2 / AutoGen',
      'LangGraph',
      'OpenAI Agents SDK',
      'mandatory challenge',
      'phase gates',
      'append-only',
      'governed software delivery',
    ]) {
      assert.match(MATRIX, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });
});
