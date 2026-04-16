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

const VS_CREWAI = read('website-v2/src/pages/compare/vs-crewai.mdx');
const DOC_COMPARE_CREWAI = read('website-v2/docs/compare-crewai.mdx');
const SPEC = read('.planning/COMPARE_CREWAI_CLAIMS_SPEC.md');

describe('CrewAI comparison claims', () => {
  it('AT-CREWAI-CLAIMS-001: compare-crewai acknowledges current CrewAI capabilities and rejects stale absolutes', () => {
    assert.match(
      DOC_COMPARE_CREWAI,
      /\| \*\*Governance\*\* \| HITL and tracing exist, but governance stays app-defined \|/,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /\| \*\*State persistence\*\* \| Flow persistence and checkpointing for app-defined workflows \|/,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /\| \*\*Recovery\*\* \| Checkpointing and flow persistence; recovery semantics stay app-defined \|/,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /\| \*\*Multi-repo\*\* \| No built-in cross-repo coordinator surface \|/,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /\| \*\*Human oversight\*\* \| `@human_feedback`, task `human_input`, and callbacks \|/,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /CrewAI agents execute tasks and flows with built-in tracing and HITL options, but the governance model remains application-defined\./,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /Current docs include flow persistence and early-release checkpointing so crews, flows, and agents can resume after failures\./,
    );
    assert.match(
      DOC_COMPARE_CREWAI,
      /CrewAI supports human-in-the-loop through task `human_input`, flow `@human_feedback`, and callbacks\./,
    );

    assert.doesNotMatch(DOC_COMPARE_CREWAI, /no audit trail/i);
    assert.doesNotMatch(DOC_COMPARE_CREWAI, /Manual restart/);
    assert.doesNotMatch(DOC_COMPARE_CREWAI, /Callback-based/);
    assert.doesNotMatch(DOC_COMPARE_CREWAI, /Any agent can do anything/);
    assert.doesNotMatch(DOC_COMPARE_CREWAI, /\| \*\*Multi-repo\*\* \| Not supported \|/);
  });

  it('AT-CREWAI-CLAIMS-002: vs-crewai uses source-backed recovery wording', () => {
    assert.match(
      VS_CREWAI,
      /\| \*\*Workflow model\*\* \| Sequential or hierarchical crews, event-driven flows, A2A delegation \|/,
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
  });
});
