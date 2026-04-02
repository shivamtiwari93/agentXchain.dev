# Release Preflight vNext Spec — Version-Parameterized Preflight

> Contract for evolving `cli/scripts/release-preflight.sh` to support multiple release versions without per-version script forks.

---

## Purpose

The original `release-preflight.sh` was hardcoded for the `1.0.0` release: it checked for `## 1.0.0` in the changelog, validated `package.json === "1.0.0"`, and printed `v1.0.0` in its banner. This spec freezes the replacement contract so the same script can serve `1.0.0`, `1.1.0`, and future cuts without duplicating the file or requiring manual find-and-replace edits that introduce drift risk.

This spec defines the version-parameterization contract so that:

1. The existing `1.0.0` flow continues unchanged when no flag is passed.
2. The `1.1.0` cut (and all future cuts) can reuse the same script with a `--target-version` flag.
3. The script remains a local preflight tool — it does not gain release-execution, publish, or registry responsibilities.

---

## Interface/Schema

### Entry Points

```text
# Current v1.0.0 flow (backward-compatible, no change required)
bash cli/scripts/release-preflight.sh
bash cli/scripts/release-preflight.sh --strict

# Future v1.1.0 flow
bash cli/scripts/release-preflight.sh --target-version 1.1.0
bash cli/scripts/release-preflight.sh --target-version 1.1.0 --strict

# npm scripts (current aliases, unchanged)
cd cli && npm run preflight:release
cd cli && npm run preflight:release:strict
```

### Flag Behavior

```text
--target-version <semver>   Target release version. Defaults to "1.0.0" when omitted.
--strict                    Post-bump validation mode (unchanged from v1 spec).
```

Flags may appear in any order. `--target-version` requires exactly one argument in valid semver format (`MAJOR.MINOR.PATCH`). Invalid semver is a hard error with exit 1.

### Version-Dependent Check Parameters

The target version determines exactly two parameterized values:

| Parameter | Derived from `--target-version` | Example for `1.1.0` |
|---|---|---|
| `CHANGELOG_HEADING` | `## <target-version>` | `## 1.1.0` |
| `EXPECTED_PKG_VERSION` | `<target-version>` | `1.1.0` |

Everything else — git cleanliness, `npm ci`, `npm test`, `npm pack --dry-run` — is version-independent and unchanged.

### Output Contract (unchanged, extended)

The script prints:

1. A header identifying the check and the **target version** (e.g., `AgentXchain v1.1.0 Release Preflight`)
2. Six numbered checks in the same stable order as v1
3. Per-check status: `PASS`, `FAIL`, or `WARN`
4. Final summary with totals
5. Exit code: `0` when all hard checks pass, `1` when any hard check fails

---

## Behavior

### 1. Default Version

When `--target-version` is omitted, the script defaults to `1.0.0`. This preserves exact backward compatibility: any existing operator workflow or CI job that invokes `release-preflight.sh` without the new flag sees identical behavior.

This default is intentionally **not** read from `package.json`. Auto-reading the current package version would silently remove the existing pre-bump mismatch signal, which is one of the main reasons the default-mode preflight is useful before `npm version 1.0.0`.

### 2. Check Set (unchanged order, parameterized values)

1. **Git working tree cleanliness** — version-independent
2. **`npm ci --ignore-scripts`** — version-independent
3. **`npm test`** — version-independent
4. **CHANGELOG heading** — checks for `## <target-version>` instead of hardcoded `## 1.0.0`
5. **Package version** — compares `package.json` version against `<target-version>` instead of hardcoded `1.0.0`
6. **`npm pack --dry-run`** — version-independent

### 3. Severity Rules (unchanged, parameterized)

Default mode:
- Checks 2, 3, 4, 6 are hard failures
- Check 1 (dirty tree) is a warning
- Check 5 (`package.json !== <target-version>`) is a warning

Strict mode:
- All six checks are hard failures

### 4. Banner And Messaging

The banner line changes from:

```
AgentXchain v1.0.0 Release Preflight
```

to:

```
AgentXchain v<target-version> Release Preflight
```

When the target version is `1.0.0`, the script keeps the existing human-tasks line exactly:

```
Human-gated release items remain in .planning/V1_RELEASE_CHECKLIST.md.
```

For `1.1.0` and above, the line becomes:

```
Human-gated release items remain in .planning/V1_RELEASE_CHECKLIST.md (v1.0) or .planning/V1_1_RELEASE_CHECKLIST.md (v1.1+).
```

