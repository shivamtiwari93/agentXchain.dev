# Run-Loop Library Specification

## Purpose

Provide a reusable library function that drives repeated governed turns to a terminal state, yielding control at well-defined pause points. This is the programmatic governed-execution engine that any runner (CLI, CI, hosted, custom) composes to implement continuous governed delivery.

This is NOT a CLI command. This is NOT "loop step." This is a state-machine driver that reads governed state, decides whether to continue, and yields typed stop reasons when human intervention or external decisions are required.

## Problem Statement

The multi-turn runner proof (`run-to-completion.mjs`) demonstrated that the runner interface can drive a full governed lifecycle. But the proof hardcodes a specific three-turn sequence. A real runner cannot know the turn sequence in advance. It needs a library that:

1. Advances turns until the run reaches a terminal or paused state
2. Yields a typed stop reason so the caller knows exactly why execution stopped and what to do next
3. Delegates role selection and turn-result production to caller-supplied callbacks
4. Handles gate pauses, approval hand-off, rejection/retry, blocked recovery, and completion transparently
5. Never calls `process.exit`, never prints to stdout, never dispatches to adapters

## Interface

### Module

`cli/src/lib/run-loop.js`

Exports one function:

```js
export async function runLoop(root, config, callbacks)
```

### Callbacks

```js
/**
 * @typedef {Object} RunLoopCallbacks
 *
 * @property {(state: object, config: object) => string | null} selectRole
 *   Called before each turn. Return a role ID to assign, or null to signal
 *   that the caller wants to stop (yields stop reason 'caller_stopped').
 *
 * @property {(context: DispatchContext) => Promise<TurnResultOrReject>} dispatch
 *   Called after turn assignment and dispatch bundle generation.
 *   Receives the assigned turn, bundle path, and staging path.
 *   Must return either:
 *     { accept: true, turnResult: object }   — stage the result and accept
 *     { accept: false, reason: string }       — reject the turn
 *
 * @property {(gateType: 'phase_transition' | 'run_completion', state: object) => Promise<boolean>} approveGate
 *   Called when a gate pause is reached. Return true to approve, false to
 *   yield a stop reason ('gate_held').
 *
 * @property {(event: RunLoopEvent) => void} [onEvent]
 *   Optional lifecycle observer. Called for: turn_assigned, turn_accepted,
 *   turn_rejected, gate_paused, gate_approved, gate_held, blocked, completed.
 *   Advisory only — must not throw.
 */
```

### DispatchContext

```js
/**
 * @typedef {Object} DispatchContext
 * @property {object} turn        — the assigned turn object
 * @property {object} state       — governed state after assignment
 * @property {string} bundlePath  — absolute path to dispatch bundle directory
 * @property {string} stagingPath — relative path for staging the turn result
 * @property {object} config      — the governed config
 * @property {string} root        — the project root
 */
```

### Return Value

```js
/**
 * @typedef {Object} RunLoopResult
 * @property {boolean} ok            — true if the run reached 'completed'
 * @property {string}  stop_reason   — why the loop stopped (see Stop Reasons)
 * @property {object}  state         — final governed state
 * @property {number}  turns_executed — count of accepted turns
 * @property {Array}   turn_history  — array of { role, turn_id, accepted }
 * @property {number}  gates_approved — count of gates approved during this loop
 * @property {Array}   errors        — any errors encountered
 */
```

### Stop Reasons

| Reason | Meaning |
|---|---|
| `completed` | Run reached `state.status === "completed"` |
| `gate_held` | A gate pause was reached and `approveGate` returned false |
| `blocked` | Run entered `state.status === "blocked"` (hook failure, dispatch error, retry exhaustion) |
| `caller_stopped` | `selectRole` returned null |
| `max_turns_reached` | Safety limit on turns per loop invocation was hit |
| `reject_exhausted` | A turn was rejected and retries are exhausted (run blocked) |
| `dispatch_error` | `dispatch` callback threw or returned an unrecoverable error |
| `init_failed` | `initRun` failed (run already active, config error) |

## Behavior

### Main Loop

