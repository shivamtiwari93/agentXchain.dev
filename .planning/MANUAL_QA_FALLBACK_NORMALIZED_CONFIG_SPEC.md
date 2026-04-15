# Manual QA Fallback Normalized Config Spec

## Purpose

Freeze the narrow contract for the built-in no-key QA fallback guidance surfaced by `agentxchain run` and `agentxchain step`.

The fallback hint exists to help operators recover from a missing `api_proxy` credential by switching the QA role to the built-in manual runtime. That hint must be derived from normalized governed config, not from `rawConfig` exceptions, and it must not keep telling operators to make an edit they already made.

## Interface

- Shared helper: `shouldSuggestManualQaFallback({ roleId, runtimeId, classified, config })`
- Callers:
  - `cli/src/commands/run.js`
  - `cli/src/commands/step.js`

Inputs:
- `roleId`: assigned role for the failed turn
- `runtimeId`: runtime used by that turn
- `classified`: classified adapter error object
- `config`: normalized governed config

Output:
- `true` only when the command should print the no-key QA fallback guidance
- `false` otherwise

## Behavior

The helper returns `true` only when all of the following are true:

1. `classified.error_class === "missing_credentials"`
2. the failed turn belongs to role `qa`
3. the failed turn runtime is `api-qa`
4. the current normalized config still routes `roles.qa.runtime` to `api-qa`
5. the current normalized config still declares `runtimes["manual-qa"].type === "manual"`

The helper must not read `rawConfig`.

The helper must reject stale recovery guidance when the operator has already changed `roles.qa.runtime` away from `api-qa`, even if a retained turn still carries `runtime_id: "api-qa"`.

## Error Cases

- Missing or malformed `classified` object: return `false`
- Missing `roles.qa` normalized metadata: return `false`
- Missing `manual-qa` runtime or wrong runtime type: return `false`
- Any non-QA role or non-`api-qa` runtime: return `false`

## Acceptance Tests

- `AT-MANUAL-QA-FALLBACK-001`: normalized config with `roles.qa.runtime_id = "api-qa"` and manual `manual-qa` runtime returns `true` on `missing_credentials`
- `AT-MANUAL-QA-FALLBACK-002`: returns `false` when the current normalized config already routes QA to `manual-qa`
- `AT-STEP-APIPROXY-INT-001`: `agentxchain step --role qa` prints the no-key QA fallback guidance on missing credentials without requiring any `rawConfig` read
- `AT-RUN-APIPROXY-INT-003`: `agentxchain run` still prints the same fallback guidance after the normalized-config refactor

## Open Questions

- None. This is a narrow cleanup and truth-alignment slice, not a product expansion.
