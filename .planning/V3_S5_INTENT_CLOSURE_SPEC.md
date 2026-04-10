# V3-S5 Spec — Execution Exit And Intent Closure Linkage

> Standalone implementation spec for the shipped v3 slice that added `agentxchain intake resolve` and closed the first truthful intake lifecycle loop.

---

## Purpose

`intake start` transitions an intent from `planned → executing` and links it to a governed run. But the governed run engine has no knowledge of intake intents — it manages `state.json` independently. When a run completes, blocks, or fails, the intake intent stays frozen at `executing` forever.

S5 closed this gap. It added a single command — `agentxchain intake resolve` — that reads the governed run outcome and deterministically transitions the linked intake intent to the correct post-execution state.

This is the smallest useful lifecycle closure: it makes `executing` lead somewhere evidence-backed instead of being a dead-end label.

---

## Interface

### CLI Command

```
agentxchain intake resolve --intent <intent_id> [--json]
```

**Options:**

| Flag | Required | Description |
|------|----------|-------------|
| `--intent <id>` | Yes | The intent ID to resolve |
| `--json` | No | Structured JSON output |

### Library Function

```javascript
resolveIntent(root, intentId, options?)
  → { ok: true, intent, previous_status, new_status, run_outcome, exitCode: 0 }
  → { ok: false, error, exitCode: 1 | 2 }
```

---

## State Machine Extension

S5 adds two live post-execution transitions and one recovery transition:

```
executing → blocked        (governed run status === 'blocked')
executing → completed      (governed run status === 'completed')
blocked   → approved       (re-approve after block recovery, reuses intake approve)
```

> **Updated 2026-04-10 (DEC-RUN-STATUS-001 / DEC-INTAKE-FAILED-002):**
> Run-level `failed` is reserved/unreached. `intake resolve` fails closed if
> `state.status === 'failed'` instead of mapping to intent `failed`. A
> coordinator completing without satisfying a workstream maps to intent
> `blocked`, not `failed`.

Updated `VALID_TRANSITIONS`:

```javascript
{
  detected:  ['triaged', 'suppressed'],
  triaged:   ['approved', 'rejected'],
  approved:  ['planned'],
  planned:   ['executing'],
  executing: ['blocked', 'completed'],  // 'failed' removed per DEC-RUN-STATUS-001
  blocked:   ['approved'],
}
```

Updated `S1_STATES`:

```
['detected', 'triaged', 'approved', 'planned', 'executing',
 'blocked', 'completed', 'failed', 'suppressed', 'rejected']
```

`failed` remains in the state union for read tolerance of historical or
manually-authored intent files. Current first-party intake writers do not emit
it.

Updated `TERMINAL_STATES`:

```
['suppressed', 'rejected', 'completed', 'failed']
```

`failed` remains terminal only as a tolerated legacy/read-only value. The
shipped resolve path does not transition new intents into it.

### State Definitions

- **`blocked`**: The governed run linked to this intent is blocked. The intent records the block reason and recovery information from the run. The intent can be re-approved (via existing `intake approve`) after the block is resolved, which transitions it back to `approved` for re-planning and re-execution.
- **`completed`**: The governed run completed successfully. The intent records the completion timestamp and final run evidence reference. Terminal state — no further transitions.
- **`failed`**: Reserved legacy/read-tolerant intent value. The shipped S5 resolve path does not produce it; if the governed run reports reserved run-level `failed`, `intake resolve` fails closed instead of mutating the intent.

---

## Behavior

### 1. Run Outcome Mapping

`resolveIntent()` reads `.agentxchain/state.json` and maps the governed run status to an intent transition:

| Governed Run Status | Intent Transition | Condition |
|---------------------|-------------------|-----------|
| `blocked` | `executing → blocked` | `state.status === 'blocked'` |
| `completed` | `executing → completed` | `state.status === 'completed'` |
| `failed` | Error (exit 1) | Reserved/unreached per `DEC-RUN-STATUS-001`. Fails closed. |
| `active` | No transition | Run is still active — intent stays `executing` |
| `paused` | No transition | Run is paused on a gate — intent stays `executing` |
| `idle` | Error | Run was reset — mismatched state |

### 2. Run Identity Validation

Before mapping, `resolveIntent()` validates:

1. The intent exists and has `status === 'executing'`.
2. The intent has a non-null `target_run` field.
3. The governed state file exists at `.agentxchain/state.json`.
4. The governed state's `run_id` matches the intent's `target_run`.

If `run_id` does not match `target_run`, the resolve fails with a mismatch error. This prevents stale intents from claiming outcomes of unrelated runs.

### 3. Evidence Capture

On transition, `resolveIntent()` copies outcome-relevant fields from the governed state onto the intent:

**For `blocked`:**
```json
{
  "run_blocked_on": "state.blocked_on",
  "run_blocked_reason": "state.blocked_reason.category",
  "run_blocked_recovery": "state.blocked_reason.recovery.recovery_action"
}
```

**For `completed`:**
```json
{
  "run_completed_at": "state.completed_at",
  "run_final_turn": "state.last_completed_turn_id"
}
```

These are additive fields on the intent — they reference run evidence without copying it wholesale. There is no shipped `run_failed_at` field because reserved run-level `failed` is rejected instead of being resolved into intake state.

