# Dashboard Watch Results Surface Spec

## Purpose

Expose Watch Mode intake outcomes in the existing local `agentxchain dashboard` so operators can audit webhook, event-file, and event-directory intake without switching to `agentxchain watch --results`.

This is an extension of the repo-owned dashboard, not a new dashboard subsystem.

OSS-first evaluation:

- Grafana Infinity can query JSON/CSV/XML/GraphQL/HTML endpoints and is maintained by Grafana Labs, so it is credible for generic JSON observability.
- Grafana still requires a running Grafana service, datasource configuration, dashboard provisioning, and an API shape optimized for panels rather than AgentXchain's local repo-native workflow audit.
- AgentXchain already ships a local dashboard bridge with authenticated local mutations, read-only APIs, WebSocket invalidation, and repo-native state readers.

Decision for this slice: reuse the existing dashboard bridge and add a watch-results read model. A future Grafana export/provisioning integration remains plausible once hosted or organization-wide observability exists.

## Interface

- `GET /api/watch-results`
  - Returns a JSON object:
    - `ok: true`
    - `total`: number of readable result records
    - `corrupt`: number of unreadable JSON files skipped
    - `recent`: most recent result records, sorted by `timestamp` descending
    - `summary`: counts by terminal route status, errors, deduplicated records, routed/unrouted records, and last timestamp
  - Optional query parameter:
    - `limit`: positive integer result cap; default `25`; `0` means all readable records.
- Dashboard hash route:
  - `#watch`
  - Fetches `/api/watch-results`
  - Renders summary badges and a compact recent-results table.

## Behavior

- Reads `.agentxchain/watch-results/*.json`.
- Missing `watch-results` directory is not an error; it returns an empty snapshot.
- Malformed result files are skipped and counted as `corrupt`.
- Result status precedence:
  1. `error` when `errors` is non-empty.
  2. `deduplicated` when `deduplicated === true`.
  3. `started` when `route.started === true`.
  4. `planned` when `route.planned === true`.
  5. `approved` when `route.approved === true`.
  6. `triaged` when `route.triaged === true`.
  7. `unrouted` when `route.matched === false`.
  8. `detected` otherwise.
- The dashboard file watcher maps changes under `.agentxchain/watch-results/` to `/api/watch-results` invalidations.
- The surface is read-only.

## Error Cases

- Missing directory: return `{ ok: true, total: 0, corrupt: 0, recent: [], summary: ... }`.
- Malformed JSON result file: skip it and increment `corrupt`.
- Non-object JSON result file: skip it and increment `corrupt`.
- Invalid `limit`: fall back to default `25`.

## Acceptance Tests

- AT-DASH-WATCH-001: `/api/watch-results` returns empty summary when no watch results exist.
- AT-DASH-WATCH-002: `/api/watch-results` returns readable results sorted newest first with summary counts for started, errors, deduplicated, routed, and unrouted.
- AT-DASH-WATCH-003: malformed result files are skipped and counted as corrupt.
- AT-DASH-WATCH-004: `limit` caps `recent`; `limit=0` returns all readable records.
- AT-DASH-WATCH-005: dashboard Watch view renders summary badges, delivery ID, route/run details, and error text.
- AT-DASH-WATCH-006: file watcher maps `.agentxchain/watch-results/*.json` changes to `/api/watch-results`.

## Open Questions

- Should a future Slice 9 add HTTP-level `X-GitHub-Delivery` deduplication before result persistence?
- Should hosted `.ai` observability emit Prometheus/OpenTelemetry metrics or provide Grafana dashboard provisioning?
