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

What is now proven:

- npm does **not** currently serve `agentxchain@2.0.0`
- the public `v2.0.0` tag still points to commit `ae9c166`
- `main` is 16 commits ahead at `f0a4c44` and includes both release fixes and additional v2.1 feature work
- re-running the publish workflow against `v2.0.0` checks out the broken tag again; it does **not** publish the fixes sitting on `main`

### Last validated failing publish run

- workflow run: `23931001607`
- tag/ref under test: `v2.0.0`
- failure mode:
  - strict preflight reached `npm test`
  - full suite failed on `cli/test/hook-runner.test.js`
  - failing test:
    - `records annotations in hook-annotations.jsonl for after_acceptance (AT-HOOK-005)`
  - assertion location:
    - `cli/test/hook-runner.test.js:554`

### Recovery decision

`v2.0.0` should **not** be recovered by force-moving the public tag.

Why:

- the tag is already public on GitHub
- the tag commit is still the failing payload used by the publish workflow
- `main` now contains material post-release feature work (dispatch manifests, plugin hardening, HTTP hooks), so retagging `v2.0.0` to `main` would silently change released contents

The clean recovery path is a corrective release from the `v2.0.0` lineage: **`v2.0.1`**.

---

## Recovery Goal

Recover the release path cleanly without rewriting public release history.

Preferred order:

1. branch from `v2.0.0`
2. backport only the release-recovery fixes needed for green CI + trusted publishing
3. bump CLI version to `2.0.1`
4. tag and publish `v2.0.1`
5. verify npm serves `agentxchain@2.0.1`
6. update Homebrew tap to the real npm tarball
7. verify install flow

`v2.0.0` is now considered unsafe to salvage in place.

---

## Agent-Owned Tasks

- [x] Reproduce the current publish failure from workflow evidence
- [x] Validate that `agentxchain@2.0.0` is absent from npm
- [x] Validate that `main` fixes are not part of the public `v2.0.0` tag payload
- [ ] Create a `v2.0.1` recovery branch from `v2.0.0`
- [ ] Backport the minimal release fixes:
  - hook test portability / concurrency hardening
  - benign stdin `EPIPE` handling
  - trusted publishing workflow + script updates
  - publish-from-tag test alignment for trusted publishing fallback
- [ ] Bump CLI version and changelog to `2.0.1`
- [ ] Re-run full test suite and strict release preflight on the recovery branch
- [ ] Tag and publish `v2.0.1`
- [ ] Verify npm package visibility
- [ ] Update Homebrew tap to `2.0.1`
- [ ] Verify `brew install` / `agentxchain --version`
- [ ] Record final release evidence in planning/docs surface

---

## Release Guard

Agents must **not** cut, publish, or announce a release from `main` unless all of the following are true in the current turn:

1. full test suite passes
2. release preflight passes for the target version
3. no known release-blocking workflow failure remains unresolved

Automation is encouraged. Unsafe release motion is not.
