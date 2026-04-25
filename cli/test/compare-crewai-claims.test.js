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

const VS_CREWAI = read('website-v2/docs/compare/vs-crewai.mdx');
const SPEC = read('.planning/COMPARE_CREWAI_CLAIMS_SPEC.md');

describe('CrewAI comparison claims', () => {
  it('AT-CREWAI-CLAIMS-001: canonical compare page rejects stale absolutes about CrewAI', () => {
    assert.doesNotMatch(VS_CREWAI, /no audit trail/i);
    assert.doesNotMatch(VS_CREWAI, /Manual restart/);
    assert.doesNotMatch(VS_CREWAI, /Callback-based/);
    assert.doesNotMatch(VS_CREWAI, /Any agent can do anything/);
    assert.doesNotMatch(VS_CREWAI, /\| \*\*Multi-repo\*\* \| Not supported \|/);
  });

  it('AT-CREWAI-CLAIMS-002: vs-crewai uses source-backed recovery wording', () => {
    assert.match(
      VS_CREWAI,
      /\| \*\*Workflow model\*\* \| Sequential or hierarchical crews, event-driven flows, A2A delegation \|/,
    );
    assert.match(
      VS_CREWAI,
      /\| \*\*Governance posture\*\* \| App-defined workflows and approvals; no built-in repository-delivery constitution \|/,
    );
    assert.match(
      VS_CREWAI,
      /\| \*\*Human review\*\* \| Task `human_input`, flow-level `@human_feedback`, webhook-based review\/resume loops \|/,
    );
    assert.match(
      VS_CREWAI,
      /\| \*\*Failure recovery\*\* \| Checkpointing for crews, flows, and agents; replay\/resume from saved state \|/,
    );
    assert.match(
      VS_CREWAI,
      /\| \*\*Audit surface\*\* \| AMP tracing, exportable traces, and third-party observability integrations \|/,
    );
    assert.match(
      VS_CREWAI,
      /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/,
    );
    assert.match(
      VS_CREWAI,
      /CrewAI can absolutely include human review, remote A2A delegation, and exportable tracing, but the delivery constitution is still application-defined\./,
    );
    assert.doesNotMatch(VS_CREWAI, /Checkpoint\/resume from last completed task \(v1\.14\+\)/);
  });

  it('records the CrewAI comparison claim boundary in a standalone spec', () => {
    assert.match(SPEC, /# Spec: CrewAI Comparison Claim Boundary/);
    assert.match(SPEC, /A2A as a first-class delegation primitive/);
    assert.match(SPEC, /webhook-based enterprise HITL review\/resume flows/);
    assert.match(SPEC, /task `human_input` and flow `@human_feedback`/);
    assert.match(SPEC, /no built-in cross-repo coordinator surface/i);
    assert.match(SPEC, /no audit trail/i);
    assert.match(SPEC, /AT-CREWAI-CLAIMS-004/);
    assert.match(SPEC, /AT-CREWAI-CLAIMS-005/);
  });

  it('AT-CREWAI-CLAIMS-005: vs-crewai exposes official CrewAI source links on-page', () => {
    assert.match(VS_CREWAI, /Last checked against CrewAI official docs on 2026-04-25/);
    for (const url of [
      'https://docs.crewai.com/',
      'https://docs.crewai.com/en/concepts/crews',
      'https://docs.crewai.com/en/concepts/flows',
      'https://docs.crewai.com/en/concepts/tasks',
      'https://docs.crewai.com/en/learn/human-in-the-loop',
      'https://docs.crewai.com/en/concepts/checkpointing',
      'https://docs.crewai.com/en/learn/a2a-agent-delegation',
      'https://docs.crewai.com/en/observability/overview',
      'https://docs.crewai.com/en/observability/tracing',
    ]) {
      assert.ok(VS_CREWAI.includes(url), `CrewAI comparison page must link to ${url}`);
    }
  });
});
