import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CLI = resolve(ROOT, 'cli');

function read(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

describe('homebrew sync automation contract', () => {
  it('sync-homebrew.sh exists and is referenced from package.json', () => {
    assert.ok(
      existsSync(resolve(CLI, 'scripts', 'sync-homebrew.sh')),
      'cli/scripts/sync-homebrew.sh must exist',
    );
    const pkg = JSON.parse(read('cli/package.json'));
    assert.ok(
      pkg.scripts['sync:homebrew'],
      'package.json must have a sync:homebrew script',
    );
    assert.match(
      pkg.scripts['sync:homebrew'],
      /sync-homebrew\.sh/,
      'sync:homebrew script must reference sync-homebrew.sh',
    );
  });

  it('CI workflow includes Homebrew sync step after postflight', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /sync-homebrew\.sh/,
      'publish workflow must call sync-homebrew.sh',
    );
    assert.match(
      workflow,
      /HOMEBREW_TAP_TOKEN/,
      'publish workflow must reference HOMEBREW_TAP_TOKEN secret',
    );
    assert.match(
      workflow,
      /--push-tap/,
      'publish workflow must use --push-tap flag when token is available',
    );
  });

  it('CI workflow blocks first-time publish before npm mutation when HOMEBREW_TAP_TOKEN is missing', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Verify canonical tap readiness before first publish/,
      'workflow must have a prereq gate before first publish',
    );
    assert.match(
      workflow,
      /Release blocked before npm publish: HOMEBREW_TAP_TOKEN not configured/,
      'prereq gate must fail before npm publish when the token is missing',
    );
    assert.match(
      workflow,
      /Verify canonical tap readiness before first publish[\s\S]*Publish tagged release/,
      'prereq gate must run before the publish step',
    );
  });

  it('sync script requires --target-version (not hardcoded versions)', () => {
    const script = read('cli/scripts/sync-homebrew.sh');
    assert.match(script, /set -euo pipefail/, 'script must fail closed on command errors');
    assert.match(script, /--target-version/, 'script must accept --target-version');
    assert.match(script, /--push-tap/, 'script must accept --push-tap');
    assert.match(script, /--dry-run/, 'script must accept --dry-run');
    assert.match(script, /npm view/, 'script must fetch from npm registry');
    assert.match(script, /shasum -a 256/, 'script must compute SHA256');
    assert.match(
      script,
      /Repo mirror is current, but canonical tap verification is still required\./,
      'script must not skip canonical tap verification when the repo mirror already matches npm',
    );
    assert.match(
      script,
      /git config user\.name/,
      'script must configure a git identity for canonical tap commits when needed',
    );
  });

  it('sync script treats canonical tap push rejection as success only after remote verification', () => {
    const script = read('cli/scripts/sync-homebrew.sh');
    assert.match(
      script,
      /Push rejected by \$\{CANONICAL_TAP_REPO\}; verifying remote state/,
      'script must explicitly detect rejected canonical tap pushes',
    );
    assert.match(
      script,
      /git fetch origin main/,
      'script must fetch the latest canonical tap state before deciding a rejected push is acceptable',
    );
    assert.match(
      script,
      /git show origin\/main:Formula\/agentxchain\.rb/,
      'script must inspect the fetched canonical tap formula after a rejected push',
    );
    assert.match(
      script,
      /canonical_tap_matches_target "\$REMOTE_FORMULA" "\$TARBALL_URL" "\$TARBALL_SHA"/,
      'script must verify remote formula URL and SHA against the target artifact before accepting a rejected push',
    );
    assert.match(
      script,
      /Canonical tap already matches target after push rejection — treating sync as complete\./,
      'script must only treat rejected pushes as success when the remote is already correct',
    );
    assert.match(
      script,
      /FAIL: could not push to \$\{CANONICAL_TAP_REPO\} and remote tap does not match target artifact/,
      'script must still fail closed when the rejected push leaves the remote incorrect',
    );
  });

  it('release playbook references sync:homebrew instead of manual steps', () => {
    const playbook = read('.planning/RELEASE_PLAYBOOK.md');
    assert.match(
      playbook,
      /sync:homebrew/,
      'playbook must reference npm run sync:homebrew',
    );
    assert.match(
      playbook,
      /Sync Homebrew/,
      'playbook must describe the sync automation',
    );
  });

  it('sync automation spec exists with acceptance tests', () => {
    const spec = read('.planning/HOMEBREW_SYNC_AUTOMATION_SPEC.md');
    assert.match(spec, /AT-HS-001/, 'spec must define acceptance test AT-HS-001');
    assert.match(spec, /AT-HS-011/, 'spec must define acceptance test AT-HS-011');
    assert.match(spec, /AT-HS-015/, 'spec must define acceptance test AT-HS-015');
    assert.match(spec, /AT-HS-018/, 'spec must define acceptance test AT-HS-018');
    assert.match(spec, /AT-HS-019/, 'spec must define acceptance test AT-HS-019');
    assert.match(spec, /AT-HS-020/, 'spec must define acceptance test AT-HS-020');
    assert.match(spec, /AT-HS-022/, 'spec must define acceptance test AT-HS-022');
    assert.match(spec, /AT-HS-023/, 'spec must define acceptance test AT-HS-023');
    assert.match(spec, /DEC-HOMEBREW-SYNC-001/, 'spec must declare decision DEC-HOMEBREW-SYNC-001');
    assert.match(spec, /DEC-HOMEBREW-SYNC-009/, 'spec must declare decision DEC-HOMEBREW-SYNC-009');
    assert.match(spec, /DEC-HOMEBREW-SYNC-011/, 'spec must declare decision DEC-HOMEBREW-SYNC-011');
    assert.match(spec, /DEC-HOMEBREW-SYNC-013/, 'spec must declare decision DEC-HOMEBREW-SYNC-013');
    assert.match(spec, /DEC-HOMEBREW-SYNC-015/, 'spec must declare decision DEC-HOMEBREW-SYNC-015');
    assert.match(spec, /DEC-HOMEBREW-SYNC-016/, 'spec must declare decision DEC-HOMEBREW-SYNC-016');
  });

  it('Homebrew sync step warns when HOMEBREW_TAP_TOKEN is missing', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /WARNING.*HOMEBREW_TAP_TOKEN not configured/,
      'workflow must warn when HOMEBREW_TAP_TOKEN is not set',
    );
  });

  it('Homebrew sync step emits tap_pushed output for downstream gate', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /tap_pushed=true.*GITHUB_OUTPUT/s,
      'workflow must set tap_pushed=true output when token is available',
    );
    assert.match(
      workflow,
      /tap_pushed=false.*GITHUB_OUTPUT/s,
      'workflow must set tap_pushed=false output when token is missing',
    );
  });

  it('CI workflow creates and repairs GitHub Release after postflight', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Create GitHub Release/,
      'workflow must have a GitHub Release creation step',
    );
    assert.match(
      workflow,
      /render-github-release-body\.mjs/,
      'workflow must render a governed GitHub Release body from the release page',
    );
    assert.match(
      workflow,
      /gh release create/,
      'workflow must use gh release create',
    );
    assert.match(
      workflow,
      /gh release edit/,
      'workflow must repair existing release bodies on rerun',
    );
    assert.match(
      workflow,
      /gh release view.*tagName.*updated release body/s,
      'workflow must be idempotent and update the existing release body instead of skipping',
    );
  });

  it('CI workflow has a release completeness gate as the final step', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Verify release completeness/,
      'workflow must have a release completeness verification step',
    );
    assert.match(
      workflow,
      /release-downstream-truth\.sh/,
      'completeness gate must run downstream truth verification',
    );
    assert.match(
      workflow,
      /Canonical tap push did not run in CI for this attempt — verifying downstream surfaces directly\./,
      'completeness gate must verify downstream truth directly on reruns without a CI tap push',
    );
    assert.doesNotMatch(
      workflow,
      /Verify release completeness[\s\S]*::error::Release incomplete.*HOMEBREW_TAP_TOKEN not configured/,
      'completeness gate must not use token absence as a proxy for downstream truth',
    );
  });

  it('CI workflow attempts direct push to main for Homebrew mirror updates', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Commit Homebrew mirror updates \(direct push only\)/,
      'workflow must have a direct-push-only mirror step (no PR fallback)',
    );
    assert.match(
      workflow,
      /git fetch origin main/,
      'workflow must fetch the latest main branch before committing mirror updates',
    );
    assert.match(
      workflow,
      /git restore --worktree --staged homebrew\/agentxchain\.rb homebrew\/README\.md/,
      'workflow must clear the snapshotted mirror-file edits before switching branches in CI',
    );
    assert.match(
      workflow,
      /Attempting direct push to main using \$\{PUSH_TOKEN_NAME\}/,
      'workflow must attempt direct push as primary path using the selected repo-push credential',
    );
    assert.match(
      workflow,
      /Direct push to main succeeded via \$\{PUSH_TOKEN_NAME\} — no PR needed/,
      'workflow must report success on direct push',
    );
    assert.match(
      workflow,
      /direct_push=true.*GITHUB_OUTPUT/s,
      'workflow must set direct_push output on success',
    );
    assert.doesNotMatch(
      workflow,
      /gh pr create/,
      'workflow must not create PRs for mirror sync (DEC-HOMEBREW-MIRROR-NO-PR-001)',
    );
    assert.match(
      workflow,
      /Homebrew mirror direct push failed.*Canonical tap is already correct/,
      'workflow must warn clearly when direct push fails instead of creating a PR',
    );
    assert.match(
      workflow,
      /REPO_PUSH_TOKEN.*admin PAT.*branch-protection bypass/,
      'workflow must tell the operator how to fix the direct push permanently',
    );
  });

  it('CI workflow prefers REPO_PUSH_TOKEN, then GITHUB_TOKEN, then HOMEBREW_TAP_TOKEN for repo direct push', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /REPO_PUSH_TOKEN: \$\{\{ secrets\.REPO_PUSH_TOKEN }}/,
      'workflow must load the optional REPO_PUSH_TOKEN secret',
    );
    assert.match(
      workflow,
      /GH_TOKEN: \$\{\{ github\.token }}/,
      'workflow must expose GITHUB_TOKEN for direct repo push attempts',
    );
    assert.match(
      workflow,
      /if \[\[ -n "\$\{REPO_PUSH_TOKEN:-}" \]\]; then[\s\S]*PUSH_TOKEN_NAME="REPO_PUSH_TOKEN"[\s\S]*elif \[\[ -n "\$\{GH_TOKEN:-}" \]\]; then[\s\S]*PUSH_TOKEN_NAME="GITHUB_TOKEN"[\s\S]*elif \[\[ -n "\$\{HOMEBREW_TAP_TOKEN:-}" \]\]; then[\s\S]*PUSH_TOKEN_NAME="HOMEBREW_TAP_TOKEN"/,
      'workflow must prefer REPO_PUSH_TOKEN, then GITHUB_TOKEN, then HOMEBREW_TAP_TOKEN',
    );
  });

  it('CI workflow does not require pull-requests permission (no PR path)', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.doesNotMatch(
      workflow,
      /pull-requests:\s*write/,
      'workflow must not request pull-requests:write since the PR fallback was removed',
    );
  });

  it('sync-homebrew.sh success banner forbids declaring release complete from sync alone (DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001)', () => {
    const script = read('cli/scripts/sync-homebrew.sh');
    assert.doesNotMatch(
      script,
      /^echo "SYNC COMPLETE — Homebrew formula updated to/m,
      'sync-homebrew.sh must not emit a bare "SYNC COMPLETE" banner that reads as release completion',
    );
    assert.match(
      script,
      /SYNC STEP COMPLETE/,
      'success banner must use "SYNC STEP COMPLETE" (phase transition) language, not "SYNC COMPLETE" (release-finished) language',
    );
    assert.match(
      script,
      /Do NOT declare the release complete from this script's exit code alone\./,
      'success banner must explicitly warn operators against treating sync exit code as release completion',
    );
    assert.match(
      script,
      /verify-post-publish\.sh --target-version/,
      'success banner must point operators at the manual verify-post-publish path',
    );
    assert.match(
      script,
      /release-downstream-truth\.sh --target-version/,
      'success banner must point operators at the CI-equivalent downstream-truth path',
    );
    assert.match(
      script,
      /DEC-VERIFY-POST-PUBLISH-NPX-001/,
      'success banner must cite DEC-VERIFY-POST-PUBLISH-NPX-001 so the decision is discoverable from the script',
    );
    assert.match(
      script,
      /DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001/,
      'success banner must cite DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001 so the decision is discoverable from the script',
    );
  });

  it('WAYS-OF-WORKING.md forbids treating sync-homebrew.sh as a one-step release completion (DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001)', () => {
    const ways = read('.planning/WAYS-OF-WORKING.md');
    assert.match(
      ways,
      /Do NOT declare a release complete from `sync-homebrew\.sh` alone/,
      'WAYS-OF-WORKING.md section 9 must state that sync-homebrew.sh alone is not release completion',
    );
    assert.match(
      ways,
      /verify-post-publish\.sh --target-version/,
      'WAYS-OF-WORKING.md must document the verify-post-publish.sh finalization path',
    );
    assert.match(
      ways,
      /release-downstream-truth\.sh --target-version/,
      'WAYS-OF-WORKING.md must document the CI-equivalent release-downstream-truth.sh finalization path',
    );
    assert.match(
      ways,
      /DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001/,
      'WAYS-OF-WORKING.md must cite the loophole-close decision',
    );
  });
});
