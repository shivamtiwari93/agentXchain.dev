import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('deploy workflow docs truthfulness', () => {
  const humanTasks = read('.planning/HUMAN_TASKS.md');
  const gcsSpec = read('.planning/GCS_DEPLOY_AUTH_SPEC.md');
  const gcsWorkflow = read('.github/workflows/deploy-gcs.yml');
  const pagesWorkflow = read('.github/workflows/deploy-pages.yml');

  it('keeps HUMAN_TASKS.md truthful about the GitHub Pages build source', () => {
    assert.match(humanTasks, /website-v2\/build\//);
    assert.match(humanTasks, /website-v2\/\*\*/);
    assert.match(humanTasks, /workflow_dispatch/);
    assert.doesNotMatch(humanTasks, /deploys `website\/`/);
  });

  it('keeps the GCS auth spec aligned with the shipped workflow contract', () => {
    assert.match(gcsSpec, /working GitHub Actions deployment path/i);
    assert.match(gcsSpec, /\.github\/workflows\/deploy-gcs\.yml/);
    assert.match(gcsSpec, /website-v2\/build\//);
    assert.match(gcsSpec, /Workload Identity Federation/);
    assert.match(gcsSpec, /GCP_SERVICE_ACCOUNT_KEY/);
    assert.doesNotMatch(gcsSpec, /repo-owned deploy path is broken/i);
    assert.doesNotMatch(gcsSpec, /Every recent `deploy-gcs\.yml` run failed/i);
  });

  it('matches the real workflow triggers and build output paths', () => {
    assert.match(gcsWorkflow, /workflow_dispatch:/);
    assert.match(pagesWorkflow, /workflow_dispatch:/);
    assert.match(gcsWorkflow, /-\s*'website-v2\/\*\*'/);
    assert.match(pagesWorkflow, /-\s*'website-v2\/\*\*'/);
    assert.match(gcsWorkflow, /website-v2\/build\//);
    assert.match(pagesWorkflow, /path: website-v2\/build\//);
  });

  it('keeps the clear auth fallback and explicit failure mode in the workflow', () => {
    assert.match(gcsWorkflow, /GCP_WORKLOAD_IDENTITY_PROVIDER/);
    assert.match(gcsWorkflow, /GCP_SERVICE_ACCOUNT/);
    assert.match(gcsWorkflow, /GCP_SERVICE_ACCOUNT_KEY_JSON/);
    assert.match(gcsWorkflow, /Fail when no GCP auth is configured/);
    assert.match(gcsWorkflow, /workload_identity_provider:/);
    assert.match(gcsWorkflow, /credentials_json:/);
  });
});
