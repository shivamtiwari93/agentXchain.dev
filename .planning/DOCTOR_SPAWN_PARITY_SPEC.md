## Purpose

Freeze the BUG-26 contract: `doctor`, `connector check`, and `connector validate` must judge local CLI runtime availability using the same spawn resolution rules that real governed dispatch uses.

## Interface

- `agentxchain doctor`
  - Local CLI and stdio MCP runtime checks report whether the configured command is resolvable in the real dispatch spawn context.
- `agentxchain connector check`
  - Local CLI and stdio MCP probes use the same spawn-context resolution rules before reporting runtime health.
- `agentxchain connector validate <runtime_id>`
  - Synthetic validation fails closed before dispatch when the configured command is not resolvable in the validation scratch workspace spawn context.

## Behavior

1. Command resolution must use `child_process.spawn` / `spawnSync` semantics, not shell built-ins like `command -v`, `which`, alias lookup, or tilde expansion.
2. The probe must run with the same working-directory resolution rules as dispatch:
   - project root when no runtime `cwd` is configured
   - `join(root, runtime.cwd)` when `cwd` is configured
3. A command is considered reachable when the spawn call resolves the executable. Non-zero exit codes and short probe timeouts still count as reachable if the executable launched.
4. `ENOENT`, `EACCES`, or missing probe working directories fail the check.
5. Failure messages must be actionable. For Codex specifically, the guidance must say that bare `codex` may not be on PATH in spawn context and recommend an absolute path such as `/Applications/Codex.app/Contents/Resources/codex`.
6. Public integration guidance for Codex must foreground the absolute-path recommendation instead of burying it as an afterthought.

## Error Cases

- Runtime command contains shell-only syntax such as `~/bin/codex`
  - `doctor`, `connector check`, and `connector validate` fail with a spawn-context resolution error and suggest an absolute path.
- Runtime `cwd` points at a missing directory
  - the check fails with a working-directory error instead of pretending the runtime is healthy.
- Executable exists but exits non-zero immediately
  - the reachability probe still counts it as reachable; deeper behavior proof remains `connector validate`.

## Acceptance Tests

1. A beta-tester scenario using `~/bin/codex` reproduces the old false positive and now fails in `doctor`, `connector check`, and `connector validate` with absolute-path guidance.
2. The same scenario passes once the runtime command is changed to the real absolute executable path.
3. Existing local CLI connector-check and doctor suites continue to pass.
4. The Codex integration docs mention the absolute-path recommendation and the bundled macOS app path explicitly.

## Open Questions

- Whether remote MCP HTTP probing needs a similar dispatch-context contract beyond HTTP reachability.
- Whether we should persist the spawn-context probe as a standalone reusable `doctor` check ID for dashboard parity instead of embedding it in the runtime checks.
