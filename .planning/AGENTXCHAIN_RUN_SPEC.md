# `agentxchain run` Command Specification

## Purpose

Provide the operator-facing CLI command that drives a governed run to terminal state using the `runLoop` library. This is a **thin CLI surface** — it wires `runLoop` callbacks to the existing adapter system, terminal output, and interactive gate prompting. It does not duplicate any logic from `step.js` or `run-loop.js`.

This is NOT a reimplementation of `step` in a loop. This is the first CLI consumer of the `runLoop` library.

## Problem Statement

The library layer (`run-loop.js`) is proven at three tiers (single-turn, multi-turn, run-loop composition). But an operator cannot use it. There is no `agentxchain run` command. The only way to execute a multi-turn governed lifecycle today is to call `agentxchain step` repeatedly with manual gate approvals between turns. That is fine for debugging but unusable for continuous governed delivery.

The gap is not "more proof." The gap is the operator surface.

## Interface

### Module

`cli/src/commands/run.js`

Exports one function:

```js
export async function runCommand(opts)
```

### CLI Registration

```js
program
  .command('run')
  .description('Drive a governed run to completion: multi-turn execution with gate prompting')
  .option('--role <role>', 'Override the initial role (default: config-driven selection)')
  .option('--max-turns <n>', 'Maximum turns before stopping (default: 50)', parseInt)
  .option('--auto-approve', 'Auto-approve all gates (non-interactive mode)')
  .option('--verbose', 'Stream adapter subprocess output')
  .option('--dry-run', 'Print what would be dispatched without executing')
  .action(runCommand);
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--role <role>` | string | config-driven | Override role for the first turn only. Subsequent turns use `next_recommended_role` or config phase order. |
| `--max-turns <n>` | number | 50 | Safety limit passed to `runLoop`. |
| `--auto-approve` | boolean | false | Auto-approve all gate pauses. When false, gates prompt interactively on stdin. |
| `--verbose` | boolean | false | Stream `local_cli` and `mcp` adapter stderr/stdout during dispatch. |
| `--dry-run` | boolean | false | Load config, resolve first role, print the dispatch plan, exit without executing. |

## Behavior

### Startup

1. Load project context via `loadProjectContext()`. Reject if not a governed project.
2. If `--dry-run`: resolve first role, print plan summary (role order, adapter types, gate config), exit 0.
3. Print run header: `Run starting — max turns: N, gate mode: interactive|auto-approve`.

### runLoop Callback Wiring

The `run` command calls `runLoop(root, config, callbacks, options)` exactly once with these callbacks:

#### `selectRole(state, config)`

1. On the first call, if `--role` was provided, return that role.
2. On subsequent calls, use the same resolution logic as `step.js`:
   - `state.next_recommended_role` if present and routing-legal for the current phase
   - Phase `routing.entry_role`
   - First role in `config.roles`
3. Return `null` if no role can be determined (signals `caller_stopped`).

This is a **pure function** — no side effects, no I/O.

#### `dispatch(context)`

This is where the `run` command bridges `runLoop` to the existing adapter system. The dispatch callback:

1. Resolves the runtime type: `runtime?.type || role?.runtime_class || 'manual'`.
2. Runs `after_dispatch` hooks via `runHooks()`.
3. Finalizes the dispatch manifest via `finalizeDispatchManifest()`.
4. Routes to the correct adapter:
   - `api_proxy` → `dispatchApiProxy(root, state, config, adapterOpts)`
   - `mcp` → `dispatchMcp(root, state, config, adapterOpts)`
   - `local_cli` → `dispatchLocalCli(root, state, config, adapterOpts)`
   - `manual` → **REJECT with reason**. The `run` command does not support the manual adapter. Manual dispatch requires an operator in the loop; `agentxchain step` is the correct surface. Return `{ accept: false, reason: 'manual adapter is not supported in run mode — use agentxchain step' }`.

5. If the adapter succeeds (staged result exists): return `{ accept: true, turnResult: <parsed staged result> }`.
6. If the adapter fails: return `{ accept: false, reason: <error summary> }`.

The dispatch callback does NOT call `acceptTurn` or `rejectTurn` — that is `runLoop`'s job. It only produces or fails to produce a turn result.

**Important boundary**: the dispatch callback reads the staged result from the adapter's output path (`getTurnStagingResultPath`), parses it, and returns it as `turnResult`. The `runLoop` handles validation and acceptance.

