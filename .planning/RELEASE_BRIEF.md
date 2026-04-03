# Release Brief — AgentXchain v2.0.1

Purpose: give the release branch a truthful handoff document for the corrective `v2.0.1` publish.

## Current Status

`v2.0.1` is the active release identity on this branch.

- `cli/package.json`: `2.0.1`
- Git tag: `v2.0.1` exists and is already pushed
- Publish workflow shape: fixed
- Remaining blocker: `NPM_TOKEN` is invalid/expired (`npm whoami` returns `401 Unauthorized`)
- Release is **not complete** until npm registry truth is verified after a successful rerun

## What v2.0.1 Is

`v2.0.1` is a corrective release for the v2 line. It does not redefine the v2 surface. It fixes release execution so the already-built v2 product can actually be published and verified.

Primary corrective scope:

1. Publish workflow reliability and trusted-publishing fallback handling
2. CI portability fixes for publish tests
3. Release-governance hardening so tags and prose are not treated as shipment without registry proof

Functional v2 surface already present in `2.0.0`:

1. Multi-repo coordinator governance
2. Local dashboard multi-repo integration
3. Plugin system phase 1 plus built-in plugins
4. Protocol v6 and docs alignment

## Canonical Recovery Sequence

Because the tag already exists, this is **not** a fresh `npm version` cut. The required sequence is:

```bash
# 1. Human updates the invalid token in .env and GitHub Actions secrets

# 2. Agent retriggers publish on the existing tag
gh workflow run publish-npm-on-tag.yml -f tag=v2.0.1

# 3. Agent waits for the workflow to pass
gh run watch

# 4. Agent verifies registry truth after workflow success
cd cli
bash scripts/release-postflight.sh --target-version 2.0.1

# 5. Agent updates follow-through surfaces only after postflight passes
#    - GitHub release
#    - Homebrew tap formula
#    - final release announcement
```

## Completion Criteria

Do not call `v2.0.1` released until all of these are true:

1. GitHub Actions publish workflow succeeds for tag `v2.0.1`
2. `bash scripts/release-postflight.sh --target-version 2.0.1` passes
3. `npm view agentxchain@2.0.1 version` returns `2.0.1`
4. `npm exec --yes --package agentxchain@2.0.1 -- agentxchain --version` returns `2.0.1`
5. Homebrew tap points at the published `2.0.1` tarball and SHA256
6. GitHub release notes are published against the real artifact, not ahead of it

## Notes

- `LAUNCH_BRIEF.md` is the public-facing copy source. This document is the release-operations handoff.
- The previous `RELEASE_BRIEF.md` content was stale `1.1.0` prose. That was a defect. Release docs are part of the governed product, not optional cleanup.
