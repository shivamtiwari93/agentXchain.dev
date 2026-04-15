# Marketing Browser Automation Hardening Spec

## Purpose

Repair the repo-owned social-posting wrappers so they reflect the real browser-tool runtime boundaries instead of relying on brittle assumptions.

Three concrete problems were observed in live release posting:

1. `post-linkedin.sh` forced `li-browser --system-profile`, but the `li-browser` isolated profile is already logged in and the system-profile launch path is lock-prone on macOS when Chrome is already running.
2. `post-twitter.sh` and `post-linkedin.sh` both assumed `source .venv/bin/activate` was enough to guarantee the CLI binary exists on `PATH`. That is not a stable contract.
3. Both wrappers treated every non-zero exit as retry-safe, but the browser tools have ambiguous post-submit failure modes where blindly retrying can create duplicate posts.

## Interface

### `marketing/post-linkedin.sh`

- Must invoke the repo-local binary directly at `.../li-browser/.venv/bin/li-browser`.
- Must default to the isolated `li-browser` profile.
- May opt back into `--system-profile` only when `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1`.
- Must verify ambiguous `composer remained open after clicking the submit control` failures against the company admin feed before declaring failure or retrying.
- Must not blindly retry ambiguous post-submit failures that could already have published the post.
- May retry once with the opposite profile only for non-ambiguous failures.

### `marketing/post-twitter.sh`

- Must invoke the repo-local binary directly at `.../x-browser/.venv/bin/x-browser`.
- Must keep supporting `--system-profile` by default because the isolated `x-browser` profile is not logged in in the current environment.
- Must support `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0` to let operators use the isolated `x-browser` profile after logging in there.
- Must retry once with the opposite profile for non-ambiguous failures instead of repeating the same failed mode.
- Must suppress automatic retries when the tool reports an ambiguous post-submit state like `still on compose page after clicking Post`, because that can double-post.
- Must fail with a precise preflight message when:
  - `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=1`
  - Google Chrome is already running
  - and there is no live `x-browser` DevTools session advertised via `~/.config/x-browser/chrome.port`

## Behavior

- LinkedIn posting should prefer the path that is actually working in this environment: the isolated `li-browser` profile.
- LinkedIn ambiguous submit failures should trigger a read-only verification pass against the company admin feed using a stable snippet from the attempted post body. A verified visible post is success, not failure.
- LinkedIn should only switch profiles after a non-ambiguous failure. Ambiguous submit states must fail closed after verification to avoid duplicates.
- X posting should stop failing with a vague DevTools timeout when the real cause is a locked live system Chrome profile.
- X retries should try a materially different path (alternate profile) instead of rerunning the same contract and hoping for a different result.
- Durable repo docs (`WAYS-OF-WORKING.md`, `HUMAN_TASKS.md`) must describe the updated LinkedIn default, ambiguous-submit verification, and the X override/boundary truthfully.

## Error Cases

- Missing repo-local browser binary: fail fast with a direct path-specific message.
- X system-profile preflight conflict: fail before launching the browser with a message that says Chrome is already running and explains the two real recovery paths:
  - close Chrome and retry with system profile
  - or log into the isolated `x-browser` profile once and rerun with `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0`
- LinkedIn ambiguous composer-open result: verify the post on the company admin page and suppress auto-retry if the post cannot be disproven.
- LinkedIn isolated profile logged out in a future environment: the script may fail downstream, but the wrapper must not silently force the more fragile system-profile path unless it is doing a single explicit fallback attempt.

## Acceptance Tests

- `AT-MBAH-001`: spec exists in `.planning/`.
- `AT-MBAH-002`: `post-linkedin.sh` invokes the repo-local `li-browser` binary directly and defaults to isolated-profile mode.
- `AT-MBAH-003`: `post-twitter.sh` invokes the repo-local `x-browser` binary directly and exposes `AGENTXCHAIN_X_USE_SYSTEM_PROFILE`.
- `AT-MBAH-004`: `post-twitter.sh` contains the Chrome-lock preflight and references `~/.config/x-browser/chrome.port`.
- `AT-MBAH-005`: `WAYS-OF-WORKING.md` and `HUMAN_TASKS.md` describe LinkedIn isolated-profile default truthfully and do not claim it always uses `--system-profile`.
- `AT-MBAH-006`: `post-linkedin.sh` contains an ambiguous-submit verification path and suppresses automatic retries when the post might already be live.
- `AT-MBAH-007`: both wrappers can retry once with the opposite browser profile on non-ambiguous failure.
- `AT-MBAH-008`: both wrappers preserve the real non-zero exit status from their browser-tool invocation instead of collapsing failures to `0` through shell-control-flow.

## Open Questions

- Should a later slice add a repo-owned `x-browser` verification step against the authenticated timeline so ambiguous X submit states can be resolved without operator inspection?