Wait — checking `run-loop.js` behavior: the loop calls `dispatch(context)` and if `accept: true`, it stages the result at `context.stagingPath` and calls `acceptTurn`. So the dispatch callback must write the turn result to `context.stagingPath` (or confirm the adapter already wrote it there) and return `{ accept: true, turnResult }`.

Actually, re-reading the run-loop source: the adapters already write to the staging path. The dispatch callback's job is:
1. Call the adapter.
2. If the adapter succeeded and staged a result, read the staged result, return `{ accept: true, turnResult }`.
3. If the adapter failed, return `{ accept: false, reason }`.

The `runLoop` then calls `acceptTurn(root, config, { turnResult })` or `rejectTurn(root, config, { reason })`.

#### `approveGate(gateType, state)`

- If `--auto-approve`: return `true` immediately. Print `chalk.yellow(`Auto-approved ${gateType} gate`)`.
- Otherwise: prompt on stdin with `readline`:
  ```
  Gate pause: <gateType>
  Phase: <state.phase> → <state.pending_phase_transition?.target || 'completion'>
  Approve? [y/N]
  ```
  Return `true` if user types `y` or `yes` (case-insensitive). Return `false` otherwise.

Fail-closed: empty input, EOF, or anything other than `y`/`yes` returns `false` (gate held).

#### `onEvent(event)`

Print structured lifecycle output using chalk:

| Event Type | Output |
|------------|--------|
| `turn_assigned` | `chalk.cyan(`Turn assigned: ${turnId} → ${role}`)` |
| `turn_accepted` | `chalk.green(`Turn accepted: ${turnId}`)` |
| `turn_rejected` | `chalk.yellow(`Turn rejected: ${turnId} — ${reason}`)` |
| `gate_paused` | `chalk.yellow(`Gate paused: ${gateType}`)` |
| `gate_approved` | `chalk.green(`Gate approved: ${gateType}`)` |
| `gate_held` | `chalk.yellow(`Gate held: ${gateType} — run paused`)` |
| `blocked` | `chalk.red(`Run blocked: ${reason}`)` |
| `completed` | `chalk.green.bold(`Run completed`)` |
| `caller_stopped` | `chalk.yellow(`Run stopped by caller`)` |

### Post-Loop Output

After `runLoop` returns, print a summary:

```
─── Run Summary ───
Status:    <ok ? 'completed' : stop_reason>
Turns:     <turns_executed>
Gates:     <gates_approved> approved
Errors:    <errors.length || 'none'>
```

If `stop_reason` is `blocked` or `reject_exhausted`, also print the recovery descriptor via `deriveRecoveryDescriptor(state)`.

### Exit Codes

| Condition | Exit Code |
|-----------|-----------|
| `ok: true` (completed) | 0 |
| `gate_held` | 0 (operator chose to hold — not an error) |
| `caller_stopped` | 0 |
| `max_turns_reached` | 0 (safety limit, not a failure) |
| `blocked` | 1 |
| `reject_exhausted` | 1 |
| `dispatch_error` | 1 |
| `init_failed` | 1 |

### SIGINT Handling

Register a SIGINT handler that:
1. On first SIGINT: sets an abort flag. The current adapter dispatch (if any) receives an `AbortSignal`. The `run` loop will stop after the current turn.
2. On second SIGINT: `process.exit(130)` (standard SIGINT exit).

The run loop's `selectRole` callback checks the abort flag and returns `null` if set, yielding `caller_stopped`.

## Boundary Rules

1. **No duplication of step.js logic.** The `run` command does not contain its own turn assignment, validation, acceptance, or rejection logic. All of that lives in `runLoop`.
2. **No duplication of adapter dispatch routing.** Extract a shared `dispatchToAdapter(root, state, config, opts)` function from `step.js` into `cli/src/lib/adapter-dispatch.js` if the routing logic is identical. If not identical (e.g., `run` rejects manual, `step` supports it), keep them separate but document why.
3. **No shadow copy of `step` behavior.** The `run` command calls `runLoop` once. It does not implement "step in a loop."
4. **`runLoop` owns the state machine.** The `run` command never calls `assignTurn`, `acceptTurn`, `rejectTurn`, `approvePhaseGate`, or `approveCompletionGate` directly.
5. **Hooks execute inside the dispatch callback**, not in `runLoop`. This is correct because hooks are runner-specific (per `RUN_LOOP_LIBRARY_SPEC.md`).

## What `run` Does NOT Support

- **Manual adapter.** Use `agentxchain step` for manual dispatch.
- **`--resume` for individual turns.** Use `agentxchain step --resume` for that.
- **Parallel turns.** The `runLoop` currently drives sequential turns. Parallel turn orchestration is a future concern.
- **Custom role schedules.** The `selectRole` callback follows the same resolution as `step.js`. Custom schedules can be added later by making `selectRole` configurable.

