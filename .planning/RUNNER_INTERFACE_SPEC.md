# Runner Interface Specification

## Purpose

Define the formal boundary between **runners** (execution engines that drive governed workflows) and the **governed execution library** (protocol-normative state machine). This is the contract a second runner (CI, hosted, programmatic) must satisfy.

## Problem Statement

PROTOCOL-v6.md §3 declares CLI command names non-normative and allows other runners. But there is no declared interface separating the runner layer from the execution engine. The CLI commands (`step.js`, `resume.js`, `accept-turn.js`) call `governed-state.js` directly. A second runner would need to reverse-engineer which library functions to call, in what order, and with what concurrency guarantees.

This spec formalizes the boundary that already exists implicitly.

## Interface: `GovernedRunnerOps`

A runner is any process that orchestrates governed turns by calling these operations in a valid sequence. The operations map 1:1 to existing `governed-state.js` exports.

### Lifecycle Operations

| Operation | Library Function | Description |
|---|---|---|
| `loadContext(dir?)` | `loadProjectContext()` | Load project root, config, and validation |
| `loadState(root, config)` | `loadProjectState()` | Load current governed state |
| `initRun(root, config)` | `initializeGovernedRun()` | Create a run envelope from idle state |
| `reactivateRun(root, state, details?)` | `reactivateGovernedRun()` | Reactivate a paused/blocked run |
| `assignTurn(root, config, roleId)` | `assignGovernedTurn()` | Assign a turn to a role |
| `acceptTurn(root, config, opts?)` | `acceptGovernedTurn()` | Validate and accept staged result |
| `rejectTurn(root, config, result, reason, opts?)` | `rejectGovernedTurn()` | Reject staged result with retry/escalation |
| `approvePhaseGate(root, config)` | `approvePhaseTransition()` | Approve pending phase transition |
| `approveCompletionGate(root, config)` | `approveRunCompletion()` | Approve pending run completion |
| `markBlocked(root, details)` | `markRunBlocked()` | Mark run as blocked |
| `escalate(root, config, details)` | `raiseOperatorEscalation()` | Raise operator escalation |

### Support Operations

| Operation | Library Function | Description |
|---|---|---|
| `writeDispatchBundle(root, config, assignment, state)` | `writeDispatchBundle()` | Write dispatch artifacts for agent |
| `runHooks(root, hooksConfig, phase, payload, opts?)` | `runHooks()` | Execute lifecycle hooks |
| `emitNotifications(root, config, state, event, payload?, turn?)` | `emitNotifications()` | Emit lifecycle notifications |
| `acquireLock(root)` | `acquireAcceptanceLock()` | Acquire acceptance lock |
| `releaseLock(root)` | `releaseAcceptanceLock()` | Release acceptance lock |

### Adapter Dispatch (Runner-Specific)

Adapter dispatch is the one operation that is runner-specific, not protocol-normative:

- The CLI runner dispatches via `manual-adapter.js`, `local-cli-adapter.js`, `api-proxy-adapter.js`, or `mcp-adapter.js`
- A CI runner would dispatch via its own mechanism (workflow steps, subprocess, API call)
- A hosted runner would dispatch via network RPC

The adapter contract is already specified in `ADAPTER_CONTRACT.md`. Runners choose which adapters to support.

## Result Ergonomics

- `assignTurn()` success returns the assigned `turn` at the top level in addition to `state`
- This is deliberate runner ergonomics, not a cosmetic alias: non-CLI consumers should not need to rediscover the newly assigned turn by traversing `state.active_turns`
- Failure results do not fabricate `turn: null`; unchanged failure semantics are clearer

## Valid Turn Sequence

A runner must execute turns in this sequence:

```
loadContext → loadState →
  [initRun if idle] →
  [reactivateRun if paused/blocked] →
  assignTurn →
  [adapter dispatch — runner-specific] →
  acceptTurn | rejectTurn →
  [approvePhaseGate | approveCompletionGate if pending]
```

This is the same sequence `step.js` implements. The protocol does not require this exact flow — it requires that the state machine transitions are valid. But this is the canonical happy-path sequence.

## Shared State Contract

All runners share state via the filesystem:

| Artifact | Path | Writer |
|---|---|---|
| Config | `agentxchain.json` | Human/init |
| State | `.agentxchain/state.json` | Runner (via governed-state.js) |
| History | `.agentxchain/history.jsonl` | Runner (via governed-state.js) |
| Decision Ledger | `.agentxchain/decision-ledger.jsonl` | Runner (via governed-state.js) |
| Dispatch Bundle | `.agentxchain/dispatch/turn-<id>/` | Runner (via dispatch-bundle.js) |
| Staging | `.agentxchain/staging/turn-result.json` | Agent |
| Locks | `.agentxchain/locks/accept-turn.lock` | Runner (via governed-state.js) |

## Concurrency

- Only one runner may operate on a repository at a time (enforced by `acquireAcceptanceLock()`)
- The lock has a 30-second stale timeout
- Parallel turns within a single runner are supported (via `getMaxConcurrentTurns()`)
- Multi-runner coordination on the same repo is NOT supported in v1 — runners must coordinate externally

## What Is NOT Part of the Runner Interface

- CLI command parsing (Commander.js)
- CLI output formatting (chalk)
- Dashboard serving
- Export/report generation
- Template management
- Intake lifecycle (separate from governed turn execution)

These are runner features, not protocol operations. A CI runner does not need a dashboard. A programmatic runner does not need chalk.

## Acceptance Tests

- `AT-RUNNER-001`: A non-CLI consumer can `loadContext`, `loadState`, `initRun`, `assignTurn`, and `acceptTurn` on a governed project
- `AT-RUNNER-002`: The governed state machine produces valid state transitions when called programmatically (no CLI subprocess)
- `AT-RUNNER-003`: `acquireAcceptanceLock` prevents concurrent acceptance
- `AT-RUNNER-004`: A programmatic runner can execute a complete governed turn lifecycle (init → assign → accept) and produce the same artifacts as `agentxchain step`
- `AT-RUNNER-005`: The runner interface exports are stable and documented

## Open Questions

- Should the runner interface be a declared ES module export, or remain implicit library functions? (This spec proposes a declared export.)
- Should multi-runner coordination require a lock server, or is external coordination sufficient for v1?
