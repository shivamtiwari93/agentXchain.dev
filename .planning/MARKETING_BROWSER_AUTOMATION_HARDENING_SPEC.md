# Marketing Browser Automation Hardening Spec

## Purpose

Repair the repo-owned social-posting wrappers so they reflect the real browser-tool runtime boundaries instead of relying on brittle assumptions.

Two concrete problems were observed in live release posting:

1. `post-linkedin.sh` forced `li-browser --system-profile`, but the `li-browser` isolated profile is already logged in and the system-profile launch path is lock-prone on macOS when Chrome is already running.
2. `post-twitter.sh` and `post-linkedin.sh` both assumed `source .venv/bin/activate` was enough to guarantee the CLI binary exists on `PATH`. That is not a stable contract.

## Interface

### `marketing/post-linkedin.sh`

- Must invoke the repo-local binary directly at `.../li-browser/.venv/bin/li-browser`.
- Must default to the isolated `li-browser` profile.
- May opt back into `--system-profile` only when `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1`.

### `marketing/post-twitter.sh`

- Must invoke the repo-local binary directly at `.../x-browser/.venv/bin/x-browser`.
- Must keep supporting `--system-profile` by default because the isolated `x-browser` profile is not logged in in the current environment.
- Must support `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0` to let operators use the isolated `x-browser` profile after logging in there.
- Must fail with a precise preflight message when:
  - `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=1`
  - Google Chrome is already running
  - and there is no live `x-browser` DevTools session advertised via `~/.config/x-browser/chrome.port`

## Behavior

- LinkedIn posting should prefer the path that is actually working in this environment: the isolated `li-browser` profile.
- X posting should stop failing with a vague DevTools timeout when the real cause is a locked live system Chrome profile.
- Durable repo docs (`WAYS-OF-WORKING.md`, `HUMAN_TASKS.md`) must describe the updated LinkedIn default and the X override/boundary truthfully.

## Error Cases

- Missing repo-local browser binary: fail fast with a direct path-specific message.
- X system-profile preflight conflict: fail before launching the browser with a message that says Chrome is already running and explains the two real recovery paths:
  - close Chrome and retry with system profile
  - or log into the isolated `x-browser` profile once and rerun with `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0`
- LinkedIn isolated profile logged out in a future environment: the script may fail downstream, but the wrapper must not silently force the more fragile system-profile path.

## Acceptance Tests

- `AT-MBAH-001`: spec exists in `.planning/`.
- `AT-MBAH-002`: `post-linkedin.sh` invokes the repo-local `li-browser` binary directly and defaults to isolated-profile mode.
- `AT-MBAH-003`: `post-twitter.sh` invokes the repo-local `x-browser` binary directly and exposes `AGENTXCHAIN_X_USE_SYSTEM_PROFILE`.
- `AT-MBAH-004`: `post-twitter.sh` contains the Chrome-lock preflight and references `~/.config/x-browser/chrome.port`.
- `AT-MBAH-005`: `WAYS-OF-WORKING.md` and `HUMAN_TASKS.md` describe LinkedIn isolated-profile default truthfully and do not claim it always uses `--system-profile`.

## Open Questions

- Should a later slice add a repo-owned `x-browser` profile bootstrap flow so X can also stop depending on the live system Chrome profile?