## Error Cases

| Scenario | Behavior |
|----------|----------|
| Not a governed project | Print error, exit 1 |
| `--role` references an unknown role | Print error, exit 1 before entering `runLoop` |
| `runLoop` returns `init_failed` | Print error, exit 1 |
| Adapter dispatch throws unexpectedly | Caught by dispatch callback, returned as `{ accept: false, reason }`. `runLoop` handles retry/block. |
| Gate prompt fails (stdin closed) | `approveGate` returns `false` (fail-closed). `runLoop` returns `gate_held`. |
| SIGINT during dispatch | Abort signal propagated to adapter. Turn left assigned. Next `selectRole` returns `null`. |
| All turns exhausted | `runLoop` returns `max_turns_reached`. Summary printed, exit 0. |

## Acceptance Tests

### Unit Tests (in `cli/test/run-command.test.js`)

- `AT-RUN-001`: `runCommand` with `--dry-run` prints plan summary and exits 0 without calling `runLoop`.
- `AT-RUN-002`: `runCommand` calls `runLoop` exactly once with the correct callback shape.
- `AT-RUN-003`: `selectRole` returns `--role` value on first call, then falls back to config-driven resolution.
- `AT-RUN-004`: `selectRole` returns `null` when no role can be determined.
- `AT-RUN-005`: `approveGate` returns `true` when `--auto-approve` is set.
- `AT-RUN-006`: `approveGate` returns `false` on non-`y` input (fail-closed).
- `AT-RUN-007`: dispatch callback returns `{ accept: false, reason }` for manual runtime type.
- `AT-RUN-008`: dispatch callback routes `api_proxy` to `dispatchApiProxy`.
- `AT-RUN-009`: dispatch callback routes `local_cli` to `dispatchLocalCli`.
- `AT-RUN-010`: dispatch callback routes `mcp` to `dispatchMcp`.
- `AT-RUN-011`: exit code is 0 for `completed`, `gate_held`, `caller_stopped`, `max_turns_reached`.
- `AT-RUN-012`: exit code is 1 for `blocked`, `reject_exhausted`, `dispatch_error`, `init_failed`.
- `AT-RUN-013`: `onEvent` callback prints correct chalk-formatted output for each event type.
- `AT-RUN-014`: SIGINT sets abort flag; next `selectRole` returns `null`.

### Integration Tests (with real governed state)

- `AT-RUN-INT-001`: `agentxchain run --max-turns 3` with `api_proxy` adapter completes a 3-turn governed lifecycle and exits 0.
- `AT-RUN-INT-002`: `agentxchain run` with a gate requiring human approval prompts on stdin and holds when denied.
- `AT-RUN-INT-003`: `agentxchain run --auto-approve` auto-advances through gates without prompting.

### Guard Tests (structural)

- `AT-RUN-GUARD-001`: `run.js` does not import from `governed-state.js` directly. Runner-specific transport lifecycle hooks may be imported only through `runner-interface.js`; raw governed-state imports remain banned.
- `AT-RUN-GUARD-002`: `run.js` does not call `assignTurn`, `acceptTurn`, `rejectTurn`, `approvePhaseGate`, or `approveCompletionGate` directly.
- `AT-RUN-GUARD-003`: `run` command is registered in `agentxchain.js` with the correct options.

## Open Questions

1. **Shared adapter dispatch extraction.** Should the adapter routing logic be extracted from `step.js` into a shared module, or kept separate? The `run` dispatch rejects `manual` while `step` supports it — this divergence may justify separate implementations. Decision deferred to implementation.
2. **`runLoop` and hooks.** The `runLoop` spec says hooks are runner-specific. But `before_validation` and `after_validation` hooks currently run inside `step.js` after dispatch. Should `run`'s dispatch callback also run validation hooks, or should validation hooks move into the library? For now, the dispatch callback runs `after_dispatch` hooks. Validation hooks are handled by `acceptTurn` if they are part of the acceptance pipeline, or omitted from `run` initially.
3. **Non-interactive gate behavior without `--auto-approve`.** If stdin is not a TTY (e.g., CI pipe), should gates fail-closed or should the command require `--auto-approve`? Lean toward fail-closed with a warning message.
4. **Shared role-resolution helper.** Resolved in implementation: `step` and `run` now share `cli/src/lib/role-resolution.js` so override validation, routing legality, and entry-role fallback cannot drift independently.
