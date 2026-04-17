import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const QUICKSTART_DOCS = read('website-v2/docs/quickstart.mdx');
const CI_WORKFLOW = read('.github/workflows/ci.yml');
const CLI_DOC_SPEC = read('.planning/CLI_DOC_PAGE_SPEC.md');

describe('Protocol conformance public surface', () => {
  it('documents conformance check as the preferred front door in both READMEs', () => {
    assert.match(ROOT_README, /conformance check/);
    assert.match(CLI_README, /conformance check/);
  });

  it('preserves verify protocol compatibility language in both READMEs', () => {
    assert.match(ROOT_README, /verify protocol/);
    assert.match(CLI_README, /verify protocol/);
  });

  it('documents verify protocol in the Docusaurus docs surface', () => {
    assert.match(CLI_DOCS, /conformance check/);
    assert.match(CLI_DOCS, /verify protocol/);
    assert.match(CLI_DOCS, /capabilities\.json/);
    assert.match(CLI_DOCS, /stdio-fixture-v1/);
    assert.match(QUICKSTART_DOCS, /verify protocol/);
  });

  it('keeps the CLI docs spec aligned with conformance documentation', () => {
    assert.match(CLI_DOC_SPEC, /conformance check/);
    assert.match(CLI_DOC_SPEC, /verify protocol/);
    assert.match(CLI_DOC_SPEC, /tier, surface, target, and JSON-report semantics/i);
  });
});

describe('Protocol conformance CI enforcement', () => {
  it('runs tier 3 conformance in CI', () => {
    assert.match(CI_WORKFLOW, /verify protocol --tier 3 --target \.\./);
  });
});
