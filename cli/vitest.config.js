import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Keep file-level execution serial until all fixed-path temp-dir tests are migrated.
    fileParallelism: false,
    testTimeout: 60000,
  },
});
