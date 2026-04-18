import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'website-v2', 'docs');
const pkg = JSON.parse(readFileSync(join(ROOT, 'cli', 'package.json'), 'utf8'));
const CURRENT_VERSION = pkg.version;
const REQUIRED_TOKENS = [
  '## Prerequisites',
  `Minimum CLI version: \`agentxchain ${CURRENT_VERSION}\` or newer`,
  'agentxchain --version',
  'npm install -g agentxchain@latest',
  'brew upgrade agentxchain',
  'npx --yes -p agentxchain@latest -c "agentxchain <command>"',
];

describe('onboarding CLI-version prerequisites content', () => {
  for (const page of ['getting-started.mdx', 'quickstart.mdx', 'five-minute-tutorial.mdx']) {
    it(`documents the prerequisites block on ${page}`, () => {
      const content = readFileSync(join(DOCS, page), 'utf8');
      for (const token of REQUIRED_TOKENS) {
        assert.ok(content.includes(token), `${page} must include: ${token}`);
      }
    });
  }
});
