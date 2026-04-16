import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const VS_AUTOGEN = read('website-v2/src/pages/compare/vs-autogen.mdx');
const VS_OPENAI_AGENTS = read('website-v2/src/pages/compare/vs-openai-agents-sdk.mdx');
const DOC_COMPARE_AUTOGEN = read('website-v2/docs/compare-autogen.mdx');
const DOC_COMPARE_CREWAI = read('website-v2/docs/compare-crewai.mdx');
const VS_WARP = read('website-v2/src/pages/compare/vs-warp.mdx');
const SPEC = read('.planning/COMPARE_RUNTIME_SURFACE_SPEC.md');

function assertNamesAllAdapters(text, label) {
  const requiredAdapters = ['manual', 'local_cli', 'api_proxy', 'mcp', 'remote_agent'];
  for (const adapter of requiredAdapters) {
    assert.match(
      text,
      new RegExp(`\\b${adapter}\\b`),
      `${label} must mention ${adapter}`,
    );
  }
}

describe('compare page runtime surface', () => {
  it('AT-COMPARE-RUNTIME-001: vs-autogen names all five shipped adapters', () => {
    assertNamesAllAdapters(VS_AUTOGEN, 'vs-autogen comparison page');
    assert.doesNotMatch(
      VS_AUTOGEN,
      /Connector-based \(manual, local CLI, API proxy\)/,
      'vs-autogen comparison page must not regress to the stale three-adapter wording',
    );
  });

  it('AT-COMPARE-RUNTIME-002: vs-openai-agents-sdk names all five shipped adapters', () => {
    assertNamesAllAdapters(VS_OPENAI_AGENTS, 'vs-openai-agents-sdk comparison page');
    assert.doesNotMatch(
      VS_OPENAI_AGENTS,
      /Manual, local CLI, and API-backed runtimes/,
      'vs-openai-agents-sdk comparison page must not hide the shipped adapter surface behind stale shorthand',
    );
  });

  it('AT-COMPARE-RUNTIME-003: compare-autogen describes portability through the shipped adapters', () => {
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /Any runtime that speaks the protocol can participate through the shipped adapters: `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`\./,
    );
    assert.doesNotMatch(
      DOC_COMPARE_AUTOGEN,
      /Python, TypeScript, shell scripts, cloud APIs, IDE extensions/,
      'compare-autogen must not replace the adapter contract with a stale platform-category laundry list',
    );
  });

  it('AT-COMPARE-RUNTIME-004: compare-crewai uses the canonical five-adapter order', () => {
    assert.match(
      DOC_COMPARE_CREWAI,
      /AgentXchain agents connect via adapters \(`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`\)/,
    );
    assert.doesNotMatch(
      DOC_COMPARE_CREWAI,
      /AgentXchain agents connect via adapters \(`local_cli`, `api_proxy`, `mcp`, `remote_agent`, `manual`\)/,
      'compare-crewai must not shuffle the canonical five-adapter order',
    );
  });

  it('AT-COMPARE-RUNTIME-005: vs-warp names the shipped adapters in the remote-execution contrast', () => {
    assert.match(
      VS_WARP,
      /\| \*\*Remote execution\*\* \| Oz CLI, cloud agents, environments, MCP tools \| Governed local runner, multi-repo coordination, and adapters: \(`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`\) \|/,
    );
    assert.doesNotMatch(
      VS_WARP,
      /connector-based execution/,
      'vs-warp must not regress to vague connector-based execution wording',
    );
  });

  it('records the broader comparison-surface contract in a standalone spec', () => {
    assert.match(SPEC, /# Spec: Comparison Surface Runtime Claims/);
    assert.match(SPEC, /AT-COMPARE-RUNTIME-005/);
    assert.match(SPEC, /language\/platform laundry list/i);
    assert.match(SPEC, /canonical order `manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`/i);
  });
});
