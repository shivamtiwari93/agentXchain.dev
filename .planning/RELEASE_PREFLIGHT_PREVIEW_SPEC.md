# Release Preflight Preview Spec

## Purpose

Close the release-prep usability gap exposed during the `v2.130.1` patch cut.

The repo already had a hard release-alignment gate, but it only surfaced as a failing preflight after the version/tag path was already in motion. That is too late for routine operator use. The missing capability is not another ad hoc checklist. It is a manifest-backed preview that prints the exact manual release surfaces and their current status before a tag push.

This spec adds a preview mode without weakening the real gate.

## Interface

### Release preflight preview

```bash
bash cli/scripts/release-preflight.sh --dry-run --target-version 2.130.1
cd cli && bash scripts/release-preflight.sh --dry-run --target-version 2.130.1
```

Flags:

- `--dry-run`
  - Preview mode. Prints the manual release-alignment surface report and exits without running the full preflight checks.
- `--target-version <semver>`
  - Required for meaningful preview use. The existing fallback default still applies when omitted.

`--dry-run` is mutually exclusive with:

- `--strict`
- `--publish-gate`

### Alignment report

```bash
node cli/scripts/check-release-alignment.mjs --scope prebump --target-version 2.130.1 --report
```

The validator script gains a human-readable report mode that lists every applicable release surface, whether it is ready, and the specific file-level issues when it is not.

## Behavior

### 1. Preview mode is informational, not the gate

`release-preflight.sh --dry-run`:

- does **not** run git-clean, `npm ci`, `npm test`, `CHANGELOG`, package-version, or `npm pack` checks
- does **not** mutate any file
- does **not** fail because release surfaces still need updates
- exits `0` after printing the report, unless invocation itself is invalid or the report generator cannot run

The real preflight gate remains the existing default / `--strict` / `--publish-gate` paths.

### 2. Preview scope is `prebump`

The preview must use the existing release-alignment manifest in `prebump` scope so it reports the manual surfaces that should already be aligned before the release cut:

- changelog
- release notes
- homepage version/proof
- conformance/version examples
- launch evidence
- marketing drafts
- `llms.txt`

It must **not** preview `current`-only Homebrew mirror surfaces, because those are post-bump / post-publish alignment checks and create noise before the cut.

### 3. Report output

`check-release-alignment.mjs --report` prints:

1. header with target version, scope, and checked surface count
2. one line per checked surface
3. `ready` vs `needs update` status per surface
4. indented issue lines for every failing surface
5. a final summary count

The report must include ready surfaces, not only failures. The entire point is to show the full required set up front.

### 4. Missing files are surface errors, not stack traces

If a release surface file is missing, unreadable, or throws during validation:

- the validator must record that as a surface-level error
- the report must remain printable
- the process must not crash with an uncaught stack trace

### 5. Exit-code behavior

- `check-release-alignment.mjs --report` keeps validator semantics:
  - exit `0` when all checked surfaces are ready
  - exit `1` when any checked surface needs update
- `release-preflight.sh --dry-run` intentionally overrides that into preview semantics:
  - exit `0` even when the report shows pending surface work
  - exit `1` only for invalid flag combinations, invalid semver, or report-runner failure

## Error Cases

| Condition | Behavior |
|---|---|
| `--dry-run` used with `--strict` | print usage + conflict error, exit `1` |
| `--dry-run` used with `--publish-gate` | print usage + conflict error, exit `1` |
| release-alignment report contains stale surfaces | preview prints them and exits `0` |
| a required file is missing | report shows that surface as `needs update`; no uncaught exception |
| alignment script missing from disk | preview exits `1` with actionable error |

## Acceptance Tests

1. `release-preflight.sh --dry-run --target-version <semver>` exits `0` even when multiple prebump surfaces are stale.
2. The dry-run output includes the full checked-surface list, not only the failures.
3. `check-release-alignment.mjs --report` prints both ready and failing surfaces in a stable, human-readable format.
4. A missing release surface file is reported as a surface error instead of crashing the validator.
5. `--dry-run` rejects `--strict` and `--publish-gate` combinations with exit `1`.

## Open Questions

None. This slice is intentionally narrow: operator preview for existing release truth, not a new checklist system.
