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
    assert.match(
      workflow,
      /pull-requests:\s*write/,
      'publish workflow must grant pull-requests: write so it can open the mirror PR itself',
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
    assert.match(
      playbook,
      /direct push when `REPO_PUSH_TOKEN` \(preferred\) or a broad `HOMEBREW_TAP_TOKEN` is available, otherwise via PR fallback/i,
      'playbook must describe the repo-mirror direct-push path truthfully',
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
    assert.match(spec, /DEC-HOMEBREW-SYNC-001/, 'spec must declare decision DEC-HOMEBREW-SYNC-001');
    assert.match(spec, /DEC-HOMEBREW-SYNC-009/, 'spec must declare decision DEC-HOMEBREW-SYNC-009');
    assert.match(spec, /DEC-HOMEBREW-SYNC-011/, 'spec must declare decision DEC-HOMEBREW-SYNC-011');
    assert.match(spec, /DEC-HOMEBREW-SYNC-013/, 'spec must declare decision DEC-HOMEBREW-SYNC-013');
    assert.match(spec, /DEC-HOMEBREW-SYNC-015/, 'spec must declare decision DEC-HOMEBREW-SYNC-015');
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

  it('CI workflow attempts direct push to main before falling back to PR', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Commit Homebrew mirror updates \(direct push or PR fallback\)/,
      'workflow must have a combined direct-push + PR fallback step',
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
      /Direct push to main succeeded — no PR needed/,
      'workflow must report success on direct push',
    );
    assert.match(
      workflow,
      /direct_push=true.*GITHUB_OUTPUT/s,
      'workflow must set direct_push output on success',
    );
    assert.match(
      workflow,
      /Falling back to PR path/,
      'workflow must fall back to PR if direct push fails',
    );
    assert.match(
      workflow,
      /chore\/homebrew-sync-v/,
      'workflow must create a named branch for the mirror update PR in fallback path',
    );
    assert.match(
      workflow,
      /gh pr create/,
      'workflow must create a PR in fallback path',
    );
    assert.match(
      workflow,
      /git push --force-with-lease origin "\$BRANCH"/,
      'workflow must update an existing mirror branch safely on rerun',
    );
    assert.match(
      workflow,
      /gh pr list --base main --head "\$BRANCH" --state open/,
      'workflow must detect an existing open PR on rerun instead of blindly creating a second one',
    );
    assert.doesNotMatch(
      workflow,
      /git config --global url\..*insteadOf/,
      'workflow must not rewrite global GitHub auth just to push the canonical tap',
    );
  });

  it('CI workflow prefers REPO_PUSH_TOKEN over HOMEBREW_TAP_TOKEN for repo direct push', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /REPO_PUSH_TOKEN: \$\{\{ secrets\.REPO_PUSH_TOKEN }}/,
      'workflow must load the optional REPO_PUSH_TOKEN secret',
    );
    assert.match(
      workflow,
      /PUSH_TOKEN="\$\{REPO_PUSH_TOKEN:-\$\{HOMEBREW_TAP_TOKEN:-}}"/,
      'workflow must prefer REPO_PUSH_TOKEN and fall back to HOMEBREW_TAP_TOKEN',
    );
    assert.match(
      workflow,
      /PUSH_TOKEN_NAME="REPO_PUSH_TOKEN"/,
      'workflow must label the preferred repo-push credential explicitly',
    );
  });

  it('CI workflow fails closed on unexpected PR creation failure', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /gh pr create/,
      'workflow must create the Homebrew mirror PR directly',
    );
    assert.doesNotMatch(
      workflow,
      /::warning::Could not create Homebrew mirror PR/,
      'workflow must not treat PR creation failure as an acceptable warning-only outcome',
    );
  });

  it('CI workflow skips PR closeout when direct push succeeded', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /direct_push != 'true'/,
      'PR closeout step must be skipped when direct push succeeded',
    );
  });

  it('CI workflow best-effort closes the Homebrew mirror PR after creation (fallback path)', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /id:\s*homebrew_pr/,
      'workflow must expose the mirror PR step output for follow-on automation',
    );
    assert.match(
      workflow,
      /pr_number=.*GITHUB_OUTPUT/s,
      'workflow must record the Homebrew mirror PR number for later steps',
    );
    assert.match(
      workflow,
      /Close out Homebrew mirror PR/,
      'workflow must have a dedicated PR closeout step',
    );
    assert.match(
      workflow,
      /status=not_needed.*GITHUB_OUTPUT/s,
      'workflow must emit a closeout status output for the mirror PR step',
    );
    assert.match(
      workflow,
      /pr_url=.*GITHUB_OUTPUT/s,
      'workflow must record the mirror PR URL for warning output',
    );
    assert.match(
      workflow,
      /gh pr review "\$PR_NUMBER" --approve/,
      'workflow must attempt an approval review for the mirror PR',
    );
    assert.match(
      workflow,
      /Cannot self-approve/,
      'workflow must handle self-approval failure gracefully',
    );
    assert.match(
      workflow,
      /gh pr merge "\$PR_NUMBER" --squash --delete-branch(?!.*--admin)/,
      'workflow must attempt regular merge first without admin override',
    );
    assert.match(
      workflow,
      /required status check\|is expected\|add the --auto flag\|after all the requirements have been met/,
      'workflow must recognize the pending-checks case that should arm auto-merge',
    );
    // The approval-deadlock predicate must stay narrow.
    const grepLine = workflow.split('\n').find(l => l.includes('grep -qiE') && l.includes('review is required'));
    assert.ok(grepLine, 'workflow must have a grep-based error pattern gate');
    assert.ok(
      !grepLine.includes('is not clean'),
      'admin-fallback grep must not contain "is not clean" — it matches unrelated mergeability failures (DEC-HOMEBREW-SYNC-010)',
    );
    assert.ok(
      !grepLine.includes('branch protection'),
      'admin-fallback grep must not contain generic "branch protection" wording — that is broader than the self-approval deadlock',
    );
    assert.ok(
      !grepLine.includes('not authorized to merge'),
      'admin-fallback grep must not treat generic authorization failures as self-approval deadlock',
    );
    assert.ok(
      !grepLine.includes('admin override'),
      'approval-deadlock grep must not depend on generic admin-override wording',
    );
    assert.match(
      workflow,
      /still requires an approving review and github-actions cannot self-approve PRs it created\. Canonical downstream truth is complete; repo mirror follow-up remains at/,
      'workflow must warn explicitly when approval deadlock leaves the mirror PR open',
    );
    assert.match(
      workflow,
      /gh pr merge "\$PR_NUMBER" --auto --squash --delete-branch/,
      'workflow must enable auto-merge when required checks are still pending',
    );
    assert.doesNotMatch(
      workflow,
      /gh pr merge "\$PR_NUMBER" --squash --delete-branch --admin/,
      'workflow must never use admin merge for the mirror PR closeout path',
    );
    assert.match(
      workflow,
      /Regular merge failed for Homebrew mirror PR/,
      'workflow must warn explicitly on unexpected mirror closeout merge failures',
    );
    assert.match(
      workflow,
      /did not merge after auto-merge handling/,
      'workflow must warn explicitly if the mirror PR never reaches merged state',
    );
  });

  it('CI workflow closes superseded Homebrew mirror PRs after determining the current PR', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Ensuring no superseded Homebrew mirror PRs remain open\./,
      'workflow must explicitly reconcile older Homebrew mirror PRs after the current release PR is known',
    );
    assert.match(
      workflow,
      /gh pr list --base main --state open --json number,headRefName/,
      'workflow must inspect open PR head refs when reconciling stale Homebrew sync PRs',
    );
    assert.match(
      workflow,
      /startswith\("chore\/homebrew-sync-v"\)/,
      'workflow must filter stale Homebrew sync PRs by the release-sync branch prefix',
    );
    assert.ok(
      workflow.includes(`select(.headRefName != "'"$EXCLUDE_BRANCH"'")`),
      'workflow must exclude the current release branch from stale-PR cleanup',
    );
    assert.ok(
      workflow.includes(`"\\(.number)\\t\\(.headRefName)"`),
      'workflow must keep the stale PR number and branch name together for closeout logging',
    );
    assert.match(
      workflow,
      /Superseded by direct push to main for v\$\{RELEASE_TAG#v\}\./,
      'workflow must have a direct-push supersession message for stale PRs',
    );
    assert.match(
      workflow,
      /::warning::Could not close superseded Homebrew mirror PR #\$\{STALE_NUMBER\}/,
      'workflow must warn clearly if stale PR cleanup fails instead of silently leaving drift',
    );
  });
});
