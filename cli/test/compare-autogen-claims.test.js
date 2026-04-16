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
const DOC_COMPARE_AUTOGEN = read('website-v2/docs/compare-autogen.mdx');
const SPEC = read('.planning/COMPARE_AUTOGEN_CLAIMS_SPEC.md');

describe('AutoGen comparison claims', () => {
  it('AT-AUTOGEN-CLAIMS-001: compare-autogen uses scoped, current AG2 wording and rejects stale absolutes', () => {
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /\| \*\*Governance\*\* \| Guardrails, safeguards, and app-defined control; no built-in repository-delivery governance layer \|/,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /\| \*\*Human oversight\*\* \| `human_input_mode`, user agents, and A2A\/AG-UI HITL flows \|/,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /\| \*\*IDE \/ UI integration\*\* \| Python-first library plus AG-UI \/ app-defined integrations \|/,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /\| \*\*Recovery\*\* \| Resume chats from saved message history; durability stays app-managed \|/,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /\| \*\*Multi-repo\*\* \| No built-in cross-repo coordinator surface \|/,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /there is still no protocol-native decision ledger or repository ship-gate trail that proves what was accepted as delivery work after the fact\./i,
    );
    assert.match(
      DOC_COMPARE_AUTOGEN,
      /AG2 can resume group chats from saved message history, and its current docs expose conversation-oriented persistence, HITL, and tracing surfaces\./,
    );

    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /\| \*\*Governance\*\* \| None built-in \|/);
    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /\| \*\*Human oversight\*\* \| Human proxy agent in conversation \|/);
    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /\| \*\*IDE integration\*\* \| None \(Python library\) \|/);
    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /\| \*\*Recovery\*\* \| Manual \|/);
    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /\| \*\*Multi-repo\*\* \| Not supported \|/);
    assert.doesNotMatch(DOC_COMPARE_AUTOGEN, /If the process crashes, the conversation is lost\./);
  });

  it('AT-AUTOGEN-CLAIMS-002: vs-autogen names current AG2 oversight and observability precisely', () => {
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Human involvement\*\* \| `human_input_mode`, user agents, and A2A\/AG-UI human approval patterns \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Audit surface\*\* \| Conversation history, safeguard events, and OpenTelemetry tracing \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /AG2 can include humans and manual control, and it now provides guardrails\/safeguards, remote HITL, and tracing for flexible coordination\./,
    );
  });

  it('records the AutoGen comparison claim boundary in a standalone spec', () => {
    assert.match(SPEC, /# Spec: AutoGen Comparison Claim Boundary/);
    assert.match(SPEC, /`human_input_mode`, user agents, and A2A\/AG-UI human-in-the-loop flows/);
    assert.match(SPEC, /no built-in repository-delivery governance layer/i);
    assert.match(SPEC, /resume-from-history behavior/i);
    assert.match(SPEC, /AT-AUTOGEN-CLAIMS-004/);
  });
});
