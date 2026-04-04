export const VITEST_INCLUDED_FILES = [
  // Pilot + Slice 1 (19 files)
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
  // Slice 2 (11 files, docs-content and read-only contract)
  'test/openai-positioning-content.test.js',
  'test/template-surface-content.test.js',
  'test/docs-dashboard-content.test.js',
  'test/plugin-docs-content.test.js',
  'test/why-page-content.test.js',
  'test/protocol-docs-content.test.js',
  'test/protocol-implementor-guide-content.test.js',
  'test/release-docs-content.test.js',
  'test/continuous-delivery-intake-content.test.js',
  'test/vitest-contract.test.js',
  'test/protocol-conformance-docs.test.js',
  // Slice 3 (6 files, coordinator suite)
  'test/coordinator-acceptance.test.js',
  'test/coordinator-config.test.js',
  'test/coordinator-dispatch.test.js',
  'test/coordinator-gates.test.js',
  'test/coordinator-recovery.test.js',
  'test/coordinator-state.test.js',
];

export const VITEST_FILE_COUNT = VITEST_INCLUDED_FILES.length;
export const VITEST_FILE_PARALLELISM = false;
