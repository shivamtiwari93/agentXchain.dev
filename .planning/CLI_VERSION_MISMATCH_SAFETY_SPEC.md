# CLI Version Mismatch Safety Spec

## Purpose

Prevent first-time operators from following current onboarding docs with a stale `agentxchain` binary on `PATH` and only discovering the mismatch after documented flags fail.

## Interface

- Public onboarding docs:
  - `website-v2/docs/getting-started.mdx`
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/docs/five-minute-tutorial.mdx`
- CLI:
  - `agentxchain doctor`
  - `agentxchain doctor --json`

## Behavior

- Each onboarding page must start with a `Prerequisites` block that states:
  - the minimum supported CLI version for the current docs release
  - how to check the installed version with `agentxchain --version`
  - how to upgrade with npm and Homebrew
  - the safe fallback command: `npx --yes -p agentxchain@latest -c "agentxchain ..."`
- `agentxchain doctor` must compare the running CLI version against the published docs floor and emit a loud warning when the local binary is older.
- The doctor warning must include a direct repair path:
  - `npm install -g agentxchain@latest`
  - `brew upgrade agentxchain`
  - `npx --yes -p agentxchain@latest -c "agentxchain doctor"`
- `doctor --json` must expose the running CLI version, the docs minimum when known, and a machine-readable status (`ok`, `stale`, or `unknown`).
- If the docs floor cannot be determined (for example npm is unavailable), doctor must not fail readiness solely because of the version probe.

## Error Cases

- `npm` unavailable or `npm view agentxchain version` times out:
  - doctor reports version status as `unknown`
  - no stale-version warning is emitted
- Non-semver output from the probe:
  - treat as `unknown`, not as success
- Running CLI older than docs minimum:
  - doctor emits a `warn` check with exact upgrade commands
  - doctor still exits based on blocking failures, not this warning alone

## Acceptance Tests

- All three onboarding pages contain a `Prerequisites` block with:
  - the current package version
  - `agentxchain --version`
  - `npm install -g agentxchain@latest`
  - `brew upgrade agentxchain`
  - `npx --yes -p agentxchain@latest -c "agentxchain ..."`
- `doctor --json` returns:
  - `cli_version`
  - `docs_min_cli_version`
  - `cli_version_status`
- When the published docs floor is higher than the running CLI version, `doctor`:
  - emits a `cli_version` warning check
  - includes the npm/Homebrew/npx repair commands in the output

## Open Questions

- Whether the public docs floor should continue to track the latest published CLI, or later move to a separately managed compatibility floor once versioned docs exist.
