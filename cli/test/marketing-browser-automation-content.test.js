import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC_PATH = join(ROOT, '.planning', 'MARKETING_BROWSER_AUTOMATION_HARDENING_SPEC.md');
const POST_TWITTER = read('marketing/post-twitter.sh');
const POST_LINKEDIN = read('marketing/post-linkedin.sh');
const WAYS = read('.planning/WAYS-OF-WORKING.md');
const HUMAN_TASKS = read('.planning/HUMAN_TASKS.md');

describe('marketing browser automation hardening', () => {
  it('AT-MBAH-001: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'MARKETING_BROWSER_AUTOMATION_HARDENING_SPEC.md must exist');
  });

  it('AT-MBAH-002: LinkedIn wrapper uses the repo-local binary and isolated profile by default', () => {
    assert.match(POST_LINKEDIN, /LIBROWSER_BIN=.*\.venv\/bin\/li-browser/);
    assert.match(POST_LINKEDIN, /LIBROWSER_PYTHON=.*\.venv\/bin\/python/);
    assert.match(POST_LINKEDIN, /AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE:-0/);
    assert.match(POST_LINKEDIN, /AGENTXCHAIN_LINKEDIN_DISABLE_PROFILE_FALLBACK:-0/);
    assert.match(POST_LINKEDIN, /"\$\{LIBROWSER_BIN\}" "\$\{args\[@\]\}" post create/);
  });

  it('AT-MBAH-003: Twitter wrapper uses the repo-local binary and exposes system-profile override control', () => {
    assert.match(POST_TWITTER, /XBROWSER_BIN=.*\.venv\/bin\/x-browser/);
    assert.match(POST_TWITTER, /AGENTXCHAIN_X_USE_SYSTEM_PROFILE:-1/);
    assert.match(POST_TWITTER, /AGENTXCHAIN_X_DISABLE_PROFILE_FALLBACK:-0/);
    assert.match(POST_TWITTER, /"\$\{XBROWSER_BIN\}" "\$\{args\[@\]\}" tweet post/);
  });

  it('AT-MBAH-004: Twitter wrapper contains the Chrome-lock preflight boundary', () => {
    assert.match(POST_TWITTER, /\.config\/x-browser\/chrome\.port/);
    assert.match(POST_TWITTER, /Google Chrome is already running without an x-browser DevTools session/);
    assert.match(POST_TWITTER, /AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0/);
  });

  it('AT-MBAH-005: durable docs describe the updated social-posting defaults truthfully', () => {
    assert.match(WAYS, /LinkedIn.*isolated tool profile by default/i);
    assert.match(WAYS, /AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1/);
    assert.match(HUMAN_TASKS, /isolated `li-browser` profile by default/i);
    assert.match(HUMAN_TASKS, /AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0/);
  });

  it('AT-MBAH-006: LinkedIn wrapper verifies ambiguous submit states before failing', () => {
    assert.match(POST_LINKEDIN, /verify_linkedin_post_visible/);
    assert.match(POST_LINKEDIN, /composer remained open after clicking the submit control/);
    assert.match(POST_LINKEDIN, /suppressing automatic retry to avoid duplicate posts/);
    assert.match(POST_LINKEDIN, /company\/\{company_id\}\/admin\/page-posts\/published/);
  });

  it('AT-MBAH-007: both wrappers retry with the opposite profile for non-ambiguous failures', () => {
    assert.match(POST_LINKEDIN, /retrying once with \$\(profile_label "\$\{SECONDARY_MODE\}"\)/);
    assert.match(POST_TWITTER, /retrying once with \$\(profile_label "\$\{SECONDARY_MODE\}"\)/);
    assert.match(POST_TWITTER, /suppressing automatic retry to avoid duplicate tweets/);
  });

  it('AT-MBAH-008: wrappers preserve the real browser-tool exit status on failure', () => {
    assert.match(POST_LINKEDIN, /local output status/);
    assert.match(POST_LINKEDIN, /LAST_LINKEDIN_STATUS="\$\{status\}"/);
    assert.match(POST_TWITTER, /local output status/);
    assert.match(POST_TWITTER, /LAST_X_STATUS="\$\{status\}"/);
  });
});
