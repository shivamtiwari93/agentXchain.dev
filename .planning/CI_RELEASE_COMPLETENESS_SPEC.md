# CI Release Completeness Gate Spec

## Purpose

Close the gap where the publish workflow reports success (`conclusion: success`) while canonical downstream surfaces (GitHub Release, Homebrew tap) remain stale. A green workflow must mean the release is fully complete across all distribution surfaces, not just npm.

## Problem Statement

The current `publish-npm-on-tag.yml` workflow:

1. Publishes to npm registry — ✅ verified by `postflight:release`
2. Syncs Homebrew repo mirror — ✅ always runs
3. Pushes to canonical Homebrew tap — ⚠️ silently skipped if `HOMEBREW_TAP_TOKEN` absent
4. Creates GitHub Release — ❌ not done in CI at all
5. Runs `postflight:downstream` — ❌ not done in CI at all

When `HOMEBREW_TAP_TOKEN` is missing, the workflow completes with `conclusion: success` despite the canonical Homebrew tap still pointing to the previous version. This was the exact failure mode in the v2.20.0 release (Turn 94): CI went green, but `postflight:downstream` failed locally because the tap was stale.

## Contract

**A green publish workflow means the release is complete across all distribution surfaces.**

If any downstream surface cannot be updated or verified, the workflow must fail with an explicit error annotation identifying the incomplete surface.

## Design

### Step 1: Create GitHub Release in CI

Add a step after postflight that creates a GitHub Release using `gh release create`. This is possible because the workflow already has `contents: write` permission.

- Uses `gh release create v<version> --title "v<version>" --notes "..."` with auto-generated notes
- Idempotent: checks if release already exists before creating
- Runs after npm postflight passes (so the release links to a verified package)

### Step 2: Track canonical tap push status

The Homebrew sync step sets a step output `tap_pushed=true|false` based on whether `HOMEBREW_TAP_TOKEN` was available and `--push-tap` was passed.

### Step 3: Release completeness gate (final step)

A new final step that:

1. If `tap_pushed=false`: immediately fails with `::error::` annotation: "Release incomplete: HOMEBREW_TAP_TOKEN not configured. Canonical Homebrew tap was not updated."
2. If `tap_pushed=true`: runs `postflight:downstream` with CI retry settings to verify all downstream surfaces are consistent.
3. Either way, the workflow result reflects actual release completeness.

## Acceptance Tests

- `AT-RCG-001`: When `HOMEBREW_TAP_TOKEN` is absent, the workflow must fail (not succeed) after npm publication.
- `AT-RCG-002`: When `HOMEBREW_TAP_TOKEN` is present and canonical tap is pushed, the workflow runs `postflight:downstream` as the final gate.
- `AT-RCG-003`: The GitHub Release is created by CI, not left as a manual step.
- `AT-RCG-004`: A rerun of the workflow is safe (idempotent GitHub Release creation, idempotent Homebrew sync).
- `AT-RCG-005`: npm publication is NOT blocked by downstream failures — the package is always published first.

## Rejected Alternatives

- **Soft warning only (current behavior)**: Rejected because it produces a green workflow that hides an incomplete release. The v2.20.0 incident proves this is a real problem.
- **Block npm publication on missing `HOMEBREW_TAP_TOKEN`**: Rejected because npm is the primary distribution channel and should not be gated on a Homebrew secret.
- **Separate downstream-verification workflow**: Rejected as unnecessary complexity — the publish workflow is the natural place for the completeness gate.

## Decision

`DEC-CI-COMPLETENESS-001`: A green publish workflow means all downstream surfaces are verified. Missing `HOMEBREW_TAP_TOKEN` causes the workflow to fail after npm publication, not silently degrade.
