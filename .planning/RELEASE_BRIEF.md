# Release Brief — AgentXchain v2.1.0

> **SUPERSEDED.** This brief was written for v2.1.0 when it was the planned next release after v2.0.1. Neither v2.0.0, v2.0.1, nor v2.1.0 were ever published to npm. This file is preserved only as a historical snapshot of that abandoned release path. It is not a source of current release version, proof counts, or publish procedure.

~~`v2.1.0` is the active release identity on `main`. It is the next release after the corrective `v2.0.1` publish completes from `release/v2.0.1`.~~

## Pre-Conditions

1. `v2.0.1` must be published to npm first (currently blocked on npm authorization — see `HUMAN_TASKS.md`)
2. `release/v2.0.1` must be merged back into `main` per `MERGE_PLAN_V201.md`
3. Full test suite must pass on the merged result
4. Then `v2.1.0` can be cut from `main`

## What v2.1.0 Ships

Three features on top of the v2.0.x governed coordination base:

1. **Dispatch manifests** (V2.1-F1) — structured dispatch descriptors for turn assignment with provider routing and constraint propagation
2. **HTTP hooks + plugin hardening** (V2.1-F2) — JSON POST hook delivery with fail-closed timeout/auth handling, plus plugin config and upgrade hardening
3. **Dashboard evidence drill-down** (V2.1-F3) — expandable turn detail panels with hook annotations, decision ledger filters (phase, date, objection badges), and hook audit filters

All three features are implementation-complete and tested on `main`.

## Release Readiness

- Feature implementation: **complete** (all 3 V2.1 features shipped)
- Test suite: **1033 tests / 235 suites / 0 failures** (pre-merge count on main)
- Protocol: v6 normative spec (`PROTOCOL-v6.md`)
- Docs: quickstart, adapters, CLI, plugins, protocol pages all published
- Publish workflow: script-delegated architecture with postflight verification
- Blocked on: v2.0.1 npm publish → merge-back → v2.1.0 cut

## Canonical Release Sequence

```bash
cd cli

# 0. Pre-condition: v2.0.1 is published, release/v2.0.1 merged to main, tests green

# 1. Confirm clean workspace
git status --short

# 2. Run the full test suite
npm test

# 3. Run release preflight
bash scripts/release-preflight.sh --target-version 2.1.0

# 4. Bump version and create tag
npm version 2.1.0

# 5. Strict preflight after bump
bash scripts/release-preflight.sh --target-version 2.1.0 --strict

# 6. Push tag to trigger publish workflow
git push origin v2.1.0
# Workflow runs: publish-from-tag.sh → release-postflight.sh

# 7. After workflow completes, verify postflight
bash scripts/release-postflight.sh --target-version 2.1.0

# 8. Verify the registry serves the artifact
npm view agentxchain@2.1.0 version

# 9. Create GitHub release notes
# 10. Update Homebrew tap
```

GitHub release notes are published against the real artifact, after npm postflight passes. Not before.

## Where To Look

| Artifact | Purpose |
|----------|---------|
| `V2_1_SCOPE_BOUNDARY.md` | Frozen v2.1 scope |
| `PROTOCOL-v6.md` | Normative protocol spec |
| `MERGE_PLAN_V201.md` | Pre-merge conflict resolution plan |
| `HUMAN_TASKS.md` | Human-only tasks and blockers |
| `RELEASE_POSTFLIGHT_SPEC.md` | Post-publish verification contract |
| `V2_1_RELEASE_NOTES.md` | Draft GitHub release notes for `v2.1.0` |
| `cli/CHANGELOG.md` | Release delta entries |
| `cli/scripts/release-preflight.sh` | Pre-publish checks |
| `cli/scripts/release-postflight.sh` | Post-publish verification |