### 5. npm Script Aliases

The existing `package.json` scripts remain unchanged for the `1.0.0` path:

```json
"preflight:release": "bash scripts/release-preflight.sh",
"preflight:release:strict": "bash scripts/release-preflight.sh --strict"
```

No new npm scripts are added. The `--target-version` flag is passed directly by the operator or by future CI configuration. Adding version-specific npm aliases (e.g., `preflight:release:1.1`) is deferred — the flag is sufficient.

### 6. Scope Exclusions

The following remain **out of scope** for release-preflight, regardless of version:

- Schema-migration smoke checks (covered by test suite and specs)
- Live API credential validation
- GitHub Actions / branch protection checks
- npm publish permissions or registry availability
- Homebrew formula verification
- Any release-execution action (version bump, publish, tag)
- A dedicated `--dry-run` preview mode. The script is already read-only, and the banner plus per-check output provide sufficient operator visibility without adding a second execution path.

---

## Error Cases

| Condition | Behavior |
|---|---|
| `--target-version` with no argument | Print usage, exit 1 |
| `--target-version` with invalid semver (e.g., `v1.1.0`, `1.1`, `abc`) | Print "Invalid semver: <value>", exit 1 |
| `--target-version` used with a version that has no CHANGELOG entry | Check 4 reports `FAIL` — this is expected pre-authoring behavior, not a script error |
| Unknown flag (not `--strict`, not `--target-version`) | Print usage, exit 1 |
| Both `--strict` and `--target-version` used together | Both apply; strict mode uses the specified target version |
| `--target-version` passed twice | Last value wins (standard shell convention) |

All v1 error cases from `RELEASE_PREFLIGHT_SPEC.md` remain unchanged.

---

## Acceptance Tests

### Backward Compatibility

1. Running `bash cli/scripts/release-preflight.sh` with no flags produces output identical to the current v1 script (banner says `v1.0.0`, checks for `## 1.0.0`, compares package version to `1.0.0`).
2. Running `bash cli/scripts/release-preflight.sh --strict` behaves identically to the current strict mode.
3. Existing `npm run preflight:release` and `npm run preflight:release:strict` work unchanged.

### Version Parameterization

4. Running `--target-version 1.1.0` prints `AgentXchain v1.1.0 Release Preflight` in the banner.
5. Running `--target-version 1.1.0` checks for `## 1.1.0` in CHANGELOG.md (not `## 1.0.0`).
6. Running `--target-version 1.1.0` compares `package.json` version against `1.1.0`.
7. Running `--target-version 1.1.0 --strict` enforces strict mode against the `1.1.0` expectations.
8. Running `--target-version 2.0.0` works for any future valid semver without script changes.

### Error Handling

9. Running `--target-version` with no argument exits 1 with a usage message.
10. Running `--target-version v1.1.0` (leading `v`) exits 1 with an invalid-semver message.
11. Running `--target-version 1.1` (missing patch) exits 1 with an invalid-semver message.
12. Running `--unknown-flag` exits 1 with a usage message.

### Invariants

13. Version-independent checks (git clean, npm ci, npm test, npm pack) are unaffected by the `--target-version` value.
14. The script never executes release actions (no `npm version`, no `npm publish`, no git tag creation).

---

## Implementation Sketch

The change is minimal. The script gains ~15 lines:

```bash
# Defaults
TARGET_VERSION="1.0.0"

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      shift
      ;;
    --target-version)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --target-version requires a semver argument"; exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Invalid semver: $2"; exit 1
      fi
      TARGET_VERSION="$2"
      shift 2
      ;;
    *)
      echo "Usage: bash scripts/release-preflight.sh [--strict] [--target-version <semver>]"
      exit 1
      ;;
  esac
done
```

Then replace the two hardcoded references:

- `grep -q "^## 1.0.0"` → `grep -q "^## ${TARGET_VERSION}"`
- `[ "$PKG_VERSION" = "1.0.0" ]` → `[ "$PKG_VERSION" = "${TARGET_VERSION}" ]`
- Banner: `echo "AgentXchain v1.0.0 Release Preflight"` → `echo "AgentXchain v${TARGET_VERSION} Release Preflight"`

---

## Open Questions

None for this slice. The default remains an explicit `1.0.0`, and `--dry-run` is intentionally deferred out of scope.
