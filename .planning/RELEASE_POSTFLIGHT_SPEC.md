# Release Postflight Spec

> Contract for the local release-verification script at `cli/scripts/release-postflight.sh`.

---

## Purpose

Define the automatable checks that run **after** a publish workflow succeeds or is retriggered. Preflight answers "is this workspace ready to cut?" Postflight answers "did the registry and executable artifact actually land?"

This exists because the repo already hit the exact failure mode this script guards against: git tags and release prose said `v2.0.0` / `v2.0.1`, but npm did not actually serve the release. Release governance that stops at tag push is incomplete.

---

## Interface

### Entry Points

```bash
cd cli && bash scripts/release-postflight.sh --target-version 2.0.1
cd cli && bash scripts/release-postflight.sh --target-version 2.0.1 --tag v2.0.1
cd cli && npm run postflight:release -- --target-version 2.0.1
```

### Optional Environment

```text
RELEASE_POSTFLIGHT_RETRY_ATTEMPTS      # optional, default 12
RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS # optional, default 10
```

### Output Contract

The script prints:

1. A short header identifying the check as release postflight
2. Eight numbered checks in a stable order
3. A per-check status line using `PASS` or `FAIL`
4. A summary line with totals
5. The resolved tarball URL and checksum metadata when available
6. Exit code:
   - `0` when all checks pass
   - `1` when any check fails

### Check Set

The script evaluates these checks in order:

1. Local git tag exists
2. npm registry serves `package@version`
3. Registry exposes `dist.tarball`
4. Registry exposes checksum metadata (`dist.integrity` or `dist.shasum`)
5. `npx` smoke: `npx --yes -p <package@version> -c '<bin-name> --version'`
   - The smoke check must run with an isolated temp `HOME` / npm cache / userconfig so cached global state or private registry config does not poison the result.
   - The smoke check must also run from an isolated temp working directory so the current repo does not affect npm package resolution.
   - Ambient `PATH` entries or previously installed global `agentxchain` binaries must not influence the result.
   - The parser must accept the expected version when `npx` prints extra npm notice lines before or after the version line.
6. Install smoke: `npm install --global --prefix <temp-prefix> <dist.tarball>` followed by explicit `<temp-prefix>/bin/agentxchain --version`
   - The smoke check must install the exact `dist.tarball` into an isolated temporary prefix and execute the installed binary by explicit path.
   - Ambient `PATH` entries or previously installed global `agentxchain` binaries must not influence the result.
7. Package export smoke from a clean consumer project
8. Operator front-door smoke from the published CLI binary
   - The smoke check must install the exact `dist.tarball` into an isolated temporary prefix.
   - It must execute `agentxchain init --governed --template cli-tool --goal "Release operator smoke" --dir <workspace> -y` with the installed binary, not the repo checkout.
   - It must then execute `agentxchain validate --mode kickoff --json` inside the freshly scaffolded workspace.
   - The validation result must parse as JSON and report `ok: true` with `protocol_mode: "governed"`.

---

## Behavior

### Scope

The script is a **local/networked postflight**. It intentionally depends on registry truth. It is not a pure offline workspace check like preflight.

### Failure Model

- The script is fail-closed: any missing registry signal or install-smoke mismatch exits non-zero.
- The script continues through all eight checks even if early ones fail so the operator gets a complete picture.
- A present git tag is not enough. The release remains incomplete until the registry and executable artifact both agree with the tag.
- Network-backed checks retry with a bounded budget because registry metadata and install resolution can lag the initial publish by several seconds.
- `npx` proof and tarball-install proof are intentionally separate. `npx` proves the public registry resolution path users copy from docs. Tarball-install proof proves the exact published artifact executes even when bypassing ambient PATH state.
- The operator front-door smoke is intentionally separate from raw install smoke. `--version` only proves the binary starts. `init` plus `validate` proves the published CLI can scaffold and validate the governed workflow operators are told to start with.

### Metadata Output

When `dist.tarball` and checksum metadata are available, the script prints them because they are immediate operator inputs for:

- GitHub release verification
- Homebrew formula update
- troubleshooting mismatched package identity

---

## Error Cases

| Condition | Behavior |
|---|---|
| `--target-version` omitted | Exit `1` with usage |
| `--target-version` is not semver | Exit `1` with usage |
| tag missing locally | Mark check as `FAIL`, continue |
| `npm view <pkg@version> version` returns 404 / auth error / empty output | Mark check as `FAIL`, continue |
| `dist.tarball` missing | Mark check as `FAIL`, continue |
| `dist.integrity` missing but `dist.shasum` present | Accept `dist.shasum` as fallback checksum metadata |
| `npx --yes -p agentxchain@<version> -c "agentxchain --version"` resolves a cached or wrong package | Mark check as `FAIL`, continue |
| operator uses `npx agentxchain@<version> --version` as proof | Treat it as ambiguous operator error, not release truth. The smoke contract must execute `agentxchain --version` via `npx -p ... -c ...` or equivalent `npm exec --package=... -- agentxchain --version`. |
| ambient `agentxchain` exists on runner PATH | Ignore it. Install smoke must execute the temp-prefix binary resolved from the published tarball, not the ambient PATH binary |
| ambient npm config points to a private registry | Ignore it. `npx` smoke must force `registry=https://registry.npmjs.org/` in isolated temp config |
| `npx` prints npm notice lines in addition to the version | Accept the smoke when one output line exactly matches the target version. Do not require the final line to be the version. |
| install smoke executes but prints wrong version | Mark check as `FAIL`, continue |
| install smoke fails entirely | Mark check as `FAIL`, continue |
| operator front-door smoke cannot scaffold a governed workspace | Mark check as `FAIL`, continue |
| operator front-door smoke emits invalid JSON from `validate --mode kickoff --json` | Mark check as `FAIL`, continue |
| operator front-door smoke reports `ok: false` or a non-governed protocol | Mark check as `FAIL`, continue |
| registry metadata appears shortly after publish | Retry bounded by `RELEASE_POSTFLIGHT_RETRY_ATTEMPTS` / `RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS` before failing |
| registry install smoke lags metadata on CI runners | Keep the workflow fail-closed, but allow a higher CI retry budget via environment instead of assuming the local default is sufficient |

---

## Acceptance Tests

1. The script rejects missing `--target-version`.
2. The script passes when the tag exists, the registry serves the target version, metadata is present, and install smoke returns the expected version.
3. The script fails when the registry does not yet serve the version and still evaluates the later checks.
4. The script fails when the `npx`-resolved CLI reports a mismatched version.
5. The script fails when the installed CLI reports a mismatched version.
6. The script retries registry metadata, `npx` smoke, and install smoke checks before failing closed.
7. The script ignores an older ambient `agentxchain` binary on `PATH` and still proves both the `npx` path and the published tarball path.
8. The script passes when `npx` prints the target version plus extra npm notice lines.
9. The script passes only when the published CLI can scaffold a governed workspace and `validate --mode kickoff --json` reports `ok: true`.
10. The script fails when operator front-door smoke returns invalid JSON or a failed governed validation result.

---

## Open Questions

1. Should postflight eventually verify the GitHub release asset/body as a sixth check, or stay npm-focused and keep GitHub release verification separate?
2. Should Homebrew formula verification become a second script after publish once the tap update path is stable?
