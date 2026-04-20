# Homebrew Phase Verification Spec

## Purpose

Make the three-phase Homebrew release lifecycle executable instead of implied.

The repo already documents:

1. Phase 1: pre-publish release bump with carried prior-version SHA
2. Phase 2: npm live, repo mirror still stale
3. Phase 3: repo mirror synced to the live npm tarball

What was still weak: `verify-post-publish.sh` delegated Phase 2 -> Phase 3 proof to `sync-homebrew.sh` and then relied on a broad `npm test` run. That is not a sharp enough contract. The script itself must prove that the repo mirror formula URL and SHA now match registry truth, and that the public `npx` entrypoint still resolves from the live registry, before it claims Phase 3.

## Interface

```bash
cd cli
bash scripts/verify-post-publish.sh --target-version <semver>
```

## Behavior

1. Resolve the target version from `--target-version` or `cli/package.json`.
2. Fail closed unless `npm view agentxchain@<version> version` returns the exact target version.
3. Run `sync-homebrew.sh --target-version <version>`.
4. Fetch `dist.tarball` from npm for the target version.
5. Compute the live registry tarball SHA256 from that URL.
6. Read `cli/homebrew/agentxchain.rb` and extract:
   - formula `url`
   - formula `sha256`
7. Fail closed unless:
   - formula URL equals the registry tarball URL
   - formula SHA256 equals the registry tarball SHA256
8. Run `npx --yes -p agentxchain@<version> -c "agentxchain --version"` in an isolated temp environment.
9. Fail closed unless the command resolves from the public registry and prints the exact target version.
10. Run `npm test` without `AGENTXCHAIN_RELEASE_PREFLIGHT=1`.
11. Exit 0 only when mirror verification, public `npx` smoke, and the full test suite all pass.

## Error Cases

- npm does not yet serve the target version: fail before sync
- npm does not return `dist.tarball`: fail before mirror proof
- registry tarball SHA256 cannot be computed: fail before mirror proof
- formula URL is missing or does not match the registry tarball URL: fail before `npm test`
- formula SHA256 is missing or does not match the registry tarball SHA256: fail before `npm test`
- `npx` cannot resolve the published package or prints the wrong version: fail before `npm test`
- `npm test` fails after mirror verification: fail

## Acceptance Tests

- `AT-HPV-001`: `verify-post-publish.sh` succeeds only when npm serves the target version, `sync-homebrew.sh` updates the repo mirror to the registry tarball URL and SHA, the public `npx` path resolves and reports the target version, and `npm test` passes.
- `AT-HPV-002`: `verify-post-publish.sh` fails before running `sync-homebrew.sh` when npm does not yet serve the target version.
- `AT-HPV-003`: `verify-post-publish.sh` fails before `npm test` when the repo mirror formula URL does not match the registry tarball URL after sync.
- `AT-HPV-004`: `verify-post-publish.sh` fails before `npm test` when the repo mirror formula SHA256 does not match the registry tarball SHA256 after sync.
- `AT-HPV-005`: `verify-post-publish.sh` fails before `npm test` when the public `npx` path does not report the target version.

## Open Questions

None.
