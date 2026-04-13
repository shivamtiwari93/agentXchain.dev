# Spec: Doctor Connector Handoff

## Purpose

Keep `agentxchain doctor` as a fast static readiness surface while making its boundary explicit when configured runtimes still need a live connector probe before the first governed turn.

## Problem

`agentxchain doctor` correctly avoids live network probing, and `agentxchain connector check` already owns that behavior. But the command output stops at "ready" or "ready with warnings" without telling operators when the remaining gap is specifically "you have API or remote HTTP runtimes that still need a live probe." That leaves the static/live boundary documented, but not surfaced in the command the operator just ran.

## Interface

No new command or flag.

### Extended `doctor --json` contract

When at least one configured runtime requires a live probe outside `doctor`, JSON output adds:

- `connector_probe_recommended`: boolean
- `connector_probe_runtime_ids`: string[]
- `connector_probe_detail`: string or `null`

### Text output

When `connector_probe_recommended` is true and `doctor` has no failing checks, text output prints a follow-up line:

```text
Next: run `agentxchain connector check` to live-probe api / remote HTTP runtimes before the first governed turn.
```

## Behavior

### Recommendation boundary

Set `connector_probe_recommended: true` only when the governed config contains at least one runtime that `doctor` cannot fully verify statically:

- `api_proxy`
- `remote_agent`
- `mcp` with `transport: "streamable_http"`

Do **not** recommend connector probing solely for:

- `manual`
- `local_cli`
- `mcp` with `transport: "stdio"`

Those are already verified by local binary / config checks in `doctor`.

### Summary behavior

- If `doctor` has failures, do not print the next-step hint in text mode. Fix readiness failures first.
- If `doctor` has no failures and `connector_probe_recommended` is true, print the handoff line even when warnings remain.
- JSON output always includes the connector-probe fields so scripts can branch correctly.

## Error Cases

- No relevant runtimes configured: recommendation fields stay false/empty/null.
- A project with only `local_cli` or stdio MCP runtimes: no connector handoff hint.
- A project with `api_proxy` plus missing auth env: `doctor` still fails on the runtime prerequisite, but JSON continues to expose that live probing would be the next boundary after readiness is fixed.

## Acceptance Tests

- `AT-GD-008`: `doctor --json` sets `connector_probe_recommended: true` and lists the affected runtime IDs for `api_proxy`, `remote_agent`, or HTTP MCP runtimes.
- `AT-GD-009`: text-mode `doctor` prints the `connector check` next-step hint when no checks fail and live-probe runtimes are configured.
- `AT-GD-010`: text-mode and JSON output do not recommend `connector check` for local-only runtimes (`local_cli`, manual, MCP stdio).

## Open Questions

None. The boundary was already decided in `DEC-DOCTOR-PROBE-BOUNDARY-001`; this slice only makes that boundary visible in the command output.
