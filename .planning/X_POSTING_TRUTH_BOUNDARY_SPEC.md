# X/Twitter Posting Truth Boundary Spec

## Purpose

Define the success/failure contract for `marketing/post-twitter.sh` so that ambiguous browser-automation submit outcomes are never reported as success without timeline verification, including after the opposite-profile fallback attempt.

## Context

`post-linkedin.sh` already has timeline verification via `verify_linkedin_post_visible()`. The X/Twitter wrapper previously lacked an equivalent: on ambiguous submit ("still on compose page after clicking Post"), it suppressed retry but exited with a non-zero status — meaning `post-release.sh` reported failure even when the tweet may have been published.

The first fix closed that gap for the primary attempt but still left a second bug: if the primary post failed non-ambiguously and the opposite-profile retry ended in an ambiguous submit, `post-twitter.sh` exited straight out of `attempt_twitter_post` under `set -e` without verifying the timeline. That fallback path needs the same fail-closed verification rule.

## Contract

### Success path (exit 0)

`post-twitter.sh` may exit 0 only when:

1. `x-browser tweet post` exits 0 (clean success), OR
2. `x-browser tweet post` exits non-zero with the ambiguous-submit message on either the primary or fallback attempt AND `verify_twitter_post_visible` confirms the tweet snippet on `@agentxchaindev`'s timeline.

### Failure path (exit non-zero)

`post-twitter.sh` must exit non-zero when:

1. `x-browser tweet post` exits non-zero with a non-ambiguous error (e.g., login failure, timeout, network error), OR
2. `x-browser tweet post` exits non-zero with the ambiguous-submit message on either the primary or fallback attempt AND `verify_twitter_post_visible` cannot find the tweet on the timeline, OR
3. Timeline verification itself fails (fetch timeout, login failure, etc.).

### Retry boundary

- On ambiguous submit during the primary attempt: **no retry** — verify timeline instead. Retrying risks duplicate tweets.
- On non-ambiguous primary failure: **retry once** with the opposite browser profile, unless `AGENTXCHAIN_X_DISABLE_PROFILE_FALLBACK=1`.
- On ambiguous submit during the fallback attempt: **no second retry** — verify timeline and then exit success/failure based on proof.
- This matches the wrapper retry boundary documented in WAYS-OF-WORKING.md section 8.

### Timeline verification

- Uses `x-browser --json user timeline agentxchaindev --max 5` to fetch the 5 most recent tweets.
- Extracts the first non-empty line of the tweet text (up to 80 chars) as the search snippet, normalizing internal whitespace and trimming leading/trailing spaces.
- Uses a pipefail-safe, case-insensitive fixed-string match against the JSON output.
- Passes the same `--system-profile` flag used for the post attempt.

## Acceptance Tests

- **AT-XPOST-001**: `post-twitter.sh` must define `verify_twitter_post_visible` function.
- **AT-XPOST-002**: `post-twitter.sh` must define `post_snippet` function.
- **AT-XPOST-003**: On an ambiguous primary submit, the script must call `verify_twitter_post_visible` before exiting.
- **AT-XPOST-004**: The ambiguous-submit block must NOT contain a bare `exit "${LAST_X_STATUS}"` without a preceding verification attempt.
- **AT-XPOST-005**: The script must reference the account handle `agentxchaindev` for timeline fetch.
- **AT-XPOST-006**: The verification pattern must mirror LinkedIn's pattern: snippet extraction → timeline fetch → case-insensitive match → exit 0 on match, exit non-zero on no-match.
- **AT-XPOST-007**: If the primary attempt fails non-ambiguously and the fallback attempt is ambiguous, the script must verify the timeline before exiting.
- **AT-XPOST-008**: Behavior-level fixture tests must prove the exit-status/call-order contract for primary ambiguous verified, primary ambiguous unverified, fallback success, fallback ambiguous verified, and fallback ambiguous unverified paths.

## Open Questions

None. The pattern is proven on LinkedIn and the `x-browser user timeline` command is available.
