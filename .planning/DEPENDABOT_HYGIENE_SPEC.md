# Dependabot Hygiene Spec

## Purpose

Keep repository dependency automation honest:

- do not leave stale or incompatible Dependabot PRs open
- do not hide real vulnerable surfaces behind config suppression
- do not let unused or unexercised tooling create a permanent "repo is insecure" banner

This slice is operational hygiene, not product theater. The repo should only carry dependency surfaces we actively execute or intentionally support.

## Interface

### In Scope

- Audit the actual vulnerable surface on default branch
- Remove unused CLI dependencies
- Upgrade the Baby Tracker example frontend toolchain to current Node 20-compatible safe versions
- Update Dependabot policy for dependencies whose latest major versions violate the CLI Node support contract
- Close superseded or contract-incompatible Dependabot PRs with explicit reasons

### Out Of Scope

- Raising the CLI Node engine floor above the documented Node 18 support contract
- Blanket suppression of GitHub security or Dependabot signals
- Broad dependency modernization outside the proven vulnerable or dead-weight surfaces

## Behavior

1. `cli/` remains compatible with the documented Node 18 support contract.
2. Any CLI dependency update that requires Node 20+ without a deliberate engine-floor decision is rejected by policy, not left as permanent open PR noise.
3. Unused dependencies should be removed instead of upgraded.
4. Example-app dependency surfaces that still live in the repo and ship lockfiles must be maintained to a non-vulnerable state if they are kept.
5. Example-app docs must describe only the scripts and tooling we actually maintain.

## Error Cases

- A dependency PR proposes a major version whose engine requirement exceeds the package support contract.
- A repo banner stays red because an example app carries stale vulnerable dev tooling.
- A dependency remains declared but unused, creating fake maintenance burden and meaningless upgrade PRs.
- Docs still advertise removed tooling after dependency cleanup.

## Acceptance Tests

1. `cd cli && npm audit --json` reports zero vulnerabilities.
2. `cd "examples/Baby Tracker/baby-tracker/frontend" && npm audit --json` reports zero vulnerabilities.
3. `cd "examples/Baby Tracker/baby-tracker/frontend" && npm test` passes.
4. `cd "examples/Baby Tracker/baby-tracker/frontend" && npm run build` passes.
5. `cli/package.json` no longer declares unused `ora`.
6. `.github/dependabot.yml` encodes ignore policy for CLI major bumps that violate the current Node support contract.
7. Stale or incompatible open Dependabot PRs are closed with explicit reasons.

## Open Questions

- Whether the example frontend should regain an actively maintained lint surface later, or stay test/build-only until someone is willing to own lint drift.
- Whether a future deliberate CLI Node floor raise should reopen currently ignored major updates for `commander` and `inquirer`.
