import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('website deploy readme contract', () => {
  const readme = read('website-v2/README.md');
  const runAgents = read('run-agents.sh');
  const gcsWorkflow = read('.github/workflows/deploy-gcs.yml');

  it('documents the canonical GCS deploy workflow only', () => {
    assert.match(readme, /\.github\/workflows\/deploy-gcs\.yml/);
    assert.match(readme, /canonical production deploy/i);
    assert.doesNotMatch(readme, /\.github\/workflows\/deploy-pages\.yml/);
  });

  it('documents the real workflow trigger modes', () => {
    assert.match(readme, /pushes to `main` that change `website-v2\/\*\*` or `docs\/\*\*`/);
    assert.match(readme, /manual `workflow_dispatch`/);
    assert.match(gcsWorkflow, /workflow_dispatch:/);
    assert.match(gcsWorkflow, /branches:\s*\n\s*-\s*main/);
  });

  it('does not point operators at the removed deploy-websites helper', () => {
    assert.doesNotMatch(readme, /deploy-websites\.sh/);
  });

  it('keeps run-agents deployment instructions aligned to the workflow contract', () => {
    assert.match(runAgents, /\.github\/workflows\/deploy-gcs\.yml/);
    assert.match(runAgents, /gh workflow run|workflow_dispatch/);
    assert.doesNotMatch(runAgents, /\.github\/workflows\/deploy-pages\.yml/);
    assert.doesNotMatch(runAgents, /deploy-websites\.sh/);
  });

  it('removes the retired GitHub Pages workflow from the repo', () => {
    assert.equal(existsSync(resolve(ROOT, '.github/workflows/deploy-pages.yml')), false);
  });
});
