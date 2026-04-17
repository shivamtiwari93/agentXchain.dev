# Dev Command Normalization Spec

## Purpose

Freeze how `init --governed --dev-command ...` normalizes a custom `local_cli` runtime command so first-run onboarding does not corrupt valid argv.

## Interface

- CLI surface: `agentxchain init --governed --dev-command <parts...> [--dev-prompt-transport <mode>]`
- Internal surface: `resolveGovernedLocalDevRuntime(opts)` in `cli/src/commands/init.js`

## Behavior

1. If the first `--dev-command` element contains whitespace, split only that first element on whitespace boundaries.
2. Preserve every later `--dev-command` element as a single argv item after trimming.
3. This allows:
   - quoted command+flags input like `"claude -p --dangerously-skip-permissions"` to normalize to `["claude", "-p", "--dangerously-skip-permissions"]`
   - later arguments with spaces, such as absolute script paths or inline script bodies, to remain intact
4. The normalized command array is what gets written to `agentxchain.json` and later consumed by `connector check`, `connector validate`, and `run`.

## Error Cases

- Empty or all-whitespace command parts should be dropped.
- Custom commands still must satisfy the existing prompt-delivery contract:
  - include `{prompt}` or set `--dev-prompt-transport`
  - `argv` requires `{prompt}`
  - non-`argv` transport must not be combined with `{prompt}`

## Acceptance Tests

- `AT-DEV-CMD-001`: quoted first-element command+flags split into separate argv elements
- `AT-DEV-CMD-002`: later command arguments containing spaces are preserved intact in `agentxchain.json`
- `AT-DEV-CMD-003`: a path-with-spaces argument remains runnable through `connector validate`
- `AT-AUTO-COLD-001`: a cold-start automated onboarding flow using a wrapper agent under a path with spaces succeeds through `init -> doctor -> connector check -> connector validate -> run`

## Open Questions

- None for this slice.
