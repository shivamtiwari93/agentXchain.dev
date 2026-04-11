# Run History — Cross-Run Operator Observability

## Purpose

Give operators a persistent, cross-run view of governed execution within a project directory. Today each `agentxchain run` produces state/artifacts/reports for that single run only. When the next run starts, the previous run's state is overwritten. Operators have no aggregate view of how many runs happened, what they produced, or how costs and quality trended over time.

Run history closes this gap with the minimum viable surface: an append-only local ledger, a CLI query command, and a dashboard endpoint.

## Interface

### Storage

- **File:** `.agentxchain/run-history.jsonl`
- **Format:** One JSON object per line, appended on every run completion (status `completed`) or governed blocked outcome (status `blocked`).
- **Baseline:** The file is governed infrastructure (same as `history.jsonl`, `decision-ledger.jsonl`). It persists across runs and is NOT reset on `initializeGovernedRun`.
- **Repo observer:** Exempt from clean-baseline checks (same category as other `.agentxchain/` infrastructure).

### Record Schema

Each line contains:

```json
{
  "schema_version": "0.1",
  "run_id": "string",
  "project_id": "string",
  "project_name": "string",
  "template": "string",
  "status": "completed | blocked",
  "started_at": "ISO8601",
  "completed_at": "ISO8601 | null",
  "duration_ms": "number | null",
  "phases_completed": ["planning", "implementation", "qa"],
  "total_turns": "number",
  "roles_used": ["pm", "dev", "qa"],
  "decisions_count": "number",
  "total_cost_usd": "number | null",
  "budget_limit_usd": "number | null",
  "blocked_reason": "string | null",
  "gate_results": { "gate_id": "passed | pending" },
  "connector_used": "api_proxy | local_cli | manual | remote_agent",
  "model_used": "string | null",
  "retrospective": {
    "headline": "string",
    "terminal_reason": "completed | blocked typed reason",
    "next_operator_action": "string | null",
    "follow_on_hint": "string | null"
  },
  "inheritance_snapshot": {
    "recent_decisions": [{ "id": "string | null", "statement": "string | null", "decided_by": "string | null", "phase": "string | null" }],
    "recent_accepted_turns": [{ "turn_id": "string | null", "role": "string | null", "summary": "string | null", "phase": "string | null" }]
  },
  "recorded_at": "ISO8601"
}
```

### CLI Command: `agentxchain history`

```
agentxchain history [--limit N] [--json] [--status completed|blocked]
```

- Default: show last 20 runs in a human-readable table
- `--json`: emit the full JSONL records as a JSON array
- `--limit N`: show last N runs (default 20)
- `--status`: filter by terminal status

Output columns (text mode): `#`, `Run ID` (truncated), `Status`, `Trigger`, `Ctx`, `Phases`, `Turns`, `Cost`, `Duration`, `Date`, `Headline`

- `Trigger`: provenance trigger label (`manual`, `continuation`, `recovery`, `legacy`, etc.)
- `Ctx`: whether the run has a usable inheritance snapshot for child runs
- `Headline`: truncated terminal retrospective headline for quick operator review

### Dashboard Endpoint: `GET /api/run-history`

- Returns the full run-history JSONL as a JSON array
- Optional `?limit=N` query parameter
- 10th dashboard view: "Run History" tab with a table

### Recording Trigger

Recording happens at two points:
1. `approveRunCompletion()` — when a run successfully completes
2. `blockRunForHookIssue()` — when a run is blocked (captures the incomplete state)

The recording function reads current state + config to build the history record. It is non-fatal: if recording fails, the run completion/blocking still succeeds. The writer rejects the reserved run-level status `failed`; first-party governed writers do not emit it today.

## Behavior

### Recording

- `recordRunHistory(root, state, config, status)` appends one line to `.agentxchain/run-history.jsonl`
- Reads `history.jsonl` line count for `total_turns`
- Reads `decision-ledger.jsonl` line count for `decisions_count`
- Extracts cost from `state.budget_status.spent_usd`
- Extracts phases from history entries (unique `phase` values)
- Extracts roles from history entries (unique `role` values)
- Stores an additive deterministic `retrospective` handoff summary derived from terminal state and accepted-turn history
- Stores a bounded `inheritance_snapshot` (max 5 decisions, max 3 accepted turns) so later child runs can inherit context from the selected parent run instead of today's repo-global ledger files
- Non-fatal: catches and warns on any error

### Query

- `queryRunHistory(root, { limit, status })` reads the JSONL file, optionally filters, returns most-recent-first
- Returns `[]` if file does not exist (no error)

### Pruning

- Not in v1. The file is append-only. Operators can manually truncate.
- Future: `agentxchain history --prune --keep N`

### Init Behavior

- `initializeGovernedRun()` must NOT delete or truncate `run-history.jsonl`
- The file persists across all runs in the project directory

## Error Cases

1. **Recording fails** — warn to stderr, do not block run completion
2. **Corrupt JSONL** — skip unparseable lines during query, warn
3. **File missing** — return empty history (not an error)
4. **Concurrent writes** — append-only JSONL is safe for single-writer (governed runs are single-threaded)

## Acceptance Tests

- `AT-RH-001`: After a successful governed run completes, `.agentxchain/run-history.jsonl` contains exactly one new line with the run's `run_id`, status `completed`, and `total_turns > 0`.
- `AT-RH-002`: After a second governed run completes, `run-history.jsonl` contains two lines with different `run_id` values.
- `AT-RH-003`: `agentxchain history --json` emits a JSON array with the correct number of history entries.
- `AT-RH-004`: `agentxchain history --limit 1 --json` returns only the most recent entry.
- `AT-RH-005`: `agentxchain history --status blocked --json` returns only entries with status `blocked` (empty if none).
- `AT-RH-006`: `initializeGovernedRun()` does not delete or truncate existing `run-history.jsonl`.
- `AT-RH-007`: `GET /api/run-history` returns a JSON array of history entries.
- `AT-RH-008`: Recording failure does not prevent run completion.
- `AT-RH-009`: `agentxchain history` text output includes a readable table with columns for status, trigger, context inheritance, turns, cost, date, and retrospective headline.
- `AT-RH-010`: recorded run-history entries include a bounded `inheritance_snapshot` used by child-run context inheritance.

## Open Questions

1. Should `run-history.jsonl` be included in `buildRunExport()`? Argument for: cross-run context is valuable for operators reviewing exported artifacts. Argument against: export is per-run, history is cross-run. **Tentative: include it.**
2. Should blocked runs record immediately or wait for recovery? **Decision: record immediately at block time. If recovery succeeds, a new completion record is appended — operators see both events.**
3. Should the dashboard add row expansion for the full retrospective rather than only the headline? **Not in this slice. The headline is enough to make the default view discoverable without turning run history into a second report surface.**
