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
    assert.match(POST_LINKEDIN, /AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE:-0/);
    assert.doesNotMatch(POST_LINKEDIN, /li-browser --system-profile/);
    assert.match(POST_LINKEDIN, /"\$\{LIBROWSER_BIN\}" "\$\{ARGS\[@\]\}" post create/);
  });

  it('AT-MBAH-003: Twitter wrapper uses the repo-local binary and exposes system-profile override control', () => {
    assert.match(POST_TWITTER, /XBROWSER_BIN=.*\.venv\/bin\/x-browser/);
    assert.match(POST_TWITTER, /AGENTXCHAIN_X_USE_SYSTEM_PROFILE:-1/);
    assert.match(POST_TWITTER, /"\$\{XBROWSER_BIN\}" "\$\{ARGS\[@\]\}" tweet post/);
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
});
