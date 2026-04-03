import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Redirect node:test imports to a vitest-backed shim so files work with both runners.
      // Under `node --test`, the real node:test module is used.
      // Under vitest, the shim maps describe/it plus before/after semantics correctly.
      'node:test': fileURLToPath(
        new URL('./test/vitest-node-test-shim.js', import.meta.url),
      ),
    },
  },
  test: {
    include: [
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
    ],
    // Keep file-level execution serial until all fixed-path temp-dir tests are migrated.
    fileParallelism: false,
    testTimeout: 10000,
  },
});
