import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VITEST_FILE_COUNT,
  VITEST_INCLUDED_FILES,
  VITEST_FILE_PARALLELISM,
} from '../test-support/vitest-slice-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const PACKAGE_JSON = JSON.parse(read('cli/package.json'));
const VITEST_CONFIG = read('cli/vitest.config.js');
const VITEST_MANIFEST = read('cli/test-support/vitest-slice-manifest.js');
const VITEST_SPEC = read('.planning/VITEST_PILOT_SPEC.md');
const VITEST_EXPANSION_S1_SPEC = read('.planning/VITEST_EXPANSION_S1_SPEC.md');
const VITEST_EXPANSION_S2_SPEC = read('.planning/VITEST_EXPANSION_S2_SPEC.md');
const VITEST_EXPANSION_S3_SPEC = read('.planning/VITEST_EXPANSION_S3_SPEC.md');
const VITEST_STEADY_STATE_SPEC = read('.planning/VITEST_STEADY_STATE_SPEC.md');

describe('Vitest coverage contract', () => {
  it('documents the dual-runner workflow in both READMEs', () => {
    for (const readme of [ROOT_README, CLI_README]) {
      assert.match(readme, /npm run test:vitest/);
      assert.match(readme, /npm run test:node/);
      assert.match(readme, /npm test/);
      assert.match(readme, /Vitest/i);
      assert.match(readme, /node --test/);
      assert.match(readme, new RegExp(`${VITEST_FILE_COUNT}-file`));
      assert.doesNotMatch(readme, /7 (?:pilot )?files/i);
    }
  });

  it('keeps the package scripts aligned with the shipped Vitest contract', () => {
    assert.equal(PACKAGE_JSON.scripts['test:vitest'], 'vitest run --reporter=verbose');
    assert.equal(PACKAGE_JSON.scripts['test:node'], 'node --test test/*.test.js');
    assert.equal(PACKAGE_JSON.scripts.test, 'npm run test:vitest && npm run test:node');
  });

  it('guards the node:test alias, serial file execution, and explicit include list', () => {
    assert.match(VITEST_CONFIG, /vitest-node-test-shim\.js/);
    assert.match(VITEST_CONFIG, /from '\.\/test-support\/vitest-slice-manifest\.js'/);
    assert.match(VITEST_CONFIG, /include:\s*VITEST_INCLUDED_FILES/);
    assert.match(VITEST_CONFIG, /fileParallelism:\s*VITEST_FILE_PARALLELISM/);
    assert.equal(VITEST_FILE_PARALLELISM, false);
    for (const file of VITEST_INCLUDED_FILES) {
      assert.match(VITEST_MANIFEST, new RegExp(file.replaceAll('.', '\\.')));
    }
  });

  it('keeps the shipped specs aligned with dashboard-module eligibility and slice coexistence', () => {
    assert.match(VITEST_SPEC, /\.\.\/dashboard\//);
    assert.match(VITEST_SPEC, /both runners exercise the same files/i);
    assert.match(VITEST_SPEC, /DEC-VITEST-006/);
    assert.match(VITEST_EXPANSION_S1_SPEC, /Status:\s+\*\*shipped\*\*/);
    assert.match(VITEST_EXPANSION_S1_SPEC, /fileParallelism:\s*false/);
    assert.match(VITEST_EXPANSION_S1_SPEC, /Duplicate execution:\s+YES/i);
    assert.match(VITEST_EXPANSION_S2_SPEC, /read-only/i);
    assert.match(VITEST_EXPANSION_S2_SPEC, /Duplicate execution:\s+YES/i);
    assert.match(VITEST_EXPANSION_S3_SPEC, /coordinator/i);
    assert.match(VITEST_EXPANSION_S3_SPEC, /Duplicate execution remains in force/i);
    assert.match(VITEST_EXPANSION_S3_SPEC, /Status:\s+\*\*shipped\*\*/);
    assert.match(VITEST_STEADY_STATE_SPEC, /Status:\s+\*\*shipped\*\*/);
    assert.match(VITEST_STEADY_STATE_SPEC, /36 files/);
    assert.match(VITEST_STEADY_STATE_SPEC, /No Slice 4 ships until a dedicated subprocess\/E2E strategy spec exists/i);
    assert.match(VITEST_STEADY_STATE_SPEC, /vitest-contract\.test\.js/);
  });

  it('keeps child_process out of every Vitest-included file', () => {
    for (const file of VITEST_INCLUDED_FILES) {
      const source = read(`cli/${file}`);
      assert.doesNotMatch(source, /from ['"](?:node:)?child_process['"]/);
    }
  });
});
