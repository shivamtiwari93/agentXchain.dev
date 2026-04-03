import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Redirect node:test imports to vitest so files work with both runners.
      // Under `node --test`, the real node:test module is used.
      // Under vitest, this alias maps describe/it/before/after to vitest equivalents.
      'node:test': 'vitest',
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
    ],
    testTimeout: 10000,
  },
});
