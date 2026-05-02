import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const listTestFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const absolute = join(dir, entry.name);
  if (entry.isDirectory()) return listTestFiles(absolute);
  return entry.isFile() && entry.name.endsWith('.test.js') ? [absolute] : [];
});

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const PACKAGE_JSON = JSON.parse(read('cli/package.json'));
const VITEST_CONFIG = read('cli/vitest.config.js');
const MIGRATION_SCRIPT = read('cli/scripts/migrate-node-test-to-vitest.mjs');
const TEST_FILES = listTestFiles(join(__dirname));

describe('Vitest coverage contract', () => {
  it('documents the single-runner Vitest workflow in both READMEs', () => {
    for (const readme of [ROOT_README, CLI_README]) {
      assert.match(readme, /npm test/);
      assert.match(readme, /npm run test:watch/);
      assert.match(readme, /Vitest/i);
      assert.doesNotMatch(readme, /npm run test:vitest/);
      assert.doesNotMatch(readme, /npm run test:node/);
      assert.doesNotMatch(readme, /36-file/i);
    }
  });

  it('keeps the package scripts aligned with the shipped Vitest contract', () => {
    assert.equal(PACKAGE_JSON.scripts.test, 'vitest run --reporter=verbose');
    assert.equal(PACKAGE_JSON.scripts['test:watch'], 'vitest --reporter=verbose');
    assert.equal(PACKAGE_JSON.scripts['test:vitest'], undefined);
    assert.equal(PACKAGE_JSON.scripts['test:node'], undefined);
    assert.equal(PACKAGE_JSON.scripts['test:beta'], undefined);
  });

  it('uses a full-suite Vitest glob with serial file execution and 60s timeout', () => {
    assert.match(VITEST_CONFIG, /include:\s*\[\s*['"]test\/\*\*\/\*\.test\.js['"]\s*\]/);
    assert.match(VITEST_CONFIG, /fileParallelism:\s*false/);
    assert.match(VITEST_CONFIG, /testTimeout:\s*60000/);
    assert.doesNotMatch(VITEST_CONFIG, /node:test/);
    assert.doesNotMatch(VITEST_CONFIG, /vitest-node-test-shim/);
    assert.doesNotMatch(VITEST_CONFIG, /vitest-slice-manifest/);
  });

  it('keeps all CLI tests on native Vitest imports', () => {
    assert.equal(TEST_FILES.length, 664);
    for (const file of TEST_FILES) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /^import\s+.*from ['"]node:test['"]/m);
    }
  });

  it('keeps obsolete Vitest migration support files deleted', () => {
    const supportEntries = readdirSync(join(__dirname, '..', 'test-support')).sort();
    assert.ok(!supportEntries.includes('vitest-node-test-shim.js'));
    assert.ok(!supportEntries.includes('vitest-slice-manifest.js'));
  });

  it('keeps the migration codemod checked in for reproducibility', () => {
    assert.equal(existsSync(join(REPO_ROOT, 'cli/scripts/migrate-node-test-to-vitest.mjs')), true);
    assert.match(MIGRATION_SCRIPT, /node:test/);
    assert.match(MIGRATION_SCRIPT, /from 'vitest'/);
    assert.match(MIGRATION_SCRIPT, /beforeAll/);
    assert.match(MIGRATION_SCRIPT, /afterAll/);
  });

  it('migrates single-quoted and double-quoted node:test imports reproducibly', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-vitest-migration-'));
    try {
      const first = join(root, 'single.test.js');
      const second = join(root, 'double.test.js');
      writeFileSync(first, "import { before, after, describe, it } from 'node:test';\nbefore(() => {});\nafter(() => {});\ndescribe('single', () => { it('passes', () => {}); });\n");
      writeFileSync(second, 'import test from "node:test";\ntest("double", () => {});\n');

      execFileSync('node', [join(REPO_ROOT, 'cli/scripts/migrate-node-test-to-vitest.mjs'), root], {
        cwd: REPO_ROOT,
      });

      assert.equal(
        readFileSync(first, 'utf8'),
        "import { beforeAll, afterAll, describe, it } from 'vitest';\nbeforeAll(() => {});\nafterAll(() => {});\ndescribe('single', () => { it('passes', () => {}); });\n",
      );
      assert.equal(
        readFileSync(second, 'utf8'),
        "import { test } from 'vitest';\ntest(\"double\", () => {});\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
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
