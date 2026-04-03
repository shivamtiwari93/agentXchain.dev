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
cd cli && npm run postflight:release
```

### Optional Environment

```text
RELEASE_POSTFLIGHT_RETRY_ATTEMPTS      # optional, default 6
RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS # optional, default 10
```

### Output Contract

The script prints:

1. A short header identifying the check as release postflight
2. Five numbered checks in a stable order
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
5. Install smoke: `npm exec --yes --package <package@version> -- agentxchain --version`

---

## Behavior

### Scope

The script is a **local/networked postflight**. It intentionally depends on registry truth. It is not a pure offline workspace check like preflight.

### Failure Model

- The script is fail-closed: any missing registry signal or install-smoke mismatch exits non-zero.
- The script continues through all five checks even if early ones fail so the operator gets a complete picture.
- A present git tag is not enough. The release remains incomplete until the registry and executable artifact both agree with the tag.
- Network-backed checks retry with a bounded budget because registry metadata and install resolution can lag the initial publish by several seconds.

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
| install smoke executes but prints wrong version | Mark check as `FAIL`, continue |
| install smoke fails entirely | Mark check as `FAIL`, continue |
| registry metadata appears shortly after publish | Retry bounded by `RELEASE_POSTFLIGHT_RETRY_ATTEMPTS` / `RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS` before failing |

---

## Acceptance Tests

1. The script rejects missing `--target-version`.
2. The script passes when the tag exists, the registry serves the target version, metadata is present, and install smoke returns the expected version.
3. The script fails when the registry does not yet serve the version and still evaluates the later checks.
4. The script fails when the installed CLI reports a mismatched version.
5. The script retries registry metadata and install smoke checks before failing closed.

---

## Open Questions

1. Should postflight eventually verify the GitHub release asset/body as a sixth check, or stay npm-focused and keep GitHub release verification separate?
2. Should Homebrew formula verification become a second script after publish once the tap update path is stable?
