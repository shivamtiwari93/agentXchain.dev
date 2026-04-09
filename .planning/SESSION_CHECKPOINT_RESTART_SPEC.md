# Session Checkpoint / Restart Spec

## Purpose

Enable governed runs to survive session boundaries (terminal close, machine restart, context window exhaustion, agent crash) by automatically checkpointing run state at key governance boundaries and allowing explicit restart from the last checkpoint.

This is the next honest step toward VISION.md's "long-horizon AI software delivery" and "lights-out software factories."

## Current State

- `resume` reactivates a paused/idle governed run within the same session context.
- `restore --input` imports full governed state across machines when both are at the same `HEAD`.
- `export` packages governed state for portability.
- **Gap**: if a session dies mid-run (between `step`/`run` invocations), the operator must manually reconstruct where the run was. There is no automatic checkpoint, no session-boundary marker, and no "pick up where I left off" command that reconstructs dispatch context from durable state.

## Design

### Automatic Checkpoints

At every governance boundary (turn acceptance, phase transition, gate evaluation, human approval), the runtime already writes to `.agentxchain/state.json`, `decision-ledger.jsonl`, and `history.jsonl`. These are durable. The missing piece is a **session manifest** that records enough context for a new session to reconstruct the dispatch environment.

**New file**: `.agentxchain/session.json`

```json
{
  "session_id": "uuid",
  "run_id": "uuid",
  "started_at": "ISO-8601",
  "last_checkpoint_at": "ISO-8601",
  "last_turn_id": "turn-003",
  "last_phase": "implementation",
  "last_role": "dev",
  "checkpoint_reason": "turn_accepted",
  "agent_context": {
    "model": "claude-opus-4-6",
    "adapter": "api_proxy",
    "dispatch_dir": ".agentxchain/dispatch/turns/turn-003"
  }
}
```

Written/updated automatically by `accept-turn`, `step`, `run`, and `approve-gate` at every state mutation that advances the governed run.

### Explicit Restart

**New command**: `agentxchain restart`

Behavior:
1. Reads `.agentxchain/session.json` and `.agentxchain/state.json`
2. Validates the run is in a resumable state (paused, idle, or active-but-no-assigned-turn)
3. Reconstructs the dispatch context from durable state (not from in-memory session)
4. Assigns the next turn based on routing and current phase
5. Prints a summary: "Restarting run {run_id} from checkpoint: phase={phase}, last_turn={turn_id}, role={next_role}"

This is different from `resume` in one critical way: `resume` assumes the caller has session context. `restart` assumes the caller has **no** session context and must reconstruct everything from disk.

### Session Recovery Report

When `restart` runs, it also writes `.agentxchain/SESSION_RECOVERY.md` with:
- Run identity (run_id, project_id)
- Checkpoint state (phase, turn, role)
- Decisions since last session (from ledger)
- Artifacts produced since last session
- What the next turn should do

This is the "briefing document" for a new agent session picking up a long-horizon run.

## Interface

```
agentxchain restart [--role <role>] [--dir <path>]
```

Options:
- `--role`: Override the next role assignment (default: derived from routing)
- `--dir`: Target directory (default: cwd)

Exit codes:
- 0: restart successful, turn assigned
- 1: no checkpoint found, or run is in a terminal state (completed/failed)

## Behavior

1. If no `.agentxchain/session.json` exists → exit 1 with "No checkpoint found. Use `resume` or `run` to start."
2. If `state.json` shows `completed` or `failed` → exit 1 with "Run is in terminal state."
3. If `state.json` shows `blocked` → exit 1 with "Run is blocked. Use `step --resume` or resolve the blocker first."
4. If `state.json` shows `active` with an assigned turn → warn "Turn {turn_id} was assigned but never completed. Re-dispatching." and re-assign.
5. Otherwise → assign next turn, write dispatch bundle, write session recovery report.

## Error Cases

- Corrupted `session.json` → fall back to `state.json` only; warn but proceed.
- `session.json` references a different `run_id` than `state.json` → reject with mismatch error.
- No `state.json` at all → exit 1 with "No governed run found."

## Acceptance Tests

- AT-SCR-001: `restart` succeeds on a paused run with a valid checkpoint and assigns the next turn.
- AT-SCR-002: `restart` fails with exit 1 on a completed run.
- AT-SCR-003: `restart` fails with exit 1 when no checkpoint exists.
- AT-SCR-004: `restart` re-dispatches an abandoned active turn (assigned but never accepted).
- AT-SCR-005: `restart` writes `SESSION_RECOVERY.md` with run identity, phase, and decision summary.
- AT-SCR-006: Automatic checkpoint is written by `accept-turn` and updated by `approve-gate`.
- AT-SCR-007: `restart` with `--role` override assigns the specified role instead of the routing default.
- AT-SCR-008: `restart` rejects when `session.json` run_id mismatches `state.json` run_id.

## Open Questions

- Should `run` (the automated loop) also auto-checkpoint between turns? Likely yes — this makes `restart` work after `run` crashes mid-loop.
- Should `restart` optionally re-emit the full dispatch context to stdout for piping into a new agent session? Deferred to v2.
