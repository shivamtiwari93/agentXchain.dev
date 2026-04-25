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

const VS_METAGPT = read('website-v2/docs/compare/vs-metagpt.mdx');
const SPEC = read('.planning/COMPARE_VS_METAGPT_SPEC.md');
const MATRIX = read('.planning/COMPETITIVE_POSITIONING_MATRIX.md');

describe('MetaGPT comparison claims', () => {
  it('AT-METAGPT-CLAIMS-001: acknowledges current MetaGPT specialist and hosted-product surfaces', () => {
    assert.match(VS_METAGPT, /Data Interpreter/i);
    assert.match(VS_METAGPT, /Researcher/i);
    assert.match(VS_METAGPT, /Atoms \(formerly MGX \/ MetaGPT X\)/);
  });

  it('AT-METAGPT-CLAIMS-002: acknowledges framework extensibility and scoped recovery', () => {
    assert.match(VS_METAGPT, /custom roles|custom-role APIs|custom teams/i);
    assert.match(VS_METAGPT, /Environment/i);
    assert.match(VS_METAGPT, /Serialization\/breakpoint recovery/i);
    assert.doesNotMatch(VS_METAGPT, /\| \*\*Agent roles\*\* \| Fixed: Product Manager, Architect, Engineer, QA \|/);
    assert.doesNotMatch(VS_METAGPT, /\| \*\*Human authority\*\* \| User provides the initial requirement \|/);
  });

  it('AT-METAGPT-CLAIMS-005: governance posture row exists', () => {
    assert.match(VS_METAGPT, /\| \*\*Governance posture\*\* \|/);
  });

  it('AT-METAGPT-CLAIMS-006: recovery posture row exists', () => {
    assert.match(VS_METAGPT, /\| \*\*Recovery posture\*\* \|/);
  });

  it('AT-METAGPT-CLAIMS-007: multi-repo posture row exists', () => {
    assert.match(VS_METAGPT, /\| \*\*Multi-repo posture\*\* \|/);
  });

  it('AT-METAGPT-CLAIMS-003: keeps research and hosted-product naming current', () => {
    assert.match(VS_METAGPT, /MetaGPT paper \(ICLR 2024\)/);
    assert.match(VS_METAGPT, /AFlow \(ICLR 2025 oral/);
    assert.doesNotMatch(VS_METAGPT, /ICLR 2025 oral paper and the DeepWisdom team/);
    assert.doesNotMatch(VS_METAGPT, /MGX at mgx\.dev/);
  });

  it('AT-METAGPT-CLAIMS-004: records the truth boundary in the spec and competitive matrix', () => {
    assert.match(SPEC, /# Spec: MetaGPT Comparison Claim Boundary/);
    assert.match(SPEC, /serialization \/ breakpoint recovery/i);
    assert.match(SPEC, /Atoms product \(formerly MGX \/ MetaGPT X\)/);
    assert.match(SPEC, /AT-METAGPT-CLAIMS-004/);

    assert.match(MATRIX, /\| \*\*MetaGPT\*\* \|/);
    assert.match(MATRIX, /customizable role\/team\/environment patterns|custom roles|Environment/i);
    assert.match(MATRIX, /Atoms/i);
  });

  it('AT-METAGPT-CLAIMS-005: public page exposes official source links and last-checked date', () => {
    assert.match(VS_METAGPT, /Source baseline/, 'page must have Source baseline section');
    assert.match(VS_METAGPT, /2026-04-25/, 'page must have last-checked date');
    // GitHub README
    assert.match(VS_METAGPT, /https:\/\/github\.com\/FoundationAgents\/MetaGPT/, 'must link to GitHub README');
    // Docs home
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\//, 'must link to docs home');
    // MultiAgent 101
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/tutorials\/multi_agent_101/, 'must link to MultiAgent 101');
    // Human engagement
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/tutorials\/human_engagement/, 'must link to human engagement docs');
    // Agent communication
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/in_depth_guides\/agent_communication/, 'must link to agent communication docs');
    // Breakpoint recovery
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/in_depth_guides\/breakpoint_recovery/, 'must link to breakpoint recovery docs');
    // Incremental development
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/in_depth_guides\/incremental_development/, 'must link to incremental development docs');
    // Data Interpreter
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/use_cases\/agent\/interpreter/, 'must link to Data Interpreter docs');
    // Researcher
    assert.match(VS_METAGPT, /https:\/\/docs\.deepwisdom\.ai\/main\/en\/guide\/use_cases\/agent\/researcher/, 'must link to Researcher docs');
    // Atoms
    assert.match(VS_METAGPT, /https:\/\/atoms\.dev\//, 'must link to Atoms hosted product');
    // Spec must reference the source-link acceptance test
    assert.match(SPEC, /AT-METAGPT-CLAIMS-005/, 'spec must reference AT-METAGPT-CLAIMS-005');
  });
});
