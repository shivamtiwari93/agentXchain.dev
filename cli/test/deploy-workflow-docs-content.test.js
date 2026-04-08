import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('deploy workflow docs truthfulness', () => {
  const humanTasks = read('.planning/HUMAN_TASKS.md');
  const gcsSpec = read('.planning/GCS_DEPLOY_AUTH_SPEC.md');
  const gcsWorkflow = read('.github/workflows/deploy-gcs.yml');

  it('keeps HUMAN_TASKS.md truthful about the single active website deploy path', () => {
    assert.match(humanTasks, /retired on 2026-04-08/i);
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

  it('matches the real workflow trigger and build output path', () => {
    assert.match(gcsWorkflow, /workflow_dispatch:/);
    assert.match(gcsWorkflow, /-\s*'website-v2\/\*\*'/);
    assert.match(gcsWorkflow, /website-v2\/build\//);
  });

  it('keeps the clear auth fallback and explicit failure mode in the workflow', () => {
    assert.match(gcsWorkflow, /GCP_WORKLOAD_IDENTITY_PROVIDER/);
    assert.match(gcsWorkflow, /GCP_SERVICE_ACCOUNT/);
    assert.match(gcsWorkflow, /GCP_SERVICE_ACCOUNT_KEY_JSON/);
    assert.match(gcsWorkflow, /Fail when no GCP auth is configured/);
    assert.match(gcsWorkflow, /workload_identity_provider:/);
    assert.match(gcsWorkflow, /credentials_json:/);
  });

  it('does not keep a dead GitHub Pages deploy workflow around', () => {
    assert.equal(existsSync(resolve(ROOT, '.github/workflows/deploy-pages.yml')), false);
  });
});
