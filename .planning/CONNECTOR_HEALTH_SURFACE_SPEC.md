# Connector Health Surface Spec

## Purpose

Operators can currently see run state, gates, blockers, continuity, and workflow-kit artifacts, but they still cannot answer a basic runtime question without digging through staging files:

- Which non-manual runtimes have actually been used?
- Which runtime failed last?
- Was the last observed adapter attempt successful or failing?
- What target is that runtime pointed at?
- What was the last error and retry count?

This slice adds a shared connector-health surface for governed projects so `agentxchain status`, `agentxchain status --json`, and the local dashboard can expose the same runtime diagnostics without inventing fake live pings.

## Interface

### Shared helper

Add a shared runtime/connector health helper under `cli/src/lib/` that:

- reads governed config/state plus repo-native evidence under `.agentxchain/`
- returns a stable object for **non-manual runtimes only**
- derives health from:
  - configured runtime metadata
  - current active turns
  - accepted history entries
  - staged retry traces and API error artifacts when present

### `agentxchain status --json`

Add an additive top-level field:

```json
{
  "connector_health": {
    "connectors": [
      {
        "runtime_id": "api-qa",
        "type": "api_proxy",
        "target": "anthropic / claude-sonnet-4-6",
        "state": "healthy",
        "reachable": "yes",
        "active_turn_ids": [],
        "active_roles": [],
        "last_turn_id": "turn-004",
        "last_role": "qa",
        "last_phase": "qa",
        "last_attempt_at": "2026-04-10T12:00:02Z",
        "last_success_at": "2026-04-10T12:00:02Z",
        "last_failure_at": null,
        "latency_ms": 842,
        "attempts_made": 2,
        "last_error": null
      }
    ]
  }
}
```

### Human-readable `agentxchain status`

Add a `Connectors:` section for governed projects when at least one non-manual runtime exists.

Each runtime row must include:

- `runtime_id`
- runtime type
- human-readable target
- derived state
- last error when failing
- active turn ids when active

### Dashboard bridge

Add a computed read-only endpoint:

- `GET /api/connectors`

This endpoint must use the same shared helper as `status --json`.

### Dashboard rendering

Do **not** add a tenth top-level dashboard view.

Instead, extend the existing repo-local **Timeline** view with a `Connector Health` section rendered from `/api/connectors`.

## Behavior

### Runtime inclusion

- Include runtimes whose configured `type` is one of:
  - `local_cli`
  - `api_proxy`
  - `mcp`
  - `remote_agent`
- Exclude `manual` runtimes.

### Target formatting

- `api_proxy`: `<provider> / <model>`
- `remote_agent`: configured URL
- `mcp`:
  - `streamable_http`: configured URL
  - `stdio`: configured command
- `local_cli`: configured command

### Derived state

Allowed connector states:

- `never_used`
- `active`
- `healthy`
- `failing`

Resolution rules:

1. If the runtime currently owns one or more active turns and no later failure evidence exists, state is `active`.
2. Otherwise, if the most recent observed runtime evidence is a failed attempt, state is `failing`.
3. Otherwise, if the most recent observed runtime evidence is a successful attempt or accepted turn, state is `healthy`.
4. Otherwise, state is `never_used`.

### Reachability

`reachable` is an evidence-backed summary, not a live network probe.

Allowed values:

- `yes`
- `no`
- `unknown`

Rules:

- `yes` when the latest observed attempt succeeded for `api_proxy`, `mcp`, or `remote_agent`
- `no` when the latest observed attempt failed for `api_proxy`, `mcp`, or `remote_agent`
- `unknown` for `local_cli`, or when no runtime attempt has been observed yet

### Evidence precedence

Use the newest available evidence by timestamp:

1. staged retry trace completion timestamp
2. accepted turn `accepted_at`
3. active turn presence with no attempt telemetry

### Fail-soft parsing

Malformed or missing staging artifacts must not crash `status` or dashboard rendering.

If a retry trace or API error artifact cannot be parsed:

- ignore that artifact for health derivation
- continue rendering the remaining connector surface

## Error Cases

- No governed project: existing `status` error behavior remains unchanged.
- No non-manual runtimes configured: omit the human-readable connector section and emit `connector_health.connectors = []` in JSON.
- Runtime configured but never used: report `state = "never_used"` and `reachable = "unknown"`.
- Active turn with no retry trace yet: report `state = "active"` with `reachable = "unknown"` unless later attempt evidence exists.
- API failure with persisted `.agentxchain/staging/<turn>/api-error.json`: expose the classified error message as `last_error`.
- Retry trace success with multiple attempts: preserve `attempts_made` and last-attempt `latency_ms`.

## Acceptance Tests

- `AT-CHS-001`: `agentxchain status --json` exposes additive `connector_health.connectors[]` for non-manual runtimes only.
- `AT-CHS-002`: a runtime with accepted history and successful retry-trace evidence renders `state = "healthy"`, `reachable = "yes"`, `attempts_made`, and `latency_ms`.
- `AT-CHS-003`: a runtime with staged API failure renders `state = "failing"`, `reachable = "no"`, and `last_error`.
- `AT-CHS-004`: a runtime with an active turn but no attempt telemetry renders `state = "active"` and the active turn id.
- `AT-CHS-005`: human-readable `status` prints a `Connectors:` section with target, state, and failure detail.
- `AT-DASH-CH-001`: `GET /api/connectors` returns the same computed connector-health payload used by `status --json`.
- `AT-DASH-CH-002`: the Timeline dashboard view renders a `Connector Health` section without increasing the number of top-level dashboard views.
- `AT-DOC-CH-001`: CLI docs document the additive `connector_health` JSON/status surface and the `/api/connectors` dashboard endpoint.

## Open Questions

- None for this slice. Live transport probes are explicitly out of scope; this surface is evidence-derived only.
