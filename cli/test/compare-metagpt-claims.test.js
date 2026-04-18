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
    assert.doesNotMatch(VS_METAGPT, /\| \*\*Recovery\*\* \| Restart the pipeline \|/);
  });

  it('AT-METAGPT-CLAIMS-003: keeps research and hosted-product naming current', () => {
    assert.match(VS_METAGPT, /MetaGPT paper \(ICLR 2024\)/);
    assert.match(VS_METAGPT, /AFlow \(ICLR 2025 oral\)/);
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
});