### 4. No-Op When Run Is Still Active

If the governed run is `active` or `paused`, `resolveIntent()` returns `{ ok: true, new_status: 'executing', no_change: true }` with exit code 0. This is not an error — the run simply hasn't reached an outcome yet. The caller can poll.

### 5. History Entry

Every successful state transition appends a history entry:

```json
{
  "from": "executing",
  "to": "blocked|completed",
  "at": "ISO timestamp",
  "reason": "governed run {run_id} reached status {status}",
  "run_id": "the linked run_id",
  "run_status": "the governed run status"
}
```

### 6. Blocked Re-Approval Path

When an intent transitions to `blocked`, the recovery path is:

1. Operator resolves the run block (via `agentxchain step --resume` or manual intervention).
2. Operator calls `agentxchain intake approve --intent <id>` to re-authorize execution.
3. The intent transitions `blocked → approved`.
4. The operator can then `intake plan` and `intake start` again.

This reuses the existing `intake approve` command without modification — it just needs `blocked` added to the set of states that `approve` accepts as a source.

### 7. Observation Record Scaffolding

On `completed` transition, `resolveIntent()` creates the observation directory:

```
.agentxchain/intake/observations/<intent_id>/
```

This is an empty directory scaffold. Future slices will write post-release observation evidence here. S5 only creates the directory — it does not populate it.

---

## Error Cases

| Condition | Exit Code | Error Message |
|-----------|-----------|---------------|
| Intent ID not found | 2 | `intent {id} not found` |
| Intent status is not `executing` or `blocked` | 1 | `cannot resolve from status "{status}" (must be executing or blocked)` |
| Intent has no `target_run` | 1 | `intent {id} has no linked run (target_run is null)` |
| Governed state file missing | 1 | `governed state not found at .agentxchain/state.json` |
| Run ID mismatch | 1 | `run_id mismatch: intent targets {target_run} but governed state has {state.run_id}` |
| Governed run is idle | 1 | `governed run is idle — state may have been reset after intent start` |

---

## Acceptance Tests

### AT-V3S5-001: Blocked run transitions intent to blocked
Given an intent at `executing` linked to a governed run, when the run is `blocked`, then `intake resolve` transitions the intent to `blocked` and records `run_blocked_on`, `run_blocked_reason`, and `run_blocked_recovery`.

### AT-V3S5-002: Completed run transitions intent to completed
Given an intent at `executing` linked to a governed run, when the run is `completed`, then `intake resolve` transitions the intent to `completed` and records `run_completed_at` and `run_final_turn`.

### AT-V3S5-003: Reserved 'failed' run status is rejected
Given an intent at `executing` linked to a governed run, when the run has reserved status `failed`, then `intake resolve` fails closed with exit 1 and an error referencing `DEC-RUN-STATUS-001`. The intent is not modified.

### AT-V3S5-004: Active run returns no-change
Given an intent at `executing` linked to an active governed run, then `intake resolve` returns `ok: true` with `no_change: true` and the intent stays at `executing`.

### AT-V3S5-005: Paused run returns no-change
Given an intent at `executing` linked to a paused governed run, then `intake resolve` returns `ok: true` with `no_change: true` and the intent stays at `executing`.

### AT-V3S5-005b: Blocked intent can resolve after same-run recovery
Given an intent already at `blocked` from the same linked run, when that run later reaches `completed`, then `intake resolve` transitions the intent from `blocked` to `completed` instead of rejecting the recovery.

### AT-V3S5-006: Run ID mismatch rejection
Given an intent with `target_run: "run_A"` and a governed state with `run_id: "run_B"`, then `intake resolve` fails with exit 1 and a mismatch error.

### AT-V3S5-007: Missing governed state rejection
Given an intent at `executing` but no `.agentxchain/state.json` file, then `intake resolve` fails with exit 1.

### AT-V3S5-008: Non-executing intent rejection
Given an intent at `planned` status, then `intake resolve` fails with exit 1.

### AT-V3S5-009: Missing target_run rejection
Given an intent at `executing` with `target_run: null`, then `intake resolve` fails with exit 1.

### AT-V3S5-010: History entry records run linkage
After a successful `executing → blocked` transition, the intent's history array contains an entry with `run_id` and `run_status` fields.

### AT-V3S5-011: Blocked intent can be re-approved
After `intake resolve` transitions an intent to `blocked`, then `intake approve --intent <id>` succeeds and transitions the intent to `approved`.

### AT-V3S5-012: Completed intent creates observation directory
After `intake resolve` transitions an intent to `completed`, the directory `.agentxchain/intake/observations/<intent_id>/` exists.

### AT-V3S5-013: JSON output shape
When `--json` is passed, output includes `intent_id`, `previous_status`, `new_status`, `run_outcome`, and `no_change` fields.

### AT-V3S5-014: Idle run rejection
Given an intent at `executing` linked to a governed state with `status: 'idle'`, then `intake resolve` fails with exit 1.

---

## Open Questions

None. The shipped scope is deliberately narrow: read the run outcome, map it to the intent, record evidence pointers. No daemon, no auto-resolve, no policy hooks.
