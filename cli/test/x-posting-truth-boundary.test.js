import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC_PATH = join(ROOT, '.planning', 'X_POSTING_TRUTH_BOUNDARY_SPEC.md');
const POST_TWITTER = read('marketing/post-twitter.sh');

describe('X posting truth boundary (DEC-X-POST-VERIFICATION-002)', () => {
  it('AT-XPOST-001: post-twitter.sh defines verify_twitter_post_visible', () => {
    assert.match(POST_TWITTER, /verify_twitter_post_visible\(\)/);
  });

  it('AT-XPOST-002: post-twitter.sh defines post_snippet', () => {
    assert.match(POST_TWITTER, /post_snippet\(\)/);
  });

  it('AT-XPOST-003: primary ambiguous-submit block calls verify_twitter_post_visible before exiting', () => {
    // The ambiguous block must contain: detect ambiguity → verify timeline → exit based on result
    assert.match(POST_TWITTER, /is_ambiguous_tweet_submit_failure.*\n.*verify.*timeline/s);
    assert.match(POST_TWITTER, /verify_twitter_post_visible "\$\{LAST_X_MODE\}" "\$\{SNIPPET\}"/);
  });

  it('AT-XPOST-004: ambiguous-submit block does not exit without verification', () => {
    // Extract the ambiguous-submit block (between the is_ambiguous check and the next fi)
    const ambiguousBlock = POST_TWITTER.match(
      /if is_ambiguous_tweet_submit_failure[\s\S]*?(?=\nif \[ "\$\{DISABLE_PROFILE_FALLBACK\}")/
    );
    assert.ok(ambiguousBlock, 'ambiguous-submit block must exist');
    const block = ambiguousBlock[0];
    // Must contain verify call
    assert.match(block, /verify_twitter_post_visible/,
      'ambiguous block must call verify_twitter_post_visible');
    // Must contain "treating the attempt as success" on verification hit
    assert.match(block, /treating the attempt as success/,
      'ambiguous block must report success on timeline verification');
  });

  it('AT-XPOST-005: timeline verification targets the agentxchaindev account', () => {
    assert.match(POST_TWITTER, /XBROWSER_ACCOUNT="agentxchaindev"/);
    assert.match(POST_TWITTER, /user timeline "\$\{XBROWSER_ACCOUNT\}"/);
  });

  it('AT-XPOST-006: verification uses JSON timeline fetch with case-insensitive snippet match', () => {
    assert.match(POST_TWITTER, /--json user timeline/);
    assert.match(POST_TWITTER, /grep -Fqi -- "\$\{snippet\}"/);
    assert.match(POST_TWITTER, /x-verify: found tweet on timeline/);
    assert.match(POST_TWITTER, /x-verify: tweet not found on timeline/);
  });

  it('AT-XPOST-007: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'X_POSTING_TRUTH_BOUNDARY_SPEC.md must exist');
  });

  it('AT-XPOST-008: mirrors LinkedIn verification pattern', () => {
    // Both wrappers should have: snippet extraction, timeline/feed verification, ambiguous handling
    const linkedin = read('marketing/post-linkedin.sh');
    // LinkedIn has verify_linkedin_post_visible, Twitter has verify_twitter_post_visible
    assert.match(linkedin, /verify_linkedin_post_visible/);
    assert.match(POST_TWITTER, /verify_twitter_post_visible/);
    // Both use post_snippet
    assert.match(linkedin, /post_snippet\(\)/);
    assert.match(POST_TWITTER, /post_snippet\(\)/);
    // Both verify on ambiguous submit before deciding
    assert.match(linkedin, /verifying company feed before any retry/);
    assert.match(POST_TWITTER, /verifying account timeline before any retry/);
  });

  it('AT-XPOST-007: fallback ambiguous-submit block verifies timeline before exiting', () => {
    const fallbackBlock = POST_TWITTER.match(
      /if is_ambiguous_tweet_submit_failure "\$\{LAST_X_OUTPUT\}"; then[\s\S]*?fallback attempt could not be verified[\s\S]*?fi[\s\S]*?exit "\$\{LAST_X_STATUS\}"/
    );
    assert.ok(fallbackBlock, 'fallback ambiguous-submit block must exist');
    const block = fallbackBlock[0];
    assert.match(block, /fallback attempt reached an ambiguous submit/);
    assert.match(block, /verify_twitter_post_visible "\$\{LAST_X_MODE\}" "\$\{SNIPPET\}"/);
    assert.match(block, /treating the attempt as success/);
  });
});
