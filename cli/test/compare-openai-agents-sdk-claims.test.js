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

const VS_OPENAI = read('website-v2/docs/compare/vs-openai-agents-sdk.mdx');
const MATRIX = read('.planning/COMPETITIVE_POSITIONING_MATRIX.md');
const SPEC = read('.planning/COMPARE_OPENAI_AGENTS_SDK_CLAIMS_SPEC.md');

describe('OpenAI Agents SDK comparison claims', () => {
  it('AT-OAI-001: short answer names MCP, sandbox agents, hosted tools, realtime, durable execution', () => {
    assert.match(VS_OPENAI, /MCP tool calling/);
    assert.match(VS_OPENAI, /sandbox agents/);
    assert.match(VS_OPENAI, /hosted tools/);
    assert.match(VS_OPENAI, /realtime voice agents/);
    assert.match(VS_OPENAI, /durable execution integrations/);
    assert.match(VS_OPENAI, /Temporal, Restate, DBOS/);
  });

  it('AT-OAI-002: comparison table workflow-model row names MCP, sandbox, hosted tools, realtime', () => {
    assert.match(VS_OPENAI, /\| \*\*Workflow model\*\* \|.*MCP tool calling.*sandbox agents.*hosted tools.*realtime voice agents/);
  });

  it('AT-OAI-003: tracing row acknowledges 25+ integrations', () => {
    assert.match(VS_OPENAI, /25\+ integrations/);
  });

  it('AT-OAI-004: page does not reduce SDK to lightweight primitives as primary framing', () => {
    // The short answer should describe a broad framework, not lightweight primitives
    assert.doesNotMatch(
      VS_OPENAI,
      /Choose the OpenAI Agents SDK.*lightweight primitives for building/,
      'short answer must not reduce the SDK to lightweight primitives',
    );
  });

  it('AT-OAI-005: matrix row acknowledges MCP, sandbox, hosted tools, durable execution', () => {
    // Find the OpenAI Agents SDK row in the matrix
    const matrixRow = MATRIX.split('\n').find(line => line.includes('**OpenAI Agents SDK**'));
    assert.ok(matrixRow, 'matrix must contain an OpenAI Agents SDK row');
    assert.match(matrixRow, /MCP tool calling/);
    assert.match(matrixRow, /sandbox agents/);
    assert.match(matrixRow, /hosted tools/);
    assert.match(matrixRow, /durable execution/i);
  });

  it('AT-OAI-006a: governance posture row exists', () => {
    assert.match(VS_OPENAI, /\| \*\*Governance posture\*\* \|/);
  });

  it('AT-OAI-006b: recovery posture row exists', () => {
    assert.match(VS_OPENAI, /\| \*\*Recovery posture\*\* \|/);
  });

  it('AT-OAI-006c: multi-repo posture row exists', () => {
    assert.match(VS_OPENAI, /\| \*\*Multi-repo posture\*\* \|/);
  });

  it('AT-OAI-006: sessions row acknowledges multiple backends', () => {
    assert.match(VS_OPENAI, /9\+ (?:storage )?backends/);
  });

  it('records the OpenAI Agents SDK claim boundary in a standalone spec', () => {
    assert.match(SPEC, /# Compare vs OpenAI Agents SDK/);
    assert.match(SPEC, /MCP support/);
    assert.match(SPEC, /Sandbox agents/);
    assert.match(SPEC, /Hosted tools/);
    assert.match(SPEC, /Realtime voice agents/);
    assert.match(SPEC, /Durable execution/);
    assert.match(SPEC, /DEC-OPENAI-AGENTS-SDK-COMPARE-CLAIMS-001/);
  });
});
