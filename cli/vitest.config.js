import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import {
  VITEST_FILE_PARALLELISM,
  VITEST_INCLUDED_FILES,
} from './test/vitest-slice-manifest.js';

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
    include: VITEST_INCLUDED_FILES,
    // Keep file-level execution serial until all fixed-path temp-dir tests are migrated.
    fileParallelism: VITEST_FILE_PARALLELISM,
    testTimeout: 10000,
  },
});
