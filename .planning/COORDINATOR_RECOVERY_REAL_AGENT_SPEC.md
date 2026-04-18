# Coordinator Recovery Real-Agent E2E Proof Spec

**Status:** Completed
**Owner:** Claude Opus 4.6
**Depends on:** `COORDINATOR_CHILD_RUN_E2E_SPEC.md`, `COORDINATOR_BLOCKED_RECOVERY_SPEC.md`

---

## Purpose

Prove that coordinator blocked/recovery flows work through real `agentxchain step --resume` execution, not through synthetic `stageAcceptedTurn()` helpers that hand-write `turn-result.json` and bypass the adapter→agent→staged-result→accept-turn path.

The existing `e2e-intake-coordinator-recovery.test.js` proves the block→resume→complete lifecycle but uses `stageAcceptedTurn()` for both child repos. The existing `e2e-coordinator-child-run.test.js` proves the happy-path lifecycle with real agent execution but has no blocked/recovery coverage. This spec closes the intersection gap.

---

## Interface

### New proof surface

- Test file: `cli/test/e2e-coordinator-recovery-real-agent.test.js`
- Mock runtime: `cli/test-support/coordinator-child-run-agent.mjs` (reused)

### Commands exercised (all via real CLI subprocess)

- `agentxchain multi init` — initialize coordinator
- `agentxchain multi step --json` — dispatch turns, detect hook violations
- `agentxchain step --resume` — execute mock-agent in child repo via local-cli adapter
- `agentxchain multi resume --json` — recover from blocked state
- `agentxchain multi approve-gate` — approve completion gate

---

## Behavior

### Coordinator block→resume lifecycle with real child-repo execution

1. Create coordinator workspace with two child repos (`api`, `web`), both configured with `local_cli` runtimes backed by `coordinator-child-run-agent.mjs`.
2. Configure an `after_acceptance` hook that tampers with coordinator state (same mechanism as `e2e-intake-coordinator-recovery.test.js`).
3. `multi init` — bootstraps coordinator state.
4. **First dispatch — api:**
   - `multi step --json` → dispatches implementation turn to `api`
   - `agentxchain step --resume` in api repo → mock-agent executes through real adapter path → turn accepted
5. **Hook violation triggers block:**
   - `multi step --json` → resyncs api acceptance → after_acceptance hook fires → tampers state → integrity check detects → coordinator status = `blocked`
6. **Operator recovery:**
   - Disable the broken hook (remove from config)
   - Write `RECOVERY_REPORT.md` (required by recovery contract)
   - `multi resume --json` → coordinator status = `active`
7. **Second dispatch — web (after recovery):**
   - `multi step --json` → dispatches implementation turn to `web`
   - `agentxchain step --resume` in web repo → mock-agent executes → turn accepted
8. **Completion gate:**
   - `multi step --json` → requests run completion
   - `multi approve-gate` → completes the coordinator run
9. **Final assertions:**
   - Coordinator state is `completed`
   - Coordinator history records `blocked_resolved` entry with `to: 'active'`
   - Both child repos have real accepted entries in `history.jsonl` (written by `accept-turn`, not by test)
   - Barriers are `satisfied`

---

## Error Cases

- If the test uses `stageAcceptedTurn()` or writes `turn-result.json` directly, the proof is invalid.
- If the test writes `state.json` or `history.jsonl` in child repos directly, the proof is invalid.
- If the coordinator does not actually reach `blocked` status before recovery, the proof is incomplete.

---

## Acceptance Tests

1. `AT-COORD-RECOVERY-REAL-001`: Coordinator reaches `blocked` status after hook violation on real agent-executed turn acceptance.
2. `AT-COORD-RECOVERY-REAL-002`: `multi resume` transitions coordinator from `blocked` to `active` with `blocked_resolved` history entry.
3. `AT-COORD-RECOVERY-REAL-003`: Post-recovery dispatch executes through real `step --resume` path, not synthetic staging.
4. `AT-COORD-RECOVERY-REAL-004`: Full lifecycle completes: init → real agent dispatch → block → recover → real agent dispatch → completion.

---

## Open Questions

None. This closes the gap identified in the Turn 170 audit.
