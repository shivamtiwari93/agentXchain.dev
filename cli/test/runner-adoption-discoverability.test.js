import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(CLI_ROOT, 'README.md'), 'utf8');
const STARTER_README = readFileSync(
  join(REPO_ROOT, 'examples', 'external-runner-starter', 'README.md'),
  'utf8',
);
const CI_PROOF_README = readFileSync(
  join(REPO_ROOT, 'examples', 'ci-runner-proof', 'README.md'),
  'utf8',
);

describe('Runner adoption discoverability', () => {
  it('AT-DISCOVER-001: root README examples table surfaces runner adoption examples', () => {
    assert.match(
      ROOT_README,
      /external-runner-starter/,
      'root README Examples table must mention external-runner-starter',
    );
    assert.match(
      ROOT_README,
      /ci-runner-proof/,
      'root README Examples table must mention ci-runner-proof',
    );
  });

  it('AT-DISCOVER-002: root README links to build-your-own-runner docs', () => {
    assert.match(
      ROOT_README,
      /build-your-own-runner/,
      'root README must link to build-your-own-runner docs',
    );
  });

  it('AT-DISCOVER-003: cli README links to build-your-own-runner docs', () => {
    assert.match(
      CLI_README,
      /build-your-own-runner/,
      'cli README must link to build-your-own-runner docs',
    );
  });

  it('AT-DISCOVER-004: external-runner-starter README states Node.js version requirement', () => {
    assert.match(
      STARTER_README,
      /Node\.js\s*>=?\s*18/,
      'external-runner-starter README must state Node.js version requirement',
    );
  });

  it('AT-DISCOVER-005: external-runner-starter README imports from package export path', () => {
    assert.match(
      STARTER_README,
      /agentxchain\/runner-interface/,
      'starter README must reference the package export path',
    );
  });

  it('AT-DISCOVER-006: ci-runner-proof README links to external-runner-starter for external consumers', () => {
    assert.match(
      CI_PROOF_README,
      /external-runner-starter/,
      'ci-runner-proof README must direct external consumers to the external-runner-starter',
    );
  });

  it('AT-DISCOVER-007: cli README lists all five shipped runtime types', () => {
    const runtimeSection = CLI_README.substring(
      CLI_README.indexOf('### Runtime support today'),
    );
    assert.match(runtimeSection, /manual/, 'cli README must list manual runtime');
    assert.match(runtimeSection, /local_cli/, 'cli README must list local_cli runtime');
    assert.match(runtimeSection, /mcp/, 'cli README must list mcp runtime');
    assert.match(runtimeSection, /api_proxy/, 'cli README must list api_proxy runtime');
    assert.match(runtimeSection, /remote_agent/, 'cli README must list remote_agent runtime');
  });
});
