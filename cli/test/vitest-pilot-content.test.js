import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const PACKAGE_JSON = JSON.parse(read('cli/package.json'));
const VITEST_CONFIG = read('cli/vitest.config.js');
const VITEST_SPEC = read('.planning/VITEST_PILOT_SPEC.md');

const PILOT_FILES = [
  'test/token-counter.test.js',
  'test/token-budget.test.js',
  'test/context-compressor.test.js',
  'test/dashboard-app.test.js',
  'test/dashboard-evidence-drilldown.test.js',
  'test/dashboard-views.test.js',
  'test/verify-command.test.js',
];

describe('Vitest pilot contract', () => {
  it('documents the dual-runner workflow in both READMEs', () => {
    for (const readme of [ROOT_README, CLI_README]) {
      assert.match(readme, /npm run test:vitest/);
      assert.match(readme, /npm run test:node/);
      assert.match(readme, /npm test/);
      assert.match(readme, /Vitest/i);
      assert.match(readme, /node --test/);
    }
  });

  it('keeps the package scripts aligned with the shipped pilot', () => {
    assert.equal(PACKAGE_JSON.scripts['test:vitest'], 'vitest run --reporter=verbose');
    assert.equal(PACKAGE_JSON.scripts['test:node'], 'node --test test/*.test.js');
    assert.equal(PACKAGE_JSON.scripts.test, 'npm run test:vitest && npm run test:node');
  });

  it('guards the node:test alias and explicit pilot include list', () => {
    assert.match(VITEST_CONFIG, /'node:test': 'vitest'/);
    for (const file of PILOT_FILES) {
      assert.match(VITEST_CONFIG, new RegExp(file.replaceAll('.', '\\.')));
    }
  });

  it('keeps the shipped spec aligned with dashboard-module eligibility and dual execution', () => {
    assert.match(VITEST_SPEC, /\.\.\/dashboard\//);
    assert.match(VITEST_SPEC, /both runners exercise the same files/i);
    assert.match(VITEST_SPEC, /DEC-VITEST-006/);
  });
});
