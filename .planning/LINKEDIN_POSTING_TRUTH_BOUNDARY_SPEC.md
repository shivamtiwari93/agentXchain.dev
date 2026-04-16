# LinkedIn Posting Truth Boundary Spec

## Purpose

Define the success/failure contract for `marketing/post-linkedin.sh` so that ambiguous browser-automation submit outcomes are never reported as success without feed verification, including after the opposite-profile fallback attempt.

This mirrors the X/Twitter posting truth boundary (`X_POSTING_TRUTH_BOUNDARY_SPEC.md`) and is proven at the behavior level by executable fixture tests, not grep-level content assertions.

## Contract

### Success path (exit 0)

`post-linkedin.sh` may exit 0 only when:

1. `li-browser post create` exits 0 (clean success), OR
2. `li-browser post create` exits non-zero with the ambiguous-submit message ("composer remained open after clicking the submit control") on either the primary or fallback attempt AND `verify_linkedin_post_visible` confirms the post snippet on the company admin feed.

### Failure path (exit non-zero)

`post-linkedin.sh` must exit non-zero when:

1. `li-browser post create` exits non-zero with a non-ambiguous error (e.g., login failure, timeout, network error) and the fallback also fails, OR
2. `li-browser post create` exits non-zero with the ambiguous-submit message on either the primary or fallback attempt AND `verify_linkedin_post_visible` cannot find the post on the company admin feed, OR
3. Feed verification itself fails (login failure, page load error, etc.).

### Retry boundary

- On ambiguous submit during the primary attempt: **no retry** — verify company feed instead. Retrying risks duplicate posts.
- On non-ambiguous primary failure: **retry once** with the opposite browser profile, unless `AGENTXCHAIN_LINKEDIN_DISABLE_PROFILE_FALLBACK=1`.
- On ambiguous submit during the fallback attempt: **no second retry** — verify company feed and then exit success/failure based on proof.
- This matches the wrapper retry boundary documented in WAYS-OF-WORKING.md section 8.

### Feed verification

- Uses inline Python via `LIBROWSER_PYTHON` with `LiBrowser(headless=True, use_system_profile=...)` to navigate to `https://www.linkedin.com/company/{COMPANY_ID}/admin/page-posts/published/`.
- Extracts the first non-empty line of the post text (up to 120 chars) as the search snippet, normalizing internal whitespace and trimming leading/trailing spaces.
- Uses case-insensitive substring match against the page body text.
- Passes the same profile mode used for the post attempt.

### Profile defaults

- Primary mode: isolated profile (default, `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=0`).
- Fallback mode: opposite of primary.
- System profile opted in via `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1`.

## Acceptance Tests

- **AT-LIPOST-001**: Clean primary success exits 0 without triggering verification.
- **AT-LIPOST-002**: Ambiguous primary submit verifies company feed and exits 0 when post is found.
- **AT-LIPOST-003**: Ambiguous primary submit exits non-zero when feed verification misses, with no retry.
- **AT-LIPOST-004**: Non-ambiguous primary failure retries once with the opposite browser profile.
- **AT-LIPOST-005**: Ambiguous fallback submit verifies company feed before succeeding.
- **AT-LIPOST-006**: Ambiguous fallback submit exits non-zero when feed verification misses.
- **AT-LIPOST-007**: `AGENTXCHAIN_LINKEDIN_DISABLE_PROFILE_FALLBACK=1` prevents fallback retry on non-ambiguous failure.
- **AT-LIPOST-008**: System-profile primary uses `--system-profile` flag with isolated fallback.

All acceptance tests are proven by executable fixture tests in `cli/test/linkedin-posting-script.test.js` that spawn the real wrapper with fake `li-browser` and `python` binaries, assert exit codes, stderr messages, and exact call logs.

## Open Questions

None. The pattern is proven on both X/Twitter and LinkedIn.
