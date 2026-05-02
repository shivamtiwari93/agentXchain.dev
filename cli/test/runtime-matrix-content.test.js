import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const MATRIX = read('website-v2/docs/runtime-matrix.mdx');
const README = read('README.md');
const ADAPTERS = read('website-v2/docs/adapters.mdx');
const GETTING_STARTED = read('website-v2/docs/getting-started.mdx');
const INTEGRATION_GUIDE = read('website-v2/docs/integration-guide.mdx');
const CLI = read('website-v2/docs/cli.mdx');
const RECOVERY = read('website-v2/docs/recovery.mdx');

describe('runtime matrix content contract', () => {
  // All 5 runtimes documented
  for (const rt of ['manual', 'local_cli', 'api_proxy', 'mcp', 'remote_agent']) {
    it(`documents runtime: ${rt}`, () => {
      assert.match(MATRIX, new RegExp(`\`${rt}\``));
    });
  }

  // All 3 authority levels documented
  for (const auth of ['authoritative', 'proposed', 'review_only']) {
    it(`documents authority: ${auth}`, () => {
      assert.match(MATRIX, new RegExp(`\`${auth}\``));
    });
  }

  // Invalid combinations are documented
  it('documents review_only + local_cli as invalid', () => {
    assert.match(MATRIX, /review_only.*local_cli.*[Ii]nvalid|Invalid.*review_only.*local_cli/s);
  });

  it('documents authoritative + api_proxy as invalid', () => {
    assert.match(MATRIX, /authoritative.*api_proxy.*[Ii]nvalid|Invalid.*authoritative.*api_proxy/s);
  });

  it('documents authoritative + remote_agent as invalid', () => {
    assert.match(MATRIX, /authoritative.*remote_agent/s);
  });

  // Binding matrix table exists
  it('has a binding matrix table', () => {
    assert.match(MATRIX, /Binding Matrix/i);
  });

  // Common patterns section
  it('includes common config patterns', () => {
    assert.match(MATRIX, /Common Patterns/i);
    assert.match(MATRIX, /All-manual/i);
    assert.match(MATRIX, /Mixed-mode/i);
  });

  // Validation section
  it('references validate and doctor commands', () => {
    assert.match(MATRIX, /agentxchain validate/);
    assert.match(MATRIX, /agentxchain doctor/);
  });

  // Links to related pages
  it('links to adapters page', () => {
    assert.match(MATRIX, /\/docs\/adapters/);
  });

  it('links to recovery page', () => {
    assert.match(MATRIX, /\/docs\/recovery/);
  });
});

describe('runtime matrix cross-references', () => {
  it('README links to runtime matrix', () => {
    assert.match(README, /runtime-matrix|Runtime Matrix/i);
  });

  it('adapters.mdx links to runtime matrix', () => {
    assert.match(ADAPTERS, /runtime-matrix|Runtime Matrix/i);
  });

  it('getting-started.mdx links to runtime matrix', () => {
    assert.match(GETTING_STARTED, /runtime-matrix|Runtime Matrix/i);
  });

  it('integration-guide.mdx links to runtime matrix', () => {
    assert.match(INTEGRATION_GUIDE, /runtime-matrix|Runtime Matrix/i);
  });

  it('cli.mdx documents reissue-turn', () => {
    assert.match(CLI, /reissue-turn/);
  });

  it('recovery.mdx documents post-dispatch drift and reissue-turn', () => {
    assert.match(RECOVERY, /reissue-turn/);
    assert.match(RECOVERY, /Post-Dispatch Drift|post-dispatch drift/i);
  });
});
