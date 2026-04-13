## Purpose

Prevent governed configs from silently defining phase-exit gates that cannot be satisfied through governed turns.

The concrete failure mode is narrow:

- a routing phase exits through a gate with `requires_files`
- every participating non-human role is `review_only`
- every participating runtime is `api_proxy` or `remote_agent`

In that shape, no governed turn can write or stage the required files. Users should be warned before they spend tokens on a dead-end flow.

## Interface

- `cli/src/lib/normalized-config.js`
  - `validateV4Config()` returns `warnings` alongside `errors`
  - emits a config warning for impossible remote-review-only gate/file combinations
- `cli/src/commands/doctor.js`
  - surfaces config warnings as `config_valid` `WARN` checks
- `cli/src/commands/config.js`
  - after `config --set`, prints any validator warnings so operators see the trap immediately
- `website-v2/docs/integration-guide.mdx`
  - documents the `requires_files` + remote `review_only` boundary for `api_proxy` / `remote_agent`

## Behavior

- Do not raise an error. This is a warning because operators can still choose out-of-band artifact creation.
- Do not warn when any participating role is `proposed` or `authoritative`.
- Do not warn for MCP or local/manual writer-capable configurations.
- Warning text must be actionable:
  - add a `proposed` / `authoritative` writer
  - remove the gate files
  - or explicitly rely on operator-managed out-of-band artifacts

## Error Cases

- Missing role/runtime references are handled by existing validation errors and should not produce duplicate warning noise.
- Empty/absent `requires_files` arrays produce no warning.
- `human` in `allowed_next_roles` does not count as a governed writer for suppressing the warning.

## Acceptance Tests

- `validateV4Config()` warns when a phase with `requires_files` is composed only of `review_only` `api_proxy` / `remote_agent` roles.
- `validateV4Config()` does not warn when a `proposed` remote role participates in the phase.
- `agentxchain doctor --json` marks `config_valid` as `warn` and includes the warning text for that config.
- Integration-guide content tests require documentation of the `requires_files` trap.

## Open Questions

- Should `validate` gain a dedicated config-warning section for governed repos, instead of leaving this to `doctor` and `config --set`?
- Should similar warnings cover all-no-writer phase shapes beyond remote runtimes, or is that too noisy without stronger role/phase ownership semantics?
