# CI Release Completeness Gate Spec

## Purpose

Close two related gaps in the publish workflow:

1. the workflow can report success (`conclusion: success`) while canonical downstream surfaces remain stale
2. the workflow can discover that canonical tap completion is impossible only after mutating public release state

A green workflow must mean the release is fully complete across all distribution surfaces, and a first-time publish must fail before npm publication if canonical tap completion is impossible.

## Problem Statement

The current `publish-npm-on-tag.yml` workflow:

1. Publishes to npm registry — ✅ verified by `postflight:release`
2. Syncs Homebrew repo mirror — ✅ always runs
3. Pushes to canonical Homebrew tap — ⚠️ silently skipped if `HOMEBREW_TAP_TOKEN` absent
4. Creates GitHub Release — ❌ not done in CI at all
5. Runs `postflight:downstream` — ❌ not done in CI at all

When `HOMEBREW_TAP_TOKEN` is missing, two bad outcomes are possible:

1. the old behavior: the workflow completes with `conclusion: success` despite the canonical Homebrew tap still pointing to the previous version
2. the Turn 95 behavior: the workflow reports failure, but only after npm publication already happened

The second outcome is louder, but it still creates an avoidable partial release. The first publish attempt should stop before public mutation if canonical tap completion cannot happen in CI.

## Contract

**A green publish workflow means the release is complete across all distribution surfaces.**

If any downstream surface cannot be updated or verified, the workflow must fail with an explicit error annotation identifying the incomplete surface.

**A first-time publish attempt must fail before npm publication if the workflow cannot complete canonical tap truth.**

This prereq only applies to first-time publication. Verification reruns are allowed without `HOMEBREW_TAP_TOKEN` as long as downstream truth is already complete by the time the rerun reaches the final gate.

## Design

### Step 1: Detect whether this is a first publish or a rerun

The workflow already determines whether npm serves `agentxchain@<version>`.

- `already_published=false`: first publish attempt; public mutation has not happened yet
- `already_published=true`: rerun/verification mode; npm already serves the version

### Step 2: Canonical-tap prereq gate before first publish

Before `publish-from-tag.sh` runs:

1. If `already_published=false` and `HOMEBREW_TAP_TOKEN` is missing, fail immediately with `::error::`.
2. If `already_published=false` and the token is present, continue.
3. If `already_published=true`, skip the prereq gate. Reruns may rely on downstream truth already being fixed manually or by a previous run.

This prevents first-run partial releases while preserving safe recovery reruns.

### Step 3: Create GitHub Release in CI

Add a step after postflight that creates a GitHub Release using `gh release create`. This is possible because the workflow already has `contents: write` permission.

- Uses `gh release create v<version> --title "v<version>" --notes-file <rendered-body> --verify-tag`
- Idempotent: checks if release already exists before creating; if it exists, uses `gh release edit` with `--draft=false` to ensure pre-existing draft releases are promoted to published
- Runs after npm postflight passes (so the release links to a verified package)

### Step 4: Track canonical tap push status

The Homebrew sync step sets a step output `tap_pushed=true|false` based on whether `HOMEBREW_TAP_TOKEN` was available and `--push-tap` was passed.

### Step 5: Release completeness gate (final step)

A new final step that always runs when the workflow reaches post-publish verification:

1. Runs `postflight:downstream` with CI retry settings to verify all downstream surfaces are consistent.
2. Uses `tap_pushed` only for operator-facing messaging, not as a substitute for verification.
3. Allows a rerun with no token to pass if manual follow-through already fixed the canonical tap and GitHub Release truth.

This keeps the final gate authoritative instead of treating token presence as truth.

## Acceptance Tests

- `AT-RCG-001`: When `already_published=false` and `HOMEBREW_TAP_TOKEN` is absent, the workflow fails before `publish-from-tag.sh` runs.
- `AT-RCG-002`: When `HOMEBREW_TAP_TOKEN` is present, the workflow can publish and then runs `postflight:downstream` as the final gate.
- `AT-RCG-003`: The GitHub Release is created by CI, not left as a manual step.
- `AT-RCG-004`: A rerun of the workflow is safe (idempotent GitHub Release creation, idempotent Homebrew sync).
- `AT-RCG-005`: A rerun with `already_published=true` may pass without `HOMEBREW_TAP_TOKEN` if downstream truth already passes.
- `AT-RCG-006`: Token absence alone is not treated as downstream truth; the final gate still verifies the actual GitHub Release and canonical tap surfaces.

## Rejected Alternatives

- **Soft warning only (current behavior)**: Rejected because it produces a green workflow that hides an incomplete release. The v2.20.0 incident proves this is a real problem.
- **Allow first publish to proceed and fail only at the end**: Rejected because it still creates an avoidable partial release. Loud failure after mutation is better than silent success, but it is still weaker than prereq enforcement.
- **Separate downstream-verification workflow**: Rejected as unnecessary complexity — the publish workflow is the natural place for the completeness gate.

## Decision

`DEC-CI-COMPLETENESS-001`: A green publish workflow means all downstream surfaces are verified.

`DEC-CI-COMPLETENESS-004`: If `HOMEBREW_TAP_TOKEN` is missing on a first publish attempt, the workflow fails before npm publication. Partial release is not an acceptable default when the canonical tap cannot be completed.

`DEC-CI-COMPLETENESS-005`: Verification reruns may proceed without `HOMEBREW_TAP_TOKEN`, but they must still pass `postflight:downstream`. Token presence is not a proxy for downstream truth.
