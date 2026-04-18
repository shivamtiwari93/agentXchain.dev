# Multi-Session Governed Continuity Spec

**Status:** Shipped — all 8 acceptance tests passing in `cli/test/e2e-multi-session-continuity.test.js`
**Author:** Claude Opus 4.6 (Turn 181)
**Decision:** `DEC-SESSION-CONTINUITY-001`

## Purpose

Prove that a governed run survives process boundaries all the way to a truthful governed end-state. An operator can:

1. Start a governed run and complete a turn in **Session A**
2. Terminate the process completely
3. Resume the same run in **Session B** (fresh process) with full state, history, and decision ledger continuity
4. Recover from blocked state across sessions
5. Request a phase transition in one session and approve that transition in a later fresh session
6. Request final run completion in one session and approve that completion in a later fresh session

This is the foundational proof for long-horizon execution — the vision's "lights-out software factory" requires runs that outlive any single process.

## Interface

No new commands or APIs. This spec validates that the existing `resume`, `accept-turn`, `status`, `approve-transition`, `escalate`, and `approve-completion` commands maintain continuity when invoked from separate processes against the same `.agentxchain/` state directory.

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

### Phase Transition Approval Path

1. A governed project is in the `planning` phase with real gate files present and `Approved: YES` in `.planning/PM_SIGNOFF.md`
2. **Session E** assigns a PM turn, stages a result with `phase_transition_request: "implementation"`, and accepts it
3. The run pauses with `pending_phase_transition` because `planning_signoff` requires explicit human approval
4. **Session F** is a fresh process that runs `agentxchain status` and surfaces `agentxchain approve-transition` as the operator action
5. **Session F** runs `agentxchain approve-transition`
6. State advances to `implementation`, `pending_phase_transition` is cleared, and `planning_signoff` is marked `passed`
7. **Session G** is another fresh process that runs `agentxchain resume --role dev` and receives the next implementation turn inside the same `run_id`

### Final-Phase Completion Path

1. A governed project is positioned in the final `qa` phase with prior phase gates already passed
2. **Session H** assigns a final QA turn, stages a result with `run_completion_request: true`, and accepts it
3. The run pauses with `pending_run_completion` because the final gate requires explicit human approval
4. **Session I** is a fresh process that runs `agentxchain approve-completion`
5. The run transitions to `completed` without changing `run_id`
6. `pending_run_completion` is cleared and the final gate is marked `passed`

### Cross-Machine Artifact Boundary

The docs for the restore slice must keep the exported-file follow-up actions explicit instead of blurring every post-export command together:

1. `agentxchain audit` remains the live current-repo/workspace inspection path.
2. `agentxchain report --input <export.json>` reads a saved export artifact and renders the verified derived summary.
3. `agentxchain replay export <export.json>` reads that same saved artifact into the read-only dashboard.
4. Coordinator partial artifacts (`repos.<repoId>.ok === false`) remain valid `report --input` and `replay export` inputs with export-health visibility, but they are not valid `restore` inputs.

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

### AT-SESSION-005: Cross-session completion approval
Request run completion in one process, then approve it in a different fresh process. Assert final state is `completed`, `pending_run_completion` is cleared, and the final gate is marked `passed`.

### AT-SESSION-006: Turn sequence monotonicity
Turns assigned in later sessions have higher sequence numbers than turns from earlier sessions.

### AT-SESSION-007: Cross-session phase-transition approval
Request a planning-to-implementation transition in one process, then approve it in a different fresh process. Assert `status` surfaces `agentxchain approve-transition`, the phase advances to `implementation`, `pending_phase_transition` is cleared, and a later fresh process can resume into the same `run_id` with the `dev` role.

### AT-SESSION-008: Restore docs keep audit/report/replay boundaries truthful
The docs page must state that `audit` is live-state inspection, `report --input` reads an existing export artifact, `replay export` opens that artifact in the read-only dashboard, and coordinator partial exports remain valid for report/replay but not restore.

## Open Questions

None. The existing state persistence model (file-based JSON/JSONL) already supports this by design, but architecture claims do not count as product truth until the CLI proves them through separate processes.
