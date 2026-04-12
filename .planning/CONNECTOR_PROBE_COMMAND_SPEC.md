# Connector Probe Command Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-12

## Purpose

Close the operator-truth gap between:

- `agentxchain doctor`, which is a **static readiness** surface
- the docs/onboarding story, which previously implied that runtime reachability had been proven live

The existing governed doctor only checks:

- config validity
- role presence
- local binary presence
- required API key env vars
- repo state / schedule / workflow-kit readiness

It does **not** perform a live network probe against configured API, MCP HTTP, or remote-agent endpoints. That boundary is acceptable, but only if the product also ships a real explicit probe command for operators who want to validate connectors before the first run.

## Interface

New governed command family:

```bash
agentxchain connector check [runtime_id] [--json] [--timeout <ms>]
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `[runtime_id]` | all non-manual runtimes | Check one configured runtime only |
| `--json` | `false` | Emit structured JSON instead of text |
| `--timeout <ms>` | `8000` | Per-probe timeout in milliseconds |

## Behavior

### Scope boundary

- Governed repos only.
- Uses configured runtimes from normalized `agentxchain.json`.
- Ignores `manual` runtimes.
- Checks one runtime when `[runtime_id]` is provided; otherwise checks every non-manual runtime.

### Probe semantics by runtime type

#### `local_cli`

- Checks command presence on `PATH`.
- Does **not** try to execute the tool beyond resolution.

#### `api_proxy`

- Fails immediately when required `auth_env` is missing.
- Uses the configured `base_url` when present; otherwise uses the provider endpoint registry already used by the adapter.
- Sends a minimal live API request using the same provider-specific request/header builders as the adapter.
- A 2xx response is a successful live probe.
- 401/403 fail as auth problems.
- 404 fails as endpoint/model-not-found.
- 429 fails as rate-limited.
- Other non-2xx responses fail with surfaced HTTP detail.

#### `mcp`

- `stdio`: checks command presence on `PATH`.
- `streamable_http`: performs a live HTTP probe to the configured URL using configured headers.
  - 2xx is success.
  - 405 counts as success because many MCP HTTP endpoints reject `GET` while still proving the endpoint is reachable.
  - 401/403 fail as auth problems.
  - 404 fails as endpoint-not-found.

#### `remote_agent`

- Performs a live HTTP probe to the configured URL using configured headers.
- 2xx is success.
- 405 counts as success for the same reason as streamable MCP.
- 401/403 fail as auth problems.
- 404 fails as endpoint-not-found.

### Output contract

Each checked runtime produces:

- `runtime_id`
- `type`
- `target`
- `probe_kind`
- `level` (`pass` or `fail`)
- `detail`
- `latency_ms` when a probe actually performs work
- transport-specific metadata when relevant (`endpoint`, `status_code`, `auth_env`)

The command output also includes:

- `overall`
- `pass_count`
- `fail_count`

### Exit codes

| Exit code | Meaning |
| --- | --- |
| `0` | Every checked runtime passed |
| `1` | One or more runtime probes failed |
| `2` | Command usage or project-boundary error |

## Error Cases

- no `agentxchain.json` found
- legacy v3 project
- invalid governed config
- unknown `[runtime_id]`
- missing required auth env for `api_proxy`
- timeout / network failure / DNS failure during HTTP probe
- non-2xx API response indicating auth, model, or endpoint problems

## Acceptance Tests

- `AT-CCP-001`: `connector check --json` fails closed outside a project root.
- `AT-CCP-002`: governed project with only manual runtimes returns pass with zero checked connectors.
- `AT-CCP-003`: `api_proxy` runtime with missing required auth env fails without making a network call.
- `AT-CCP-004`: `api_proxy` runtime with a 200 response passes and surfaces endpoint/status metadata.
- `AT-CCP-005`: `api_proxy` 401 response fails as auth rejection.
- `AT-CCP-006`: runtime filter checks only the named runtime and unknown runtime IDs fail closed.
- `AT-CCP-007`: `remote_agent` or HTTP MCP 405 response counts as reachable transport success.
- `AT-CCP-008`: CLI docs distinguish `doctor` static readiness from `connector check` live probing.

## Open Questions

- Whether a future slice should add a lightweight `connector list` or `connector check --watch` mode.
- Whether future provider-specific probes should add richer classification for quota exhaustion vs temporary overload.
