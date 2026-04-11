import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const MARKETING_DIR = join(REPO_ROOT, 'marketing');
const POST_RELEASE = readFileSync(join(MARKETING_DIR, 'post-release.sh'), 'utf8');
const POST_LINKEDIN = readFileSync(join(MARKETING_DIR, 'post-linkedin.sh'), 'utf8');
const POST_TWITTER = readFileSync(join(MARKETING_DIR, 'post-twitter.sh'), 'utf8');
const POST_REDDIT = readFileSync(join(MARKETING_DIR, 'post-reddit.sh'), 'utf8');

describe('marketing release post script', () => {
  it('uses hyphenated docs release routes instead of dotted semver', () => {
    assert.ok(POST_RELEASE.includes('DOCS_VERSION="${VERSION//./-}"'));
    assert.ok(POST_RELEASE.includes('RELEASE_URL="https://agentxchain.dev/docs/releases/${DOCS_VERSION}"'));
    assert.ok(!POST_RELEASE.includes('docs/releases/${VERSION}'));
  });

  it('release URL uses the canonical agentxchain.dev domain', () => {
    assert.match(POST_RELEASE, /https:\/\/agentxchain\.dev\//);
    assert.ok(!POST_RELEASE.includes('http://'), 'must use HTTPS, not HTTP');
  });

  it('release script delegates to post-linkedin.sh and post-reddit.sh', () => {
    assert.ok(POST_RELEASE.includes('post-linkedin.sh'));
    assert.ok(POST_RELEASE.includes('post-reddit.sh'));
    assert.ok(!POST_RELEASE.includes('post-twitter.sh'));
  });
});

describe('marketing wrapper scripts', () => {
  it('release, LinkedIn, Twitter, and Reddit marketing scripts exist and are bash scripts', () => {
    for (const script of [POST_RELEASE, POST_LINKEDIN, POST_TWITTER, POST_REDDIT]) {
      assert.match(script, /^#!\/usr\/bin\/env bash/);
      assert.ok(script.includes('set -euo pipefail'));
    }
  });

  it('post-linkedin.sh does not generate URLs (pure wrapper)', () => {
    assert.ok(!POST_LINKEDIN.includes('agentxchain.dev'), 'post-linkedin.sh should not hardcode URLs — the caller provides post text');
  });

  it('post-linkedin.sh targets the AgentXchain company page via li-browser', () => {
    assert.ok(POST_LINKEDIN.includes('li-browser'));
    assert.ok(POST_LINKEDIN.includes('COMPANY_ID="112883208"'));
  });

  it('post-twitter.sh does not generate URLs (pure wrapper)', () => {
    assert.ok(!POST_TWITTER.includes('agentxchain.dev'), 'post-twitter.sh should not hardcode URLs — the caller provides tweet text');
  });

  it('post-reddit.sh does not generate URLs (pure wrapper)', () => {
    assert.ok(!POST_REDDIT.includes('agentxchain.dev'), 'post-reddit.sh should not hardcode URLs — the caller provides body text');
  });

  it('post-reddit.sh targets r/agentXchain_dev', () => {
    assert.ok(POST_REDDIT.includes('agentXchain_dev'));
  });
});
