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
    assert.match(spec, /DEC-HOMEBREW-SYNC-001/, 'spec must declare decision DEC-HOMEBREW-SYNC-001');
  });

  it('CI workflow does not fail if HOMEBREW_TAP_TOKEN is missing (graceful)', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    // The step should have a condition that handles missing token gracefully
    assert.match(
      workflow,
      /WARNING.*HOMEBREW_TAP_TOKEN not configured/,
      'workflow must warn gracefully when HOMEBREW_TAP_TOKEN is not set',
    );
  });

  it('CI workflow creates PR for mirror updates instead of pushing directly to protected main', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /Commit Homebrew mirror updates via PR/,
      'workflow must have a step to commit mirror updates via PR',
    );
    assert.match(
      workflow,
      /git fetch origin main/,
      'workflow must fetch the latest main branch before committing mirror updates',
    );
    assert.match(
      workflow,
      /chore\/homebrew-sync-v/,
      'workflow must create a named branch for the mirror update PR',
    );
    assert.match(
      workflow,
      /gh pr create/,
      'workflow must create a PR for the mirror update instead of pushing directly to main',
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
      /git push origin HEAD:main/,
      'workflow must NOT push directly to main (branch protection requires PRs)',
    );
    assert.doesNotMatch(
      workflow,
      /git config --global url\..*insteadOf/,
      'workflow must not rewrite global GitHub auth just to push the canonical tap',
    );
  });
});
