# AgentXchain.ai — Operator Observability Spec

**Status:** Draft — pre-implementation architecture contract
**Owner:** Agents (Claude Opus 4.6 + GPT 5.4)
**Decision:** `DEC-AI-OPERATOR-OBSERVABILITY-001`
**Depends on:** Control Plane API Spec, Execution Plane Spec, Dashboard Read-Model Spec

---

## Purpose

Define how operators observe live and historical governed runs through the `.ai` hosted dashboard without inventing cloud-only semantics. Every visible element must be derivable from protocol state — the same state that `.dev` CLI surfaces produce. The dashboard adds presentation, aggregation, and real-time streaming, but never governance-affecting interpretation.

---

## Scope

This spec covers:

1. Live run event timelines
2. Turn-level progress and outcome aggregation
3. Gate state visualization
4. Decision ledger access
5. Phase transition history
6. Operator alerting and notification hooks
7. Historical run comparison and search

This spec does NOT cover:

- Dashboard mutations (covered by Dashboard Mutation Spec)
- Actionability projections (covered by Dashboard Read-Model Spec)
- Execution plane internals (covered by Execution Plane Spec)

---

## Interface

### 1. Live Event Timeline

**Endpoint:** `GET /v1/runs/:run_id/events/stream`
**Transport:** Server-Sent Events (SSE)
**Contract:**

- Events use the same schema as `.dev` `events.jsonl` entries
- Every event carries `event_type`, `timestamp`, `run_id`, and optional `turn_id`
- The stream includes all event types the CLI emits: `turn_dispatched`, `turn_accepted`, `turn_rejected`, `turn_checkpointed`, `gate_evaluated`, `phase_transition`, `conflict_detected`, `conflict_resolved`, `run_stalled`, `intent_coverage_evaluated`, `coordinator_retry`, `actionability_changed`, and all others in the `.dev` event schema
- Reconnection uses `Last-Event-ID` with the last received event's sequence number
- The server buffers the most recent 100 events for reconnection catch-up
- No cloud-only event types are permitted in v1

### 2. Turn Progress Aggregation

**Endpoint:** `GET /v1/runs/:run_id/turns`
**Response shape:**

```json
{
  "turns": [
    {
      "turn_id": "turn_abc123",
      "role": "qa",
      "phase": "qa",
      "status": "accepted",
      "dispatched_at": "2026-04-19T10:00:00Z",
      "completed_at": "2026-04-19T10:05:00Z",
      "duration_ms": 300000,
      "files_changed": ["src/main.ts", "tests/main.test.ts"],
      "checkpoint_sha": "abc123def",
      "verification": { "status": "pass", "commands_run": 3 },
      "artifact_type": "workspace",
      "observation_summary": {
        "declared_files": 2,
        "observed_files": 2,
        "match": true
      }
    }
  ],
  "summary": {
    "total": 12,
    "accepted": 10,
    "rejected": 1,
    "in_progress": 1,
    "average_duration_ms": 280000
  }
}
```

**Rules:**
- Turn data is derived from `history.jsonl` entries and live state
- `observation_summary` comes from the repo-observer, not agent self-report
- `duration_ms` is wall-clock from dispatch to acceptance/rejection
- In-progress turns show `status: "in_progress"` with `dispatched_at` but no `completed_at`

### 3. Gate State Visualization

**Endpoint:** `GET /v1/runs/:run_id/gates`
**Response shape:**

```json
{
  "gates": [
    {
      "gate_name": "implementation_complete",
      "status": "passed",
      "passed_at": "2026-04-19T09:00:00Z",
      "passed_by_turn": "turn_xyz789",
      "evaluation_history": [
        {
          "evaluated_at": "2026-04-19T08:30:00Z",
          "result": "not_ready",
          "reason": "Missing test coverage",
          "evaluator": "gate_semantic_coverage"
        },
        {
          "evaluated_at": "2026-04-19T09:00:00Z",
          "result": "passed",
          "evaluator": "gate_semantic_coverage"
        }
      ]
    }
  ],
  "current_phase": "qa",
  "phase_transitions": [
    {
      "from": "implementation",
      "to": "qa",
      "transitioned_at": "2026-04-19T09:01:00Z",
      "gate": "implementation_complete",
      "approved_by": "operator:shivam"
    }
  ]
}
```

**Rules:**
- Gate evaluation results come from the same evaluators as the CLI
- `evaluation_history` is derived from `events.jsonl` `gate_evaluated` events
- Phase transitions include the approval attribution (operator or auto-approve)
- No cloud-only gate states or transitions are permitted

### 4. Decision Ledger Access

**Endpoint:** `GET /v1/runs/:run_id/decisions`
**Response:** Paginated list of `decision-ledger.jsonl` entries with standard pagination (`cursor`, `limit`)

**Rules:**
- Decisions are read-only through the dashboard
- The dashboard MAY filter decisions by phase, role, or type
- Decision content is protocol-verbatim — no summarization, no omission, no rewriting

### 5. Historical Run Search

**Endpoint:** `GET /v1/workspaces/:ws_id/runs`
**Query parameters:** `status`, `phase`, `created_after`, `created_before`, `project_id`, `limit`, `cursor`

**Rules:**
- Search results return summary-level run data (id, status, phase, turn count, created/updated timestamps)
- Full run detail requires `GET /v1/runs/:run_id`
- Search indices are cloud-only infrastructure (not exportable) but the data they index is protocol state

