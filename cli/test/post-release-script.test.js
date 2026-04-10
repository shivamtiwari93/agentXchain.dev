import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = readFileSync(join(REPO_ROOT, 'marketing', 'post-release.sh'), 'utf8');

describe('marketing release post script', () => {
  it('uses hyphenated docs release routes instead of dotted semver', () => {
    assert.ok(SCRIPT.includes('DOCS_VERSION="${VERSION//./-}"'));
    assert.ok(SCRIPT.includes('RELEASE_URL="https://agentxchain.dev/docs/releases/${DOCS_VERSION}"'));
    assert.ok(!SCRIPT.includes('docs/releases/${VERSION}'));
  });
});
