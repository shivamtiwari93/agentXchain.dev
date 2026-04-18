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

const VS_LANGGRAPH = read('website-v2/docs/compare/vs-langgraph.mdx');
const SPEC = read('.planning/COMPARE_LANGGRAPH_CLAIMS_SPEC.md');

describe('LangGraph comparison claims', () => {
  it('AT-LANGGRAPH-CLAIMS-001: canonical compare page rejects stale absolutes about LangGraph', () => {
    assert.doesNotMatch(VS_LANGGRAPH, /\| \*\*Governance\*\* \| None built-in \|/);
    assert.doesNotMatch(VS_LANGGRAPH, /\| \*\*Human oversight\*\* \| Interrupt nodes, breakpoints \|/);
    assert.doesNotMatch(VS_LANGGRAPH, /\| \*\*Multi-repo\*\* \| Not supported \|/);
    assert.doesNotMatch(VS_LANGGRAPH, /resume workflows from any node/i);
    assert.doesNotMatch(VS_LANGGRAPH, /\*\*LangGraph Platform\.\*\* Hosted cloud execution with API access and monitoring\./);
  });

  it('AT-LANGGRAPH-CLAIMS-002: vs-langgraph names current human-oversight capabilities precisely', () => {
    assert.match(
      VS_LANGGRAPH,
      /\| \*\*Governance posture\*\* \| App-defined orchestration; no built-in delivery-governance layer \|/,
    );
    assert.match(
      VS_LANGGRAPH,
      /\| \*\*Human authority\*\* \| Interrupts with checkpoint-backed resume and state inspection\/modification \|/,
    );
    assert.match(
      VS_LANGGRAPH,
      /\| \*\*Recovery posture\*\* \| Durable checkpoints, time travel, and interrupt\/resume flows \|/,
    );
    assert.match(
      VS_LANGGRAPH,
      /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/,
    );
    assert.match(
      VS_LANGGRAPH,
      /LangGraph can absolutely support human interrupts, checkpoint-backed resume, state inspection\/modification, subgraphs, and parallel fan-out\./,
    );
    assert.doesNotMatch(VS_LANGGRAPH, /\| \*\*Human authority\*\* \| Interrupts with checkpoint-backed resume and state intervention \|/);
  });

  it('records the LangGraph comparison claim boundary in a standalone spec', () => {
    assert.match(SPEC, /# Spec: LangGraph Comparison Claim Boundary/);
    assert.match(SPEC, /checkpoint-backed interrupts, resume via `Command`, and state inspection\/modification/);
    assert.match(SPEC, /no built-in cross-repo coordinator surface/i);
    assert.match(SPEC, /resume `from any node`/);
    assert.match(SPEC, /AT-LANGGRAPH-CLAIMS-004/);
  });
});
