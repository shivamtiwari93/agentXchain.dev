import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_ENTRY = read('cli/bin/agentxchain.js');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const README = read('README.md');
const MULTI_SESSION = read('website-v2/docs/multi-session.mdx');
const SPEC = read('.planning/CROSS_MACHINE_CONTINUITY_RESTORE_SPEC.md');

describe('restore docs contract', () => {
  it('registers restore with required --input in the CLI entrypoint', () => {
    const restoreBlock = CLI_ENTRY.match(/\.command\('restore'\)[\s\S]*?\.action\(restoreCommand\)/);
    assert.ok(restoreBlock, 'restore command block found');
    assert.match(restoreBlock[0], /--input <path>/);
  });

  it('documents restore in the CLI command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `restore` \| Migration \|/);
    assert.match(CLI_DOCS, /### `restore`/);
    assert.match(CLI_DOCS, /agentxchain restore --input <path>/);
    assert.match(CLI_DOCS, /same repo/i);
    assert.match(CLI_DOCS, /same git HEAD/i);
  });

  it('updates the multi-session guide with the cross-machine restore path and truthful boundary', () => {
    assert.match(MULTI_SESSION, /agentxchain export --output/);
    assert.match(MULTI_SESSION, /agentxchain restore --input/);
    assert.match(MULTI_SESSION, /same git HEAD/i);
    assert.match(MULTI_SESSION, /dirty source files outside the exported governed roots will block restore/i);
  });

  it('mentions restore in the repo front door', () => {
    assert.match(README, /agentxchain restore --input <path>/);
    assert.match(README, /cross-machine continuity/i);
  });
});

describe('restore spec contract', () => {
  it('ships a standalone spec with explicit acceptance tests', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /AT-XRESTORE-001/);
    assert.match(SPEC, /AT-XRESTORE-007/);
  });
});

