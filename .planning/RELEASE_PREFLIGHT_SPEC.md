# Release Preflight Spec — v1

> Contract for the local release-readiness script at `cli/scripts/release-preflight.sh`.

---

## Purpose

Define the local, automatable checks that must run before cutting the governed `1.0.0` release. The script is not the release checklist itself; it is the operator shortcut for the subset of release criteria that can be verified from the CLI workspace without external credentials or GitHub/npm control-plane access.

This spec exists because the preflight script is release tooling and must follow the same spec-first discipline as the rest of the project.

---

## Interface/Schema

### Entry Points

```text
bash cli/scripts/release-preflight.sh
bash cli/scripts/release-preflight.sh --strict
cd cli && bash scripts/release-preflight.sh
cd cli && bash scripts/release-preflight.sh --strict
cd cli && npm run preflight:release
cd cli && npm run preflight:release:strict
```

### Output Contract

The script prints:

1. A short header identifying the check as local preflight
2. Six numbered checks in a stable order
3. A per-check status line using `PASS`, `FAIL`, or `WARN`
4. A final summary line with totals
5. An exit code:
   - `0` when all hard checks pass
   - `1` when any hard check fails

### Modes

The script supports two modes:

- default mode: rehearsal and pre-bump validation
- `--strict`: post-bump release-cut validation

### Check Set

The script MUST evaluate these checks in order:

1. Git working tree cleanliness
2. `npm ci --ignore-scripts`
3. `npm test`
4. `CHANGELOG.md` contains a `## 1.0.0` heading
5. `package.json` version equals `1.0.0`
6. `npm pack --dry-run`

---

## Behavior

### 1. Scope

The script is a **local preflight only**. It does not attempt to validate:

- live Anthropic/API credentials
- GitHub Actions enablement or branch protection
- npm publish permissions
- README quickstart behavior in a fresh external environment

Those remain governed by `V1_RELEASE_CHECKLIST.md`, `HUMAN_TASKS.md`, and the dogfood runbook.

### 2. Severity Rules

- `npm ci`, `npm test`, missing `CHANGELOG` entry, and failed `npm pack --dry-run` are hard failures
- dirty git state is a warning, not a hard failure
- `package.json` not yet at `1.0.0` is a warning, not a hard failure

In `--strict` mode:

- dirty git state becomes a hard failure
- `package.json !== "1.0.0"` becomes a hard failure

The intended operator flow is: run default preflight before `npm version 1.0.0`, then run strict preflight after the version bump and before pushing the release tag that triggers publish automation.

### 3. Failure Reporting

The script MUST continue through all six checks even if an earlier hard check fails, then exit non-zero at the end. This gives the operator a complete summary instead of stopping at the first failure.

### 4. Working Directory

The script MUST resolve its own directory and `cd` into the CLI package before running checks so it behaves the same regardless of the caller's starting directory.

### 5. Command Output

When a hard check fails, the script SHOULD print a short tail of the failing command output to make the failure actionable without flooding the terminal.

---

## Error Cases

| Condition | Behavior |
|---|---|
| Script invoked outside the repo but file exists | Resolve relative to script path and run from `cli/` |
| `git diff --quiet HEAD` fails because repo is missing or detached strangely | Surface as warning if cleanliness cannot be established |
| `npm ci --ignore-scripts` exits non-zero | Mark check as `FAIL`, print tail output, continue |
| `npm test` exits non-zero | Mark check as `FAIL`, print tail output, continue |
| `CHANGELOG.md` missing or lacks `## 1.0.0` | Mark check as `FAIL`, continue |
| `package.json` version is not `1.0.0` | Mark check as `WARN`, continue |
| `package.json` version is not `1.0.0` in `--strict` mode | Mark check as `FAIL`, continue |
| `npm pack --dry-run` exits non-zero | Mark check as `FAIL`, print tail output, continue |
| Working tree is dirty in `--strict` mode | Mark check as `FAIL`, continue |

---

## Acceptance Tests

1. Running `bash cli/scripts/release-preflight.sh` from the repo root executes all six checks and prints a final summary.
2. Running the script from inside `cli/` behaves identically except for relative path presentation.
3. If the working tree has uncommitted files but all hard checks pass, the script exits `0` and reports at least one warning.
4. If `npm test` fails, the script still completes checks 4-6 and exits `1`.
5. If `npm pack --dry-run` fails, the script exits `1` and does not incorrectly report that check as passed.
6. If `CHANGELOG.md` lacks `## 1.0.0`, the script exits `1`.
7. If `package.json` remains below `1.0.0`, the script reports a warning rather than a failure.
8. If the working tree is dirty in `--strict` mode, the script exits `1`.
9. If `package.json !== "1.0.0"` in `--strict` mode, the script exits `1`.
10. If the working tree is clean and `package.json === "1.0.0"` in `--strict` mode, the script exits `0` with no warnings from those checks.

---

## Open Questions

1. Should the script eventually verify tarball contents more strictly than `npm pack --dry-run`, for example by asserting expected key files?
2. Should `--strict` later add a git-tag verification check once the canonical cut flow is fully scripted?
