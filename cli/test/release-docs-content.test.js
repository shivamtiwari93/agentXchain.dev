import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('release planning surface classification', () => {
  // -- Current contracts: these must NOT be marked SUPERSEDED --

  it('RELEASE_PREFLIGHT_VNEXT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'preflight vnext spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /--strict/, 'must document --strict flag');
  });

  it('RELEASE_POSTFLIGHT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_POSTFLIGHT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'postflight spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /Install smoke/, 'must document install smoke check');
    assert.match(spec, /isolated/, 'must require isolated install, not ambient PATH');
  });

  // -- Superseded specs: these MUST be marked SUPERSEDED --

  const supersededSpecs = [
    { file: '.planning/RELEASE_CUT_SPEC.md', reason: 'v1.0.0 was never published' },
    { file: '.planning/RELEASE_BRIEF.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/V1_1_RELEASE_HANDOFF_SPEC.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/V1_RELEASE_CHECKLIST.md', reason: 'v1.0.0 was never published' },
    { file: '.planning/V1_1_RELEASE_CHECKLIST.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/V1_1_RELEASE_SCOPE_SPEC.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/RELEASE_PREFLIGHT_SPEC.md', reason: 'replaced by vnext spec' },
    { file: '.planning/RELEASE_RECOVERY.md', reason: 'v2.0.0/v2.0.1 were never published' },
    { file: '.planning/V2_1_RELEASE_NOTES_SPEC.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/V2_1_RELEASE_NOTES.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/POST_V1_ROADMAP.md', reason: 'v1.0.0 was never published' },
  ];

  for (const { file, reason } of supersededSpecs) {
    it(`${file.split('/').pop()} is marked SUPERSEDED (${reason})`, () => {
      assert.ok(existsSync(resolve(ROOT, file)), `${file} must exist`);
      const content = read(file);
      assert.match(content, /\*\*SUPERSEDED/i,
        `${file} must be marked SUPERSEDED — it documents a version that was never published to npm`);
    });
  }

  // -- Preflight spec matches implementation --

  it('preflight spec default version matches the actual script', () => {
    const spec = read('.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md');
    const script = read('cli/scripts/release-preflight.sh');
    // Extract default from script: TARGET_VERSION="X.Y.Z"
    const scriptDefault = script.match(/TARGET_VERSION="(\d+\.\d+\.\d+)"/)?.[1];
    assert.ok(scriptDefault, 'script must have a TARGET_VERSION default');
    // Spec must mention the same default
    assert.match(spec, new RegExp(`Defaults to .${scriptDefault}.`),
      `spec default must match script default (${scriptDefault})`);
  });

  // -- Operator handoff doc is current --

  it('HUMAN_TASKS.md documents the trusted-publishing workflow as default release path', () => {
    const humanTasks = read('.planning/HUMAN_TASKS.md');
    assert.match(humanTasks, /trusted-publishing workflow/i);
    assert.match(humanTasks, /publish-npm-on-tag/);
  });

  // -- Publish workflow exists and has postflight --

  it('publish workflow includes postflight verification', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(workflow, /release-postflight\.sh/);
    assert.match(workflow, /RELEASE_POSTFLIGHT_RETRY_ATTEMPTS/);
  });
});
