# Preflight-Before-Tag Release Identity Spec

## Purpose

Ensure that release identity (annotated git tag) is never created until the strict preflight checks that can run locally have already passed. This eliminates the manual tag-repair ritual observed in Turn 36, where `release-bump.sh` minted a `v2.50.0` tag before strict preflight discovered missing evidence-count lines in the release surfaces.

## Problem Statement

Current `release-bump.sh` flow:
1. Tree-state checks (steps 1-4)
2. Homebrew auto-align (step 5)
3. `npm version` bump (step 6)
4. Stage files (step 7)
5. Create release commit (step 8)
6. Create annotated tag (step 9)
7. **Then** operator manually runs `preflight:release:strict`

If preflight fails after step 9, the local tag exists on a commit that does not satisfy release truth. The operator must delete the tag, fix the surfaces, amend or create a new commit, and re-tag. This is fragile and error-prone.

## Solution

Insert a **critical preflight gate** between the release commit (step 8) and the annotated tag (step 9) inside `release-bump.sh`. The gate runs the subset of strict preflight checks that:
- can execute locally without a published artifact
- are deterministic and fast enough for inline execution
- would catch the class of failures observed (missing test assertions, stale docs, broken builds)

## Interface

### Modified `release-bump.sh` flow

```
Steps 1-8: unchanged (tree check, version check, tag check, surface alignment,
            Homebrew auto-align, npm version bump, stage, commit)

NEW Step 8.5: Inline preflight gate
  - Run: npm test (full test suite including release-surface guards)
  - Run: npm pack --dry-run (packability check)
  - Run: website-v2 build (docs build check)
  - If any check fails: print error, DO NOT create tag, exit 1
  - The release commit exists but is untagged — safe to amend or reset

Step 9: Create annotated tag (only reached if 8.5 passes)
```

### New flag: `--skip-preflight`

For recovery scenarios where the operator has already verified preflight manually and needs to tag an existing commit:
```bash
bash scripts/release-bump.sh --target-version 2.51.0 --skip-preflight
```

This flag skips step 8.5 only. All other checks (tree state, version surfaces, etc.) still run.

## Behavior

1. After the release commit is created but before the tag, `release-bump.sh` runs inline preflight checks.
2. The inline preflight reuses the same test infrastructure as `release-preflight.sh --strict` but runs it inline rather than as a separate manual step.
3. If tests fail, the script exits with code 1 and prints:
   ```
   PREFLIGHT FAILED — release commit created but NOT tagged.
   Fix the failures, amend the commit, and re-run release-bump.sh.
   ```
4. If tests pass, the tag is created as before.
5. The post-bump output no longer says "Next: npm run preflight:release:strict" because preflight already ran.

## Error Cases

- **Test failure after commit**: Commit exists, no tag. Operator fixes, amends commit, re-runs bump. No stale tag to clean up.
- **Docs build failure**: Same as test failure — commit exists, no tag.
- **Pack dry-run failure**: Same — commit exists, no tag.
- **`--skip-preflight` used when preflight would fail**: Operator's responsibility. The flag is an escape hatch, not a default.

## Acceptance Tests

- `AT-PBT-001`: `release-bump.sh` with passing tests creates both commit and tag.
- `AT-PBT-002`: `release-bump.sh` with a failing test creates the commit but NOT the tag, and exits with code 1.
- `AT-PBT-003`: `release-bump.sh --skip-preflight` creates both commit and tag without running inline tests.
- `AT-PBT-004`: The inline preflight runs the full `npm test` suite with `AGENTXCHAIN_RELEASE_TARGET_VERSION` and `AGENTXCHAIN_RELEASE_PREFLIGHT=1` environment variables set.
- `AT-PBT-005`: Post-success output does not instruct the operator to run preflight manually.

## Non-Scope

- Changing the CI publish workflow (it already runs preflight independently).
- Moving the Homebrew SHA check before tag (it is inherently post-publish).
- Changing the `release-preflight.sh` script itself (it remains available for standalone use).

## Decisions

- `DEC-RELEASE-PROCESS-005`: Release identity (annotated tag) must not be minted until inline preflight passes. The release commit may exist without a tag; the tag may not exist without passing preflight.
