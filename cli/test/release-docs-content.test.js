import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('release planning surface classification', () => {
  it('RELEASE_PLAYBOOK.md is the single current release-cut playbook', () => {
    const playbook = read('.planning/RELEASE_PLAYBOOK.md');
    assert.doesNotMatch(playbook, /\*\*SUPERSEDED/i, 'release playbook must be current');
    assert.match(playbook, /publish-npm-on-tag\.yml/, 'playbook must reference canonical publish workflow');
    assert.match(playbook, /npm run preflight:release -- --target-version <semver>/,
      'playbook must require explicit target-version preflight');
    assert.match(playbook, /npm run preflight:release:strict -- --target-version <semver>/,
      'playbook must require strict preflight');
    assert.match(playbook, /npm run bump:release/, 'playbook must use bump:release to create release identity');
    assert.match(playbook, /npm run postflight:release -- --target-version <semver>/,
      'playbook must require postflight verification');
    assert.match(playbook, /Homebrew/i, 'playbook must include Homebrew update sequencing');
    assert.match(playbook, /fails before npm publication/i,
      'playbook must document the pre-publish canonical-tap prereq gate');
  });

  // -- Current contracts: these must NOT be marked SUPERSEDED --

  it('RELEASE_PREFLIGHT_VNEXT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'preflight vnext spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /--strict/, 'must document --strict flag');
    assert.match(spec, /explicit `2\.0\.0`/, 'must state the actual fallback default');
    assert.doesNotMatch(spec, /explicit `1\.0\.0`/, 'must not carry stale v1 default text');
  });

  it('RELEASE_POSTFLIGHT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_POSTFLIGHT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'postflight spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /Install smoke/, 'must document install smoke check');
    assert.match(spec, /isolated/, 'must require isolated install, not ambient PATH');
    assert.match(spec, /npm run postflight:release -- --target-version 2\.0\.1/,
      'must document the actual npm script entrypoint');
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

  it('publish workflow includes downstream truth verification as completeness gate', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(workflow, /release-downstream-truth\.sh/,
      'publish workflow must run downstream truth as the final completeness gate');
    assert.match(workflow, /RELEASE_DOWNSTREAM_RETRY_ATTEMPTS/,
      'downstream truth must have retry configuration in CI');
    assert.match(workflow, /Verify canonical tap readiness before first publish/,
      'publish workflow must block first-time publish when canonical tap completion is impossible');
  });

  it('cli package exposes the documented postflight script alias', () => {
    const pkg = JSON.parse(read('cli/package.json'));
    assert.equal(pkg.scripts['postflight:release'], 'bash scripts/release-postflight.sh');
  });
});