### 6. Operator Alerting

**Mechanism:** Webhook delivery to operator-configured endpoints
**Trigger events (v1 set):**

| Event | Trigger |
|-------|---------|
| `run_requires_approval` | A gate evaluation returns `requires_approval` |
| `run_stalled` | Non-progress detection fires |
| `turn_failed_acceptance` | A turn fails acceptance validation |
| `run_completed` | All phases complete |
| `run_failed` | Unrecoverable failure |
| `lease_expired` | Execution-plane lease expires without completion |

**Rules:**
- Webhook payloads use the same event schema as the SSE stream
- Delivery is at-least-once with idempotency keys (same contract as Control Plane Spec webhooks)
- Operators configure alert rules at workspace level
- No cloud-only alert actions — alert webhooks carry the same `next_actions[]` that the read-model would project

### 7. Run Comparison

**Endpoint:** `GET /v1/workspaces/:ws_id/runs/compare?run_ids=run_a,run_b`

**Response:** Side-by-side summary of two runs: phase progression, turn counts, gate evaluation timelines, total duration, cost if available. This is a presentation convenience — all data is derived from individual run endpoints.

---

## Behavior

1. **Protocol fidelity.** Every observable field in the dashboard is derived from protocol state that the `.dev` CLI also produces. The dashboard adds presentation (charts, timelines, search) but never governance-affecting interpretation.

2. **No cloud-only event types in v1.** The SSE stream, turn aggregation, gate visualization, and alert webhooks all use the `.dev` event schema. Cloud-specific infrastructure events (worker health, queue depth, lease metrics) are operator telemetry, not run observability, and belong in a separate monitoring surface.

3. **Latency contract.** Live events must appear in the SSE stream within 2 seconds of protocol emission. Turn aggregation and gate state must refresh within 5 seconds of underlying state change. These are SLO targets, not hard guarantees — the dashboard degrades gracefully (shows "updating..." state) rather than showing stale data as current.

4. **Reconnection resilience.** SSE reconnection with `Last-Event-ID` must not produce duplicate events or skip events that occurred during disconnection (up to the 100-event buffer). If the gap exceeds the buffer, the client receives a `reconnection_gap` event and must re-fetch full state.

5. **Export compatibility.** Run comparison, decision ledger browsing, and gate evaluation history are presentation over protocol state. The underlying data is always exportable via the portability bundle. Cloud-only search indices, aggregation caches, and timeline projections are infrastructure — they are rebuilt on import, not exported.

6. **Alert attribution.** Every alert webhook carries the `run_id`, `turn_id` (if applicable), and `workspace_id` so the receiving system can correlate alerts to specific protocol entities without querying back.

---

## Error Cases

1. **SSE stream requested for non-existent run** → `404 Not Found`
2. **SSE reconnection with expired `Last-Event-ID`** → `reconnection_gap` event, client re-fetches
3. **Gate visualization for run with no gate evaluations** → empty `gates[]`, `phase_transitions[]`
4. **Decision ledger pagination past end** → empty `decisions[]`, `cursor: null`
5. **Run comparison with mismatched workspace** → `403 Forbidden` (cross-workspace comparison not permitted in v1)
6. **Webhook delivery failure** → retry with exponential backoff (3 attempts, max 30s), then mark delivery as `failed` in audit log. No silent drop.

---

## Acceptance Tests

- **AT-OBS-001:** SSE stream for an active run delivers `turn_dispatched` events within 2 seconds of dispatch
- **AT-OBS-002:** Turn aggregation includes `observation_summary` derived from repo-observer, not agent self-report
- **AT-OBS-003:** Gate visualization shows `evaluation_history` matching `events.jsonl` `gate_evaluated` entries
- **AT-OBS-004:** Decision ledger pagination returns all decisions for a 50-turn run without omission
- **AT-OBS-005:** SSE reconnection with `Last-Event-ID` delivers missed events without duplicates
- **AT-OBS-006:** `reconnection_gap` event fires when the gap exceeds the 100-event buffer
- **AT-OBS-007:** Webhook delivery for `run_requires_approval` includes the gate name, run_id, and `next_actions[]`
- **AT-OBS-008:** Run comparison returns side-by-side phase/turn/gate summaries for two runs in the same workspace
- **AT-OBS-009:** No event in the SSE stream carries a cloud-only `event_type` not present in the `.dev` event schema
- **AT-OBS-010:** Exported portability bundle from a run with dashboard-viewed history contains identical protocol state to one never viewed through the dashboard (dashboard observation does not mutate protocol state)

---

## Open Questions

1. **Cost attribution in run comparison.** Should the dashboard show per-run or per-turn cost metrics? The CLI tracks `estimated_cost` in some runtime responses. If this is surfaced in the dashboard, it needs a defined source (connector response, not cloud-side metering) and explicit "estimated" labeling. Deferred until connector cost reporting stabilizes.

2. **Multi-coordinator run observability.** For mission-launched runs that span multiple repos via the coordinator, should the dashboard show a unified timeline across child runs, or keep them scoped to individual project views? Position: scoped to individual project in v1, unified view deferred until the coordinator protocol stabilizes further.

3. **Retention policy.** How long are event streams and run history retained in the hosted surface? This is a commercial/operational decision, not a protocol question. The spec does not constrain retention — it only requires that retained data remains protocol-faithful and exportable.
