# Release Social Posting Spec

## Purpose

Define the operator-truth contract for `marketing/post-release.sh` so release automation, tests, and collaboration guidance agree on which channels a release announcement must hit.

## Interface

Command:

```bash
bash marketing/post-release.sh "vX.Y.Z" "one-line summary"
```

Inputs:

- `VERSION`: required semver tag prefixed with `v`
- `SUMMARY`: required one-line release summary

Dependencies:

- `marketing/post-twitter.sh`
- `marketing/post-linkedin.sh`
- `marketing/post-reddit.sh`

## Behavior

- `post-release.sh` derives the public release-notes URL from the hyphenated docs route form (`v2.66.1` -> `/docs/releases/v2-66-1`).
- The script must attempt all three release channels:
  - X/Twitter
  - LinkedIn
  - Reddit
- X/Twitter remains part of the release-posting contract even though the website no longer links to the previously suspended public profile. The active posting surface is `@agentxchaindev`.
- Each channel wrapper remains a pure wrapper around its browser automation tool. `post-release.sh` owns the message composition and URL generation.
- If one channel fails, the script must continue attempting the remaining channels, report per-channel success/failure, and exit non-zero after all attempts complete.

## Error Cases

- Missing `VERSION` or `SUMMARY`: exit with usage error.
- One or more channel failures: finish the remaining attempts, then exit non-zero.
- Wrapper-specific login/CAPTCHA/browser failures: surface them as channel failures without suppressing the other channels.

## Acceptance Tests

- `cli/test/post-release-script.test.js` asserts:
  - release URLs use the hyphenated docs route on `https://agentxchain.dev`
  - `post-release.sh` delegates to `post-twitter.sh`, `post-linkedin.sh`, and `post-reddit.sh`
  - wrapper scripts remain pure wrappers and do not generate release URLs themselves

## Open Questions

- None.
