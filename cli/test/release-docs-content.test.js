import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('release operations docs', () => {
  const brief = read('.planning/RELEASE_BRIEF.md');
  const humanTasks = read('.planning/HUMAN_TASKS.md');
  const postflightSpec = read('.planning/RELEASE_POSTFLIGHT_SPEC.md');
  const workflowSpec = read('.planning/GITHUB_NPM_PUBLISH_WORKFLOW_SPEC.md');
  const workflow = read('.github/workflows/publish-npm-on-tag.yml');

  it('tracks a current release target, not stale v1.x versions', () => {
    assert.match(brief, /Release Brief — AgentXchain v2\.\d+\.\d+/);
    assert.doesNotMatch(brief, /npm version 1\.0\.0/);
    assert.doesNotMatch(brief, /npm version 1\.1\.0/);
    assert.match(humanTasks, /v2\.0\.1/);
  });

  it('requires postflight verification before the release is called complete', () => {
    assert.match(brief, /release-postflight\.sh --target-version/);
    assert.match(postflightSpec, /Install smoke/);
  });

  it('keeps GitHub release and Homebrew follow-through gated on registry truth', () => {
    assert.match(humanTasks, /after npm postflight passes/);
    assert.match(brief, /GitHub release notes are published against the real artifact/);
  });

  it('documents and automates postflight as part of the publish workflow', () => {
    assert.match(workflow, /Publish tagged release/);
    assert.match(workflow, /Verify published artifact/);
    assert.match(workflow, /bash scripts\/release-postflight\.sh --target-version "\$\{RELEASE_TAG#v\}"/);
    assert.match(workflowSpec, /workflow must run `scripts\/release-postflight\.sh --target-version <semver>`/);
    assert.match(postflightSpec, /RELEASE_POSTFLIGHT_RETRY_ATTEMPTS/);
  });
});
