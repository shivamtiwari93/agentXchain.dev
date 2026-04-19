import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function readSpec(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('recent shipped specs stay marked shipped', () => {
  const shippedSpecs = [
    '.planning/BUG_46_VERIFICATION_PRODUCED_FILES_SPEC.md',
    '.planning/AUTHORITATIVE_LOCAL_CLI_ROLE_PROOF_SPEC.md',
    '.planning/RUN_EXPORT_ROOT_CENTRALIZATION_SPEC.md',
    '.planning/FRAMEWORK_PATH_CLASSIFICATION_SPEC.md',
  ];

  for (const specPath of shippedSpecs) {
    it(`${specPath} is marked shipped`, () => {
      const content = readSpec(specPath);
      assert.match(content, /\*\*Status:\*\*\s*shipped/i);
      assert.doesNotMatch(
        content,
        /\*\*Status:\*\*\s*(proposed|draft|in.progress)/i,
        `${specPath} still claims proposed/draft/in-progress status`,
      );
    });
  }
});
