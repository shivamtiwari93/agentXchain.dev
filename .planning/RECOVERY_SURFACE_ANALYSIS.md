# Recovery Surface Analysis

> Decision: A dedicated `agentxchain recover` command is NOT justified.
> The existing command surface covers all recoverable failure states.
> This document closes the recovery gap with evidence instead of new code.

## Status

**CLOSED** — recovery surface is complete via existing commands.

## Analysis Method

Every blocked/failed state in `governed-state.js` and `blocked-state.js` was traced to its recovery path. The `deriveRecoveryDescriptor()` function is the canonical map from governed state to operator recovery action.

## Complete Recovery Map

| typed_reason | Entry Condition | Recovery Command | Turn Retained |
|---|---|---|---|
| `pending_run_completion` | Run reached final phase, completion gate pending | `agentxchain approve-completion` | No |
| `pending_phase_transition` | Phase gate requires human approval | `agentxchain approve-transition` | No |
| `needs_human` | Agent returned `blocked_on: "human:*"` | Fix external issue, then `step --resume` | Depends |
| `dispatch_error` | Adapter dispatch failed (api_proxy, mcp, local_cli) | Fix issue, then `step --resume` | Yes |
| `operator_escalation` | Operator raised via `agentxchain escalate` | Resolve, then `step` or `step --resume` | Depends |
| `retries_exhausted` | Max retries hit on a role turn | `step --resume` (turn preserved) | Yes |
| `hook_block` | Lifecycle hook failed without tampering | Fix hook, then `step --resume` or `resume --role` | Depends |
| `hook_tamper` | Hook detected file tampering | Fix tampering, then `step --resume` | Depends |
| `unknown_block` | Unrecognized `blocked_on` prefix | Manual inspection + `step` | Depends |

## Additional Recovery Paths (Not Blocked States)

| Condition | Recovery Command |
|---|---|
| Active turn exists, no resume flag | `step --resume` to continue waiting |
| Conflicted turn (overlapping changes) | `reject-turn --reassign` or `accept-turn --resolution human_merge` |
| Validation failure (retryable) | `reject-turn` then `step` |
| Validation failure (non-retryable) | Manual fix then `accept-turn` |
| Dirty authoritative tree | `git commit` or `git stash`, then `step` |
| Idle with no run | `step` or `resume --role` (initializes new run) |
| Paused with failed/retrying turn | `resume` (re-dispatches same turn) |

## Why `agentxchain recover` Is Not Justified

1. **No unrecoverable states exist.** Every `blocked_on` prefix maps to a recovery action via `deriveRecoveryDescriptor()`.

2. **Recovery actions are already surfaced.** `status`, `step`, `resume`, and `escalate` all print the exact recovery action when a blocked state is detected. The operator never has to guess.

3. **A catch-all command would duplicate logic.** The recovery paths are inherently command-specific: approval gates use `approve-*`, dispatch failures use `step --resume`, escalations use `step`/`step --resume`. A unified `recover` command would either (a) be a router that calls the same code, adding indirection without value, or (b) implement parallel logic that drifts from the real recovery paths.

4. **The recovery descriptor IS the product contract.** `deriveRecoveryDescriptor()` returns `typed_reason`, `owner`, `recovery_action`, and `turn_retained` — a machine-readable recovery instruction set. Any automation can call this function directly.

## Decision

- `DEC-RECOVERY-SURFACE-001`: A dedicated `agentxchain recover` command is not justified. The existing `step --resume`, `resume`, `approve-transition`, `approve-completion`, `reject-turn`, `accept-turn`, and `escalate` commands cover all recoverable failure states.
- `DEC-RECOVERY-SURFACE-002`: The canonical recovery contract is `deriveRecoveryDescriptor()` in `blocked-state.js`. Any new blocked state MUST be added to this function with a recovery action.
- `DEC-RECOVERY-SURFACE-003`: A public `/docs/recovery` page documents the complete operator recovery map, backed by a code guard test.
