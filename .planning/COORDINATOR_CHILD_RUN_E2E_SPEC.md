# Coordinator Child-Run E2E Proof Spec

**Status:** Completed
**Owner:** Claude Opus 4.6
**Depends on:** `AGENTXCHAIN_RUN_SPEC.md`, coordinator dispatch/acceptance contracts

---

## Purpose

Prove that coordinator-dispatched child repos complete work through real `agentxchain step` execution (local-cli adapter → mock-agent → staged result → `accept-turn`), not through hand-staged `turn-result.json` files written directly by the test.

The existing `e2e-multi-repo.test.js` uses `simulateAcceptedTurn()` which bypasses the entire child-repo execution surface: no dispatch bundle is read by an agent, no subprocess is spawned, no staged result is validated by `accept-turn`. The coordinator resync works because the test manually writes the exact history entries the resync expects.

This proof closes that gap by running the real child-repo execution path after coordinator dispatch.

---

## Interface

### New proof surface

- Test file: `cli/test/e2e-coordinator-child-run.test.js`
- Mock runtime: `cli/test-support/coordinator-child-run-agent.mjs`

### Commands exercised (all via real CLI subprocess)

- `agentxchain multi init` — initialize coordinator
- `agentxchain multi step --json` — dispatch turns to child repos
- `agentxchain step` — execute mock-agent in child repo via local-cli adapter
- `agentxchain accept-turn` — validate and accept staged result in child repo
- `agentxchain multi approve-gate` — approve phase/completion gates

### Runtime strategy

- Child repos are scaffolded with `scaffoldGoverned()` and patched to use `local_cli` runtimes backed by `mock-agent.mjs` (same pattern as `e2e-intake-run-integration.test.js` and `e2e-plugin-lifecycle.test.js`).
- The mock-agent reads the dispatch bundle, creates phase-required gate files, and writes a valid `turn-result.json` — proving the full adapter path.
- No direct writes to `state.json` or `history.jsonl` by the test. All state transitions happen through CLI commands.

---

## Behavior

### Full coordinator lifecycle with real child-repo execution

1. Create coordinator workspace with two child repos (`api`, `web`), both configured with mock-agent runtimes.
2. `multi init` — bootstraps coordinator state, links child repos.
3. **Planning phase — api:**
   - `multi step --json` → dispatches turn to `api`
   - `agentxchain step` in api repo → mock-agent executes, writes staged result
   - `agentxchain accept-turn` in api repo → validates and accepts
4. **Planning phase — web:**
   - `multi step --json` → resyncs api acceptance, dispatches to `web`
   - Verify upstream acceptance from `api` in coordinator context
   - `agentxchain step` + `accept-turn` in web repo
5. **Phase gate:**
   - `multi step --json` → requests phase transition (planning → implementation)
   - `multi approve-gate` → approves transition
6. **Implementation phase — api then web:**
   - Same dispatch → step → accept-turn flow for both repos
7. **Completion gate:**
   - `multi step --json` → requests run completion
   - `multi approve-gate` → completes the coordinator run
8. **Final assertions:**
   - Coordinator state is `completed`
   - 4 `turn_dispatched` + 4 `acceptance_projection` entries in coordinator history
   - Barriers are `satisfied`
   - Child repo histories have real accepted entries (not hand-written)
   - Dispatch bundles exist in child repos with valid ASSIGNMENT.json

---

## Error Cases

- If the test writes `state.json` or `history.jsonl` directly instead of using CLI commands, the proof is invalid.
- If child repos use `echo {prompt}` instead of real mock-agent execution, the proof is invalid (no staged result validation).
- If the test skips `agentxchain step` and only calls `accept-turn` with pre-staged results, the proof is invalid.

---

## Acceptance Tests

1. `AT-COORD-RUN-001`: Full coordinator lifecycle (init → 4 dispatches → 4 real child-repo executions → phase gate → completion gate) completes with coordinator status `completed`.
2. `AT-COORD-RUN-002`: Each child-repo turn is executed through the real `agentxchain step` path, evidenced by dispatch logs in `.agentxchain/dispatch/turns/<turn_id>/` and accepted entries in `.agentxchain/history.jsonl` written by `accept-turn` (not by the test).
3. `AT-COORD-RUN-003`: Coordinator context propagation — the second dispatch in each phase includes upstream acceptances from the first repo's real execution.

---

## Open Questions

1. Should a follow-on E2E prove the blocked/recovery path with real child-repo execution, or is the happy-path proof sufficient for the current bar?
