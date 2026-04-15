## Purpose

Freeze the command-boundary contract for `agentxchain run` and `agentxchain resume` recovery guidance.

`deriveRecoveryDescriptor(state, config)` is runtime-aware. Command surfaces that print operator recovery actions must pass the normalized governed config so retained-turn guidance stays truthful for automated vs manual runtimes and legacy persisted recovery actions can refresh.

## Interface

- `cli/src/commands/run.js`
  - run-summary recovery output must call `deriveRecoveryDescriptor(result.state, config)`.
- `cli/src/commands/resume.js`
  - `printRecoverySummary(state, heading, config)` must call `deriveRecoveryDescriptor(state, config)`.
  - assignment-hook failure output must call `deriveRecoveryDescriptor(result.state, config)`.

## Behavior

- `run` and `resume` must not ask `deriveRecoveryDescriptor` to guess runtime class from missing config.
- When a retained turn belongs to an automated runtime, recovery text must preserve the automated recovery command chosen by the blocked-state contract.
- When a retained turn belongs to a manual runtime, recovery text must preserve the manual recovery command chosen by the blocked-state contract.
- Legacy persisted recovery actions that require config-aware refresh must render the refreshed action at the CLI surface.

## Error Cases

- Calling `deriveRecoveryDescriptor(state)` without config degrades retained-turn command selection to the default manual path.
- Command-level recovery text can drift from `blocked-state.js` if one surface passes config and another omits it.

## Acceptance Tests

- `cli/test/run-command.test.js`
  - guard that `run.js` passes `config` into `deriveRecoveryDescriptor(...)`.
- `cli/test/resume-context-header.test.js`
  - guard that `resume.js` passes `config` into every command-surface `deriveRecoveryDescriptor(...)` call.

## Open Questions

- Other commands still call `deriveRecoveryDescriptor(...)` without config. They should be audited separately instead of broadening this slice.
