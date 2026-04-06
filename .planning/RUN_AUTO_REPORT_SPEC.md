# Run Auto-Report Spec

> `DEC-AUTO-REPORT-001` — automatic governance export + report after `agentxchain run` completes

---

## Purpose

Close the gap between the product's "complete audit trail" narrative and the actual operator experience. Today, after `agentxchain run` completes, the operator must manually call `agentxchain export` then `agentxchain report` to get a governance report. This breaks the lights-out story: a governed run should produce its own proof automatically.

## Interface

### Flag: `--report` (default: on for completed runs)

`agentxchain run` gains a `--no-report` flag to suppress automatic report generation. By default, when a run reaches terminal `completed` state, the runner automatically:

1. Calls `buildRunExport(root)` to produce the export artifact.
2. Calls `buildGovernanceReport(artifact)` to produce the governance report.
3. Writes both to `.agentxchain/reports/`:
   - `export-<run_id>.json` — the raw export artifact
   - `report-<run_id>.md` — the markdown governance report
4. Prints a one-line summary: "Governance report: .agentxchain/reports/report-<run_id>.md"

### Non-completed terminal states

For `blocked`, `gate_held`, `caller_stopped`, `max_turns_reached`: the export is still generated (the run's state is valid), but the report is labeled as "incomplete" with the stop reason. This is useful for debugging and recovery.

### No-op on failure

If the export or report fails (e.g., corrupt state), print a warning but do NOT change the exit code. The run itself succeeded or failed independently of report generation.

## Behavior

1. After `runLoop()` returns and before `process.exit()`, check `result.state`.
2. If `--no-report` is set, skip.
3. Call `buildRunExport(root)`. If it fails, warn and skip.
4. Write export artifact to `.agentxchain/reports/export-<run_id>.json`.
5. Call `buildGovernanceReport(artifact)`. If it fails, warn and skip.
6. Write markdown report to `.agentxchain/reports/report-<run_id>.md`.
7. Print the report path.

## Error Cases

| Condition | Behavior |
|---|---|
| `--no-report` | Skip entirely |
| Export fails | Print warning, do not change exit code |
| Report fails | Print warning, do not change exit code |
| Run did not complete (error/abort) | Still attempt report with stop_reason label |
| `.agentxchain/reports/` doesn't exist | Create it |

## Acceptance Tests

- AT-AR-001: After a successful `agentxchain run`, `.agentxchain/reports/export-<run_id>.json` exists and is valid JSON.
- AT-AR-002: After a successful `agentxchain run`, `.agentxchain/reports/report-<run_id>.md` exists and contains the run_id.
- AT-AR-003: `--no-report` suppresses report generation.
- AT-AR-004: Report generation failure does not change the run exit code.
- AT-AR-005: The governance report contains turn history, gate decisions, and overall status.

## Open Questions

None.
