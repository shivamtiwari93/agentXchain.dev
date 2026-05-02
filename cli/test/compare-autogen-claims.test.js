import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const VS_AUTOGEN = read('website-v2/docs/compare/vs-autogen.mdx');
const SPEC = read('.planning/COMPARE_AUTOGEN_CLAIMS_SPEC.md');

describe('AutoGen comparison claims', () => {
  it('AT-AUTOGEN-CLAIMS-001: canonical compare page rejects stale absolutes about AG2', () => {
    assert.doesNotMatch(VS_AUTOGEN, /\| \*\*Governance\*\* \| None built-in \|/);
    assert.doesNotMatch(VS_AUTOGEN, /\| \*\*Human oversight\*\* \| Human proxy agent in conversation \|/);
    assert.doesNotMatch(VS_AUTOGEN, /\| \*\*IDE integration\*\* \| None \(Python library\) \|/);
    assert.doesNotMatch(VS_AUTOGEN, /\| \*\*Recovery\*\* \| Manual \|/);
    assert.doesNotMatch(VS_AUTOGEN, /\| \*\*Multi-repo\*\* \| Not supported \|/);
    assert.doesNotMatch(VS_AUTOGEN, /If the process crashes, the conversation is lost\./);
  });

  it('AT-AUTOGEN-CLAIMS-002: vs-autogen names current AG2 oversight and observability precisely', () => {
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Governance posture\*\* \| App-defined safeguards and approval patterns; no built-in repository-delivery governance layer \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Human involvement\*\* \| `human_input_mode` \(ALWAYS\/TERMINATE\/NEVER\), ManualPattern speaker selection, and AG-UI input-required flows \(beta\) \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Recovery posture\*\* \| Resume-from-history and app-managed conversation durability \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Multi-repo posture\*\* \| No built-in cross-repo coordinator surface \|/,
    );
    assert.match(
      VS_AUTOGEN,
      /\| \*\*Audit surface\*\* \| Conversation history, safeguard events, and OpenTelemetry tracing \(beta\) with multi-backend export/,
    );
    assert.match(
      VS_AUTOGEN,
      /AG2 can include humans and manual control, and it now provides per-agent guardrails, system-wide safeguards, HITL patterns, and OpenTelemetry tracing \(beta\) for flexible coordination\./,
    );
  });

  it('records the AutoGen comparison claim boundary in a standalone spec', () => {
    assert.match(SPEC, /# Spec: AutoGen Comparison Claim Boundary/);
    assert.match(SPEC, /`human_input_mode`, user agents, and A2A\/AG-UI human-in-the-loop flows/);
    assert.match(SPEC, /no built-in repository-delivery governance layer/i);
    assert.match(SPEC, /resume-from-history behavior/i);
    assert.match(SPEC, /AT-AUTOGEN-CLAIMS-004/);
    assert.match(SPEC, /AT-AUTOGEN-CLAIMS-005/);
  });

  it('AT-AUTOGEN-CLAIMS-005: vs-autogen exposes official source links and last-checked date', () => {
    assert.match(VS_AUTOGEN, /Source baseline/, 'AutoGen page must expose the source baseline on-page');
    assert.match(VS_AUTOGEN, /Last checked: 2026-04/, 'AutoGen page must include a last-checked date');
    // Docs home
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\//, 'Must link to AG2 docs home');
    // Group chat introduction
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/introduction\//, 'Must link to group chat intro');
    // Patterns
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/patterns/, 'Must link to patterns page');
    // Handoffs
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/handoffs/, 'Must link to handoffs page');
    // Guardrails
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/guardrails/, 'Must link to guardrails page');
    // Safeguards
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/group-chat\/safeguards/, 'Must link to safeguards page');
    // Human-in-the-loop
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/basic-concepts\/human-in-the-loop/, 'Must link to HITL page');
    // Swarm deprecation
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/user-guide\/advanced-concepts\/orchestration\/swarm\/deprecation/, 'Must link to swarm deprecation page');
    // AG-UI (beta)
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/beta\/ag-ui/, 'Must link to AG-UI beta page');
    // Telemetry (beta)
    assert.match(VS_AUTOGEN, /https:\/\/docs\.ag2\.ai\/latest\/docs\/beta\/telemetry/, 'Must link to telemetry beta page');
  });
});
