# Multi-Session Governed Continuity Spec

**Status:** Draft
**Author:** Claude Opus 4.6 (Turn 181)
**Decision:** `DEC-SESSION-CONTINUITY-001`

## Purpose

Prove that a governed run survives process boundaries. An operator can:

1. Start a governed run and complete a turn in **Session A**
2. Terminate the process completely
3. Resume the same run in **Session B** (fresh process) with full state, history, and decision ledger continuity
4. Recover from blocked state across sessions
5. Complete the run in a session different from the one that started it

This is the foundational proof for long-horizon execution — the vision's "lights-out software factory" requires runs that outlive any single process.

## Interface

No new commands or APIs. This spec validates that the existing `resume`, `accept-turn`, `escalate`, and `status` commands maintain continuity when invoked from separate processes against the same `.agentxchain/` state directory.

## Behavior

### Session A (Start + First Turn)

1. `agentxchain init --governed` scaffolds project
2. `agentxchain resume --role pm` initializes run and assigns first turn
3. Turn result is staged and accepted via `agentxchain accept-turn`
4. State is `active`, history has 2+ entries (assigned + accepted), ledger has 1+ decision
5. Process exits completely

### Session B (Resume + Second Turn)

1. Fresh process loads the same project directory
2. `agentxchain resume --role dev` assigns a new turn in the **same run** (same `run_id`)
3. Turn result is staged and accepted
4. State shows `last_completed_turn_id` from Session B, but history contains entries from **both** sessions
5. Decision ledger contains entries from **both** sessions

### Session C (Blocked Recovery Across Sessions)

1. Fresh process loads same project directory
2. `agentxchain escalate --reason "Cross-session recovery proof"` blocks the run
3. Process exits
4. Another fresh process runs `agentxchain resume` to recover from blocked
5. State is `active`, `blocked_on` is cleared, ledger contains both escalation and resolution entries from separate sessions

### Session D (Completion)

1. Fresh process assigns final turn, stages completion result, accepts it
2. Run transitions to `completed`
3. History contains entries spanning all sessions
4. Decision ledger is append-only across all sessions

## Invariants

1. **`run_id` identity**: The same `run_id` persists across all sessions. No session creates a new run.
2. **History append-only**: Each session appends to `.agentxchain/history.jsonl`. No session truncates or rewrites prior entries.
3. **Ledger append-only**: Each session appends to `.agentxchain/decision-ledger.jsonl`. No session truncates or rewrites prior entries.
4. **Turn numbering**: Turn sequence is monotonic across sessions. Session B's turn numbers are higher than Session A's.
5. **State consistency**: `state.json` reflects the cumulative result of all sessions' operations.

## Error Cases

- **Stale state read**: A session that reads state before another session writes should not corrupt on next write. (Out of scope for single-operator E2E — this is a future concurrent-access concern.)
- **Corrupt state file**: If `state.json` is corrupted between sessions, the next session should fail with a clear parse error, not silent corruption.

## Acceptance Tests

### AT-SESSION-001: Cross-session run identity
Start run in process A, resume in process B. Assert same `run_id` in both sessions.

### AT-SESSION-002: Cross-session history continuity
Accept a turn in process A, accept another turn in process B. Assert `history.jsonl` contains entries from both sessions (minimum 4 entries: 2 assignments + 2 acceptances).

### AT-SESSION-003: Cross-session ledger continuity
Record decisions in process A and process B. Assert `decision-ledger.jsonl` contains entries from both sessions.

### AT-SESSION-004: Cross-session blocked recovery
Block run in process A, recover via `resume` in process B. Assert `blocked_on` is cleared and ledger has both escalation and resolution.

### AT-SESSION-005: Cross-session completion
Complete run across multiple sessions. Assert final state is `completed` with history spanning all sessions.

### AT-SESSION-006: Turn sequence monotonicity
Turns assigned in later sessions have higher sequence numbers than turns from earlier sessions.

## Open Questions

None. The existing state persistence model (file-based JSON/JSONL) already supports this by design. The spec exists to **prove** it works, not to implement new behavior.
