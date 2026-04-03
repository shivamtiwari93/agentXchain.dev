import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('release operations docs', () => {
  const brief = read('.planning/RELEASE_BRIEF.md');
  const humanTasks = read('.planning/HUMAN_TASKS.md');
  const cutSpec = read('.planning/RELEASE_CUT_SPEC.md');
  const postflightSpec = read('.planning/RELEASE_POSTFLIGHT_SPEC.md');
  const workflowSpec = read('.planning/GITHUB_NPM_PUBLISH_WORKFLOW_SPEC.md');
  const workflow = read('.github/workflows/publish-npm-on-tag.yml');

  it('tracks the active corrective release as v2.0.1', () => {
    assert.match(brief, /Release Brief — AgentXchain v2\.0\.1/);
    assert.match(brief, /`?v2\.0\.1`? is the active release identity/);
    assert.match(humanTasks, /v2\.0\.1/);
  });

  it('removes stale v1.0.0 and v1.1.0 release-cut instructions from active docs', () => {
    assert.doesNotMatch(brief, /npm version 1\.0\.0/);
    assert.doesNotMatch(brief, /v1\.1\.0/);
    assert.doesNotMatch(humanTasks, /git push origin v1\.0\.0/);
    assert.doesNotMatch(humanTasks, /npm version 1\.0\.0/);
  });

  it('requires postflight verification before the release is called complete', () => {
    assert.match(brief, /release-postflight\.sh --target-version 2\.0\.1/);
    assert.match(brief, /npm exec --yes --package agentxchain@2\.0\.1 -- agentxchain --version/);
    assert.match(cutSpec, /release-postflight\.sh --target-version <version>/);
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