```
1. If state.status === 'idle', call initRun(root, config)
2. Loop:
   a. Read current state
   b. If state.status === 'completed' → return stop_reason: 'completed'
   c. If state.status === 'blocked' → return stop_reason: 'blocked'
   d. If state.status === 'paused':
      - If pending_phase_transition → call approveGate('phase_transition', state)
        - If approved → approvePhaseGate(root, config), continue loop
        - If held → return stop_reason: 'gate_held'
      - If pending_run_completion → call approveGate('run_completion', state)
        - If approved → approveCompletionGate(root, config), continue loop
        - If held → return stop_reason: 'gate_held'
      - Otherwise → return stop_reason: 'blocked' (unknown pause)
   e. If turns_executed >= max_turns → return stop_reason: 'max_turns_reached'
   f. Call selectRole(state, config)
      - If null → return stop_reason: 'caller_stopped'
   g. Call assignTurn(root, config, roleId)
      - If failed → return stop_reason: 'blocked' with error
   h. Call writeDispatchBundle(root, state, config)
   i. Call dispatch(context)
      - If accept: true → stage result, call acceptTurn(root, config)
        - If accept failed → return stop_reason: 'blocked'
      - If accept: false → call rejectTurn(root, config, ...)
        - If retries exhausted → return stop_reason: 'reject_exhausted'
        - Otherwise → continue loop (retry with same role)
   j. Emit onEvent, increment counters
   k. Continue loop
```

### Safety Limits

- `max_turns`: default 50. Caller can override via `config.run_loop?.max_turns` or a fourth argument. Prevents runaway execution.
- No time limit at the library level. Callers implement their own timeouts.

### Boundary Rules

1. **No `process.exit`**. The run loop returns a result; it never terminates the process.
2. **No stdout/stderr**. All communication is through the return value and `onEvent` callback.
3. **No adapter dispatch**. The `dispatch` callback is the caller's responsibility. The library writes the dispatch bundle and provides the staging path; the caller produces the turn result however it wants.
4. **No CLI imports**. The run loop imports only from `runner-interface.js`.
5. **Cleanup is automatic**. `acceptTurn` already handles dispatch bundle and staging cleanup. The run loop does not duplicate this.

## Error Cases

| Scenario | Behavior |
|---|---|
| `initRun` fails | Return `{ ok: false, stop_reason: 'init_failed', errors: [...] }` |
| `assignTurn` fails | Return `{ ok: false, stop_reason: 'blocked', errors: [...] }` |
| `dispatch` callback throws | Return `{ ok: false, stop_reason: 'dispatch_error', errors: [...] }` |
| `acceptTurn` returns `ok: false` with blocked state | Return `{ ok: false, stop_reason: 'blocked' }` |
| `approveGate` throws | Return `{ ok: false, stop_reason: 'blocked', errors: [...] }` |
| Turn rejected, retries exhausted, run blocked | Return `{ ok: false, stop_reason: 'reject_exhausted' }` |
| `max_turns` exceeded | Return `{ ok: false, stop_reason: 'max_turns_reached' }` |

## Acceptance Tests

- `AT-RUNLOOP-001`: `runLoop` drives a 3-turn governed lifecycle to `completed` with a mock dispatch callback (equivalent to the multi-turn proof).
- `AT-RUNLOOP-002`: `runLoop` yields `gate_held` when `approveGate` returns false on a phase transition.
- `AT-RUNLOOP-003`: `runLoop` yields `caller_stopped` when `selectRole` returns null.
- `AT-RUNLOOP-004`: `runLoop` yields `max_turns_reached` when the safety limit is hit.
- `AT-RUNLOOP-005`: `runLoop` yields `blocked` when `acceptTurn` produces a blocked state.
- `AT-RUNLOOP-006`: `runLoop` handles rejection and retry: dispatch returns `{ accept: false }`, the loop retries, and succeeds on the second attempt.
- `AT-RUNLOOP-007`: `runLoop` yields `reject_exhausted` when retries are exhausted.
- `AT-RUNLOOP-008`: `runLoop` handles auto-advancing phase gates (no `requires_human_approval`) without calling `approveGate`.
- `AT-RUNLOOP-009`: `runLoop` emits `onEvent` for every lifecycle transition.
- `AT-RUNLOOP-010`: `runLoop` imports only from `runner-interface.js` (boundary purity guard).
- `AT-RUNLOOP-011`: `runLoop` initializes an idle run automatically.
- `AT-RUNLOOP-012`: `runLoop` contains no `process.exit`, no `console.log`, no `child_process`.

## Open Questions

- Whether `runLoop` should accept an `AbortSignal` for cooperative cancellation (defer until a caller needs it).
- Whether the `onEvent` callback should be async-capable (start sync-only for simplicity).
- Whether `runLoop` should expose hook/notification execution or leave that entirely to callers (lean toward leaving it out — hooks are runner-specific).
