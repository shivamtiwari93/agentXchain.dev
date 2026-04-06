import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_ENTRY = read('cli/bin/agentxchain.js');
const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const MULTI_DOCS = read('website-v2/docs/multi-repo.mdx');

describe('multi resume discoverability', () => {
  it('AT-MR-REC-DISC-001: CLI registers multi resume', () => {
    assert.match(CLI_ENTRY, /\.command\('resume'\)/);
  });

  it('AT-MR-REC-DISC-002: root README mentions multi resume and removes ghost multi step flags', () => {
    assert.match(ROOT_README, /multi resume/);
    assert.doesNotMatch(ROOT_README, /multi step --repo/);
    assert.doesNotMatch(ROOT_README, /multi step --role/);
  });

  it('AT-MR-REC-DISC-003: cli README mentions multi resume and removes ghost multi step flags', () => {
    assert.match(CLI_README, /multi resume/);
    assert.doesNotMatch(CLI_README, /multi step --repo/);
    assert.doesNotMatch(CLI_README, /multi step --role/);
  });

  it('AT-MR-REC-DISC-004: quickstart and multi-repo docs mention multi resume as recovery', () => {
    assert.match(QUICKSTART, /multi resume/);
    assert.match(MULTI_DOCS, /multi resume/);
    assert.match(MULTI_DOCS, /blocked state/i);
  });
});
