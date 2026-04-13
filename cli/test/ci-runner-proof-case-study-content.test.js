import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const DOC_PATH = join(REPO_ROOT, 'website-v2', 'docs', 'examples', 'ci-runner-proof.mdx');
const README_PATH = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'README.md');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'CI_RUNNER_CASE_STUDY_SPEC.md');

function read(path) {
  return readFileSync(path, 'utf8');
}

describe('CI runner proof case study docs', () => {
  it('AT-CIRCS-001: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'CI_RUNNER_CASE_STUDY_SPEC.md must exist');
  });

  it('AT-CIRCS-002: docs page includes the fresh governed CLI run section', () => {
    const page = read(DOC_PATH);
    assert.match(page, /## Fresh Governed CLI Run/);
    assert.match(page, /2026-04-13/);
    assert.match(page, /AgentXchain v2\.83\.0/);
  });

  it('AT-CIRCS-003: docs page records the executed proof command and evidence fields', () => {
    const page = read(DOC_PATH);
    assert.match(page, /node examples\/ci-runner-proof\/run-via-cli-auto-approve\.mjs --json/);
    assert.match(page, /run_42f62404493863ad/);
    assert.match(page, /planner -> reviewer/);
    assert.match(page, /`2`/);
    assert.match(page, /\$0\.012/);
    assert.match(page, /"attempts_used": 1/);
  });

  it('AT-CIRCS-004: docs page distinguishes runner-interface proof from CLI proof', () => {
    const page = read(DOC_PATH);
    assert.match(page, /primitive proofs use the public runner interface/i);
    assert.match(page, /intentionally shells out to the real `agentxchain run` binary/i);
    assert.match(page, /not a second runner/i);
  });

  it('AT-CIRCS-005: example README matches the same proof boundary', () => {
    const readme = read(README_PATH);
    assert.match(readme, /primitive proofs do not shell out to `agentxchain step`/i);
    assert.match(readme, /run-via-cli-auto-approve\.mjs/);
    assert.match(readme, /intentionally shells out to the real `agentxchain run` binary/i);
  });
});
