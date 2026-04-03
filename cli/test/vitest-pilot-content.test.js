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
const VITEST_EXPANSION_S1_SPEC = read('.planning/VITEST_EXPANSION_S1_SPEC.md');
const VITEST_EXPANSION_S2_SPEC = read('.planning/VITEST_EXPANSION_S2_SPEC.md');

const VITEST_INCLUDED_FILES = [
  // ── Pilot + Slice 1 (19 files) ──
  'test/token-counter.test.js',
  'test/token-budget.test.js',
  'test/context-compressor.test.js',
  'test/dashboard-app.test.js',
  'test/dashboard-evidence-drilldown.test.js',
  'test/dashboard-views.test.js',
  'test/verify-command.test.js',
  'test/api-proxy-adapter.test.js',
  'test/dashboard-bridge.test.js',
  'test/gate-evaluator.test.js',
  'test/dispatch-bundle.test.js',
  'test/step-command.test.js',
  'test/local-cli-adapter.test.js',
  'test/run-completion.test.js',
  'test/dispatch-manifest.test.js',
  'test/normalized-config.test.js',
  'test/schema.test.js',
  'test/safe-write.test.js',
  'test/turn-result-validator.test.js',
  // ── Slice 2 (11 files, docs-content & read-only contract) ──
  'test/openai-positioning-content.test.js',
  'test/template-surface-content.test.js',
  'test/docs-dashboard-content.test.js',
  'test/plugin-docs-content.test.js',
  'test/why-page-content.test.js',
  'test/protocol-docs-content.test.js',
  'test/protocol-implementor-guide-content.test.js',
  'test/release-docs-content.test.js',
  'test/continuous-delivery-intake-content.test.js',
  'test/vitest-pilot-content.test.js',
  'test/protocol-conformance-docs.test.js',
];

describe('Vitest coverage contract', () => {
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

  it('guards the node:test alias, serial file execution, and explicit include list', () => {
    assert.match(VITEST_CONFIG, /vitest-node-test-shim\.js/);
    assert.match(VITEST_CONFIG, /fileParallelism:\s*false/);
    for (const file of VITEST_INCLUDED_FILES) {
      assert.match(VITEST_CONFIG, new RegExp(file.replaceAll('.', '\\.')));
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
  });

  it('keeps child_process out of every Vitest-included file', () => {
    for (const file of VITEST_INCLUDED_FILES) {
      const source = read(`cli/${file}`);
      assert.doesNotMatch(source, /from ['"](?:node:)?child_process['"]/);
    }
  });
});
