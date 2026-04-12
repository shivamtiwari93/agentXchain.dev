# Coordinator Status Observability Spec

## Purpose

Enrich the `agentxchain multi status` command so operators get the same observability depth from coordinator runs that single-repo `agentxchain status` already provides. Currently, the coordinator status renders only 6 fields (super_run_id, status, phase, pending_gate name/type, per-repo summary, barriers). Single-repo status renders 20+ fields including blocked state with recovery descriptors, elapsed time, phase gate status, budget, pending transitions, and completion timestamps.

## Gap Evidence

- `multi.js:89-130` — `multiStatusCommand` renders sparse output
- `coordinator-state.js:229-231` — `phase_gate_status`, `created_at`, `updated_at` initialized but never surfaced
- `coordinator-state.js:380-405` — `getCoordinatorStatus()` omits `blocked_reason`, `created_at`, `updated_at`, `phase_gate_status`, `completed_at`
- `multi.js:159-162` — `blocked_reason` only shown in `multiStepCommand` error path, not in status

## Interface

No new commands. Enrichment of existing `multi status` rendering and `getCoordinatorStatus()` return shape.

### `getCoordinatorStatus()` additional fields

```js
{
  // existing fields preserved
  super_run_id, status, phase, repo_runs, pending_barriers, pending_gate,
  // new fields
  blocked_reason: string | null,
  created_at: string | null,    // ISO timestamp
  updated_at: string | null,    // ISO timestamp
  phase_gate_status: object,    // { gate_id: "passed" | "pending" | ... }
}
```

### `multi status` additional rendering

1. **Blocked state** — when `status === 'blocked'`, show `Blocked: <reason>` in red
2. **Elapsed time** — show `Elapsed: Xm Ys` computed from `created_at` for active runs
3. **Completed state** — when `status === 'completed'`, show `✓ Run completed` with `updated_at`
4. **Phase gate status** — render gate pass/pending list matching single-repo format
5. **Pending gate context** — show `from → to` phase transition direction (not just gate name/type)

### `--json` mode

Already passes `{ ...status, barriers }`. The enriched `getCoordinatorStatus()` fields flow automatically.

## Behavior

- Blocked rendering uses the coordinator's simple string `blocked_reason`, not the complex structured `blocked_reason` object from governed-state (coordinator blocked_reason is already a string per `coordinator-recovery.js`)
- Elapsed time is computed as `Date.now() - new Date(created_at).getTime()` — same pattern as single-repo turn elapsed
- Phase gate status is rendered identically to single-repo: `✓ gate: passed` / `○ gate: pending`
- Pending gate context reads `pending_gate.from` and `pending_gate.to` if present
- All new rendering is conditional — fields are omitted when null/empty/undefined

## Error Cases

- Missing `created_at` on legacy coordinator state → omit elapsed
- Missing `phase_gate_status` → omit gates section
- Corrupt/non-string `blocked_reason` → show `unknown reason`

## Acceptance Tests

1. Coordinator JSON output includes `blocked_reason`, `created_at`, `updated_at`, `phase_gate_status`
2. Blocked coordinator shows reason in text output
3. Active coordinator shows elapsed time
4. Completed coordinator shows completion marker
5. Phase gates render when present
6. All new fields are absent/null when not applicable

## Open Questions

None — this is a rendering enrichment with zero new data sources.
