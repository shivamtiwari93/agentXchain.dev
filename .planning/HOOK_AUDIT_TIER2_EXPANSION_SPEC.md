# Hook Audit Tier 2 Expansion Spec

## Purpose

Close the two highest-priority coverage gaps in the `hook_audit` conformance surface.

The existing 3 HA fixtures cover: successful allow (HA-001), HTTP connection failure in advisory mode (HA-002), and advisory block-to-warn downgrade (HA-003). Out of 12 possible `orchestrator_action` values, only 3 are tested: `continued`, `warn` (via HTTP failure), and `downgraded_block_to_warn`.

This spec adds 2 fixtures targeting the most critical untested error paths.

## Gap Analysis

| orchestrator_action | Covered? | Fixture |
|---|---|---|
| `continued` | YES | HA-001 |
| `warned` (HTTP failure) | YES | HA-002 |
| `downgraded_block_to_warn` | YES | HA-003 |
| **`blocked_failure`** | **NO** | → HA-004 |
| **`aborted_tamper`** | **NO** | → HA-005 |
| `blocked_timeout` | NO | deferred |
| `warned_timeout` | NO | deferred |
| `warned_failure` | NO | deferred |
| `blocked_invalid_output` | NO | deferred |
| `warned_invalid_output` | NO | deferred |
| `blocked` | NO | deferred |
| `skipped` | NO | deferred |

## HA-004: Blocking Hook Process Failure

### Behavior

A process hook in blocking mode exits with non-zero status. The orchestrator must:
- Record `verdict: "block"` (fail-closed)
- Record `orchestrator_action: "blocked_failure"`
- Set `hook_ok: false` and `blocked: true`
- Record `timed_out: false` (this is a process failure, not a timeout)
- Record `exit_code` as the actual non-zero exit code

### Hook Command

`["node", "-e", "process.exit(1)"]` — simplest possible non-zero exit.

### Acceptance Tests

- AT-HA-004-1: `hook_ok === false`
- AT-HA-004-2: `blocked === true`
- AT-HA-004-3: `audit_entry.orchestrator_action === "blocked_failure"`
- AT-HA-004-4: `audit_entry.verdict === "block"`
- AT-HA-004-5: `audit_entry.timed_out === false`
- AT-HA-004-6: `audit_entry.exit_code === 1`
- AT-HA-004-7: `audit_entry.hook_name === "failing_gate"`
- AT-HA-004-8: `audit_entry.transport === "process"`

## HA-005: Protected File Tamper Detection

### Behavior

A process hook modifies `.agentxchain/state.json` (a protected file). The orchestrator must:
- Detect the SHA-256 digest mismatch post-execution
- Restore the original file content
- Record `orchestrator_action: "aborted_tamper"`
- Record `verdict: null` (no verdict is produced — the hook is aborted before verdict processing)
- Set `hook_ok: false` and `blocked: false` (tamper aborts the phase but is not a "block" verdict)

### Hook Command

`["node", "-e", "require('fs').writeFileSync('.agentxchain/state.json', '{}')"]` — overwrites state.json with empty object, triggering SHA-256 mismatch.

### Acceptance Tests

- AT-HA-005-1: `hook_ok === false`
- AT-HA-005-2: `blocked === false` (tamper is not the same as blocking)
- AT-HA-005-3: `audit_entry.orchestrator_action === "aborted_tamper"`
- AT-HA-005-4: `audit_entry.verdict === null`
- AT-HA-005-5: `audit_entry.hook_name === "tamper_hook"`
- AT-HA-005-6: `audit_entry.transport === "process"`
- AT-HA-005-7: `audit_entry.timed_out === false`

## Open Questions

- Multi-hook scenarios (blocking + skipped) require extending the reference adapter to return all results, not just `results[0]`. Deferred to a later turn.

## Fixture Counts After

- Tier 2: 15 (10 DM + 5 HA)
- Total: 60 (40 T1 + 15 T2 + 5 T3)
