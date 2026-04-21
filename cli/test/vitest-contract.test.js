import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
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
    assert.equal(PACKAGE_JSON.scripts['test:beta'], 'node --test test/beta-tester-scenarios/*.test.js');
    assert.equal(PACKAGE_JSON.scripts['test:node'], 'node --test --test-timeout=60000 --test-concurrency=4 test/*.test.js test/beta-tester-scenarios/*.test.js');
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

describe('Test-surface hygiene — DEC-TEST-HYGIENE-001', () => {
  const TEST_DIR = join(__dirname);
  const entries = readdirSync(TEST_DIR, { withFileTypes: true });
  const allowedDirectories = new Set(['fixtures', 'beta-tester-scenarios']);

  it('cli/test/ contains only .test.js files and the shipped data/scenario directories', () => {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        assert.ok(allowedDirectories.has(entry.name),
          `Unexpected directory in cli/test/: ${entry.name} — support dirs belong in cli/test-support/`);
      } else {
        assert.ok(entry.name.endsWith('.test.js'),
          `Non-test file in cli/test/: ${entry.name} — support files belong in cli/test-support/`);
      }
    }
  });

  it('cli/test/beta-tester-scenarios/ contains only .test.js files and the _helpers/ directory', () => {
    const scenarioDir = join(TEST_DIR, 'beta-tester-scenarios');
    const scenarioEntries = readdirSync(scenarioDir, { withFileTypes: true });
    assert.ok(scenarioEntries.length > 0, 'beta-tester-scenarios/ should not be empty');
    for (const entry of scenarioEntries) {
      if (entry.isDirectory()) {
        assert.equal(entry.name, '_helpers',
          `Only _helpers/ subdirectory is allowed in beta-tester-scenarios/, found: ${entry.name}`);
        continue;
      }
      assert.ok(entry.name.endsWith('.test.js'),
        `Non-test file in beta-tester-scenarios/: ${entry.name}`);
    }
  });

  it('cli/test-support/ exists and contains only known support files', () => {
    const SUPPORT_DIR = join(__dirname, '..', 'test-support');
    const supportEntries = readdirSync(SUPPORT_DIR).sort();
    assert.ok(supportEntries.length > 0, 'test-support/ should not be empty');
    // Every support file must NOT be a .test.js (those belong in test/)
    for (const name of supportEntries) {
      assert.ok(!name.endsWith('.test.js'),
        `Test file ${name} found in cli/test-support/ — test files belong in cli/test/`);
    }
  });

  it('test/fixtures/ contains no executable .js or .mjs files that node --test could discover', () => {
    const FIXTURES_DIR = join(TEST_DIR, 'fixtures');
    const fixtureFiles = readdirSync(FIXTURES_DIR, { recursive: true })
      .filter(f => typeof f === 'string');
    const executableFixtures = fixtureFiles.filter(f =>
      f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')
    );
    assert.deepStrictEqual(executableFixtures, [],
      `Executable files in test/fixtures/ risk node --test discovery: ${executableFixtures.join(', ')}`);
  });
});
