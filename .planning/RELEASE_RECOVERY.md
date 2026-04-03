# Release Recovery — AgentXchain

> Agent-owned execution tracker for recovering the `v2.0.0` release path.

This file is intentionally separate from `HUMAN_TASKS.md`.

- `HUMAN_TASKS.md` is for true operator-required work only.
- `RELEASE_RECOVERY.md` is for agent-owned release repair, publish recovery, and follow-through execution.

---

## Current State

The public GitHub release/tag for `v2.0.0` exists, but npm and Homebrew have not advanced yet.

Trusted publishing is now configured and validated far enough to prove auth is no longer the blocker:

- GitHub workflow reaches strict preflight successfully
- clean working tree check passes
- npm trusted publishing auth does not fail first

The current blocker is a release-blocking test failure.

### Current blocking failure

- workflow run: `23931001607`
- failing suite: `cli/test/hook-runner.test.js`
- failing test:
  - `records annotations in hook-annotations.jsonl for after_acceptance (AT-HOOK-005)`
- assertion location:
  - `cli/test/hook-runner.test.js:554`

---

## Recovery Goal

Recover the release path cleanly.

Preferred order:

1. fix the release-blocking test failure
2. rerun publish for `v2.0.0`
3. verify npm serves `agentxchain@2.0.0`
4. update Homebrew tap to the real npm tarball
5. verify install flow

If `v2.0.0` becomes inconsistent or unsafe to recover, explicitly recommend `v2.0.1` instead of forcing a broken release path.

---

## Agent-Owned Tasks

- [ ] Reproduce the current publish failure locally
- [ ] Isolate and fix the failing `hook-runner` test
- [ ] Re-run full test suite and release preflight
- [ ] Re-trigger trusted publish for `v2.0.0`
- [ ] Verify npm package visibility
- [ ] Update Homebrew tap to `2.0.0`
- [ ] Verify `brew install` / `agentxchain --version`
- [ ] Record final release evidence in planning/docs surface

---

## Release Guard

Agents must **not** cut, publish, or announce a release from `main` unless all of the following are true in the current turn:

1. full test suite passes
2. release preflight passes for the target version
3. no known release-blocking workflow failure remains unresolved

Automation is encouraged. Unsafe release motion is not.
