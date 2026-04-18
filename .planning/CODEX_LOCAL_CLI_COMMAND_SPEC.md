## Purpose

Freeze the truthful AgentXchain contract for Codex-backed `local_cli` runtimes after live smoke testing exposed that the documented `codex --quiet ...` recipe is invalid on the installed Codex CLI.

## Interface

- Recommended authoritative Codex command:
  - `["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "{prompt}"]`
- Equivalent absolute-path variant:
  - `["/Applications/Codex.app/Contents/Resources/codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "{prompt}"]`
- Recommended prompt transport:
  - `argv`
- Also valid:
  - `stdin` with `codex exec --dangerously-bypass-approvals-and-sandbox` when the prompt is not passed via `{prompt}`

## Behavior

- AgentXchain public docs must describe `codex exec` as the non-interactive Codex entrypoint for governed runs.
- AgentXchain must not recommend `--quiet` for Codex local runtimes.
- `connector check` / authority-intent analysis must warn when a Codex command:
  - omits the `exec` subcommand for governed non-interactive use
  - includes `--quiet`
  - uses `--full-auto` instead of `--dangerously-bypass-approvals-and-sandbox` for authoritative roles
- Spawn-context probes must treat `ETIMEDOUT` as proof that the executable resolved and launched, not as proof that the command is missing.

## Error Cases

- `codex --quiet ...` exits immediately with `unexpected argument '--quiet'`.
- `codex exec ...` may run longer than the short spawn probe timeout; this must not be reported as "runtime not found".
- `argv` transport without `{prompt}` remains invalid.
- `review_only + local_cli` remains invalid regardless of Codex command shape.

## Acceptance Tests

- `connector-authority-intent.test.js` warns on missing `exec` and on `--quiet`.
- `connector-authority-intent.test.js` accepts `codex exec --dangerously-bypass-approvals-and-sandbox {prompt}`.
- `connector-validate-command.test.js` proves a slow local CLI runtime is not rejected at the spawn-probe stage purely because it exceeds the short probe timeout.
- Docs content tests freeze the `codex exec` recipe across the operator-facing pages.

## Open Questions

- Whether AgentXchain should eventually emit CLI-specific command-shape warnings for more tools than Claude and Codex.
