# Verify Export Regression Detection Spec

**Status**: shipped

## Purpose

Extend `agentxchain diff --export` to detect and surface **semantic governance regressions** between two export artifacts, not just structural drift. Operators comparing two exports (e.g., run N vs run N+1 in the same repo) need to immediately see when governance quality has degraded.

The diff already shows what changed. This adds a `regressions` array that classifies **which changes represent governance failures** — status downgrades, budget overruns, decision overrides, gate failures, delegation contract violations, and coordinator repo failures.

## Interface

```
agentxchain diff <left.json> <right.json> --export [--json]
```

Output shape additions (both run and coordinator diffs):

```json
{
  "regressions": [
    {
      "id": "REG-STATUS-001",
      "category": "status",
      "severity": "error",
      "message": "Run status regressed from completed to failed",
      "field": "status",
      "left": "completed",
      "right": "failed"
    }
  ],
  "regression_count": 1,
  "has_regressions": true
}
```

Text output adds a `Governance Regressions:` section at the end when regressions are detected.

## Behavior

### Run Export Regressions

| ID Pattern | Category | Trigger | Severity |
|---|---|---|---|
| REG-STATUS-* | status | `status` changes from `completed` to `failed`/`error`/`crashed` | error |
| REG-PHASE-* | phase | `phase` moves backward in workflow order (not always detectable without config, so only flag explicit downgrades like non-null → null) | warning |
| REG-BUDGET-WARN-* | budget | `budget_status.warn_mode` changes from `false` → `true` | warning |
| REG-BUDGET-EXHAUST-* | budget | `budget_status.exhausted` changes from `false` → `true` | error |
| REG-DECISION-OVERRIDE-* | decisions | `overridden_repo_decision_count` increases (new overrides introduced) | warning |
| REG-DELEGATION-MISSING-* | delegation | `delegation_summary` shows new `missing_decision_ids` in right that were satisfied or absent in left | error |
| REG-GATE-* | gate | `phase_gate_status` gate flips from passed/approved to failed/blocked | error |

### Coordinator Export Regressions

All run-level regressions apply to the coordinator summary, plus:

| ID Pattern | Category | Trigger | Severity |
|---|---|---|---|
| REG-REPO-STATUS-* | repo_status | Any authority-first child repo `status` changes from `completed` to `failed`/`error`/`crashed`, but only when either compared coordinator export is non-terminal | error |
| REG-REPO-EXPORT-* | repo_export | Any child repo `export.ok` changes from `true` to `false`, but only when either compared coordinator export is non-terminal | error |
| REG-BARRIER-* | barrier | `barrier_count` decreases (barriers removed between runs) | warning |
| REG-EVENT-LOSS-* | events | `total_events` decreases between exports | warning |

When both coordinator exports are already `completed`, child repo drift remains visible in `repo_status_changes` / `repo_export_changes` but does not count as a governance regression. That comparison is terminal observability, not operator-actionable recovery.

### Severity Levels

- `error`: governance contract violation — something that was passing is now failing
- `warning`: governance quality signal — something degraded but may be intentional

### No False Positives

The regression detector must not flag:
- Status changes from `active` to `completed` (progression, not regression)
- Budget spend increasing (normal operation)
- Decision count increasing (decisions being made)
- New overrides that replace outdated decisions (intentional governance evolution)
  - The override itself is flagged as `warning`, but the operator decides if it is intentional

## Error Cases

1. Export artifacts with different `export_kind` — already rejected by `buildExportDiff`
2. Missing summary fields — treat as `null`, apply regression rules accordingly
3. Malformed budget/gate/delegation data — skip regression check for that field, do not crash

## Acceptance Tests

1. **AT-REG-001**: Run export with `status: completed → failed` produces `REG-STATUS-001` regression
2. **AT-REG-002**: Run export with `budget_status.warn_mode: false → true` produces budget regression
3. **AT-REG-003**: Run export with `budget_status.exhausted: false → true` produces budget exhaustion regression
4. **AT-REG-004**: Run export with increased `overridden_repo_decision_count` produces decision override regression
5. **AT-REG-005**: Coordinator export with child repo status `completed → failed` produces repo status regression
6. **AT-REG-006**: Coordinator export with child repo `export.ok: true → false` produces repo export regression
7. **AT-REG-007**: Coordinator export with decreased `barrier_count` produces barrier regression
8. **AT-REG-008**: Text output includes `Governance Regressions:` section with formatted regression entries
9. **AT-REG-009**: JSON output includes `regressions` array, `regression_count`, and `has_regressions`
10. **AT-REG-010**: No regressions when both exports show identical governance state
11. **AT-REG-011**: No regressions when status improves (`failed → completed`)
12. **AT-REG-012**: Run export with `phase_gate_status` gate regression produces gate error
13. **AT-REG-013**: Run export with new delegation `missing_decision_ids` produces delegation-contract regression
14. **AT-COORD-TERM-DIFF-001**: Completed-to-completed coordinator child status drift appears in change output but does not emit `REG-REPO-STATUS-*`
15. **AT-COORD-TERM-DIFF-002**: Completed-to-completed coordinator child export drift appears in change output but does not emit `REG-REPO-EXPORT-*`

## Open Questions

None — the regression categories are derived from existing export fields. No new data collection needed.
