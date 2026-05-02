import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('CICD-SHRINK workflow footprint contract', () => {
  it('restricts CI to pull_request only', () => {
    const workflow = read('.github/workflows/ci.yml');

    assert.match(workflow, /^on:\n\s+pull_request:/m);
    assert.doesNotMatch(workflow, /^\s+push:/m);
  });

  it('keeps the removed ci-runner-proof workflow absent', () => {
    assert.equal(existsSync(resolve(ROOT, '.github/workflows/ci-runner-proof.yml')), false);
  });

  it('keeps governed todo proof on nightly schedule and manual dispatch only', () => {
    const workflow = read('.github/workflows/governed-todo-app-proof.yml');

    assert.doesNotMatch(workflow, /^\s+push:/m);
    assert.match(workflow, /schedule:\s*\n\s*-\s*cron: '0 7 \* \* \*'/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /branches:\s*\n\s*-\s*main/);
  });

  it('keeps GCS deploy scoped to website and docs changes', () => {
    const workflow = read('.github/workflows/deploy-gcs.yml');

    assert.match(workflow, /-\s*'website-v2\/\*\*'/);
    assert.match(workflow, /-\s*'docs\/\*\*'/);
    assert.match(workflow, /-\s*'\.github\/workflows\/deploy-gcs\.yml'/);
  });

  it('keeps CodeQL schedule/manual only', () => {
    const workflow = read('.github/workflows/codeql.yml');

    assert.match(workflow, /schedule:\s*\n\s*-\s*cron: '0 2 \* \* 0'/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s+push:/m);
    assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  });

  it('keeps VS Code publishing off npm release tags', () => {
    const workflow = read('.github/workflows/publish-vscode-on-tag.yml');

    assert.match(workflow, /-\s*'vsce-v\*\.\*\.\*'/);
    assert.doesNotMatch(workflow, /-\s*'v\*\.\*\.\*'/);
  });
});
