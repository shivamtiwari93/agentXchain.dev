# E2E Parallel CLI Specification — Governed v1.1

> Validates the operator-facing parallel-turn workflow through real CLI subprocesses rather than direct library calls.

---

## Purpose

The repository now has:

- state-model, dispatch, acceptance, and conflict-recovery specs
- a library-level composed lifecycle test in `.planning/E2E_PARALLEL_LIFECYCLE_SPEC.md`
- unit and command coverage for targeted resume, conflict rendering, and `reject-turn --reassign`

What is still not frozen is the CLI-subprocess proof that a real operator can drive the parallel workflow end-to-end without relying on internal helpers. This spec closes that gap.

The goal is not new protocol behavior. The goal is to prove that the shipped CLI surface correctly composes the already-frozen contracts when multiple turns are active.

---

## Interface/Schema

### Test Harness Contract

```ts
interface ParallelCliHarness {
  root: string;                                   // temp governed repo
  cli_bin: string;                                // cli/bin/agentxchain.js
  run(args: string[]): CliInvocationResult;
  stageTurnResult(turnId: string, result: object): void;
  readState(): GovernedRunState;
  readJson(path: string): unknown;
  readJsonl(path: string): unknown[];
}

interface CliInvocationResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}
```

### Commands Under Test

```text
agentxchain status
agentxchain status --json
agentxchain step
agentxchain step --resume --turn <id>
agentxchain accept-turn --turn <id>
agentxchain reject-turn --turn <id> --reason "..." --reassign
```

### Artifacts Observed

- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/dispatch/index.json`
- `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
- `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`
- `.agentxchain/staging/<turn_id>/turn-result.json`

### Scenario Fixture Requirements

```ts
interface ParallelCliScenarioConfig {
  protocol_mode: "governed";
  routing: {
    [phase: string]: {
      max_concurrent_turns: 2;
    };
  };
  rules: {
    max_turn_retries: number;                     // >= 2 for conflict reassign path
  };
}
```

The fixture must use deterministic local/manual-style runtimes so the test controls dispatch and staged results without live provider dependencies.

---

## Behavior

### Scenario A — Multi-Turn Targeting Guardrails

1. Initialize a governed repo configured with `max_concurrent_turns = 2`.
2. Assign two concurrent turns in the same phase.
3. Invoke `agentxchain status` and `agentxchain status --json`.
4. Assert both surfaces expose both active turn IDs.
5. Invoke `agentxchain step --resume` without `--turn`.
6. Assert the CLI fails with an ambiguity error and does not mutate state.

### Scenario B — Targeted Acceptance

1. Stage a valid result for the first turn only.
2. Invoke `agentxchain accept-turn --turn <first_id>`.
3. Assert:
   - exactly one history entry is added
   - the sibling turn remains active
   - turn-scoped staging and dispatch artifacts for the accepted turn are cleaned up
   - the sibling turn's artifacts remain intact

### Scenario C — Conflict Persistence Via CLI

1. Stage a conflicting result for the second turn that overlaps a file accepted by the first turn.
2. Invoke `agentxchain accept-turn --turn <second_id>`.
3. Assert:
   - the command fails with the conflict outcome
   - `state.active_turns[second_id].status === "conflicted"`
   - `conflict_state.detection_count === 1`
   - `decision-ledger.jsonl` records `conflict_detected`
4. Invoke `agentxchain status`.
5. Assert the status surface renders:
   - the conflicted turn
   - conflicting file count or names
   - the suggested resolution
   - both operator recovery commands

### Scenario D — Reject And Reassign Via CLI

1. Invoke `agentxchain reject-turn --turn <second_id> --reason "rebase on accepted sibling" --reassign`.
2. Assert:
   - the same `turn_id` is preserved
   - `attempt` increments
   - `conflict_state` is cleared
   - the retained turn baseline and `assigned_sequence` are refreshed
   - `decision-ledger.jsonl` records `conflict_rejected`
3. Assert the rewritten dispatch bundle contains conflict context in:
   - `ASSIGNMENT.json`
   - `PROMPT.md`

### Scenario E — Successful Rebased Retry

1. Stage a new result for the retained turn that leaves the accepted sibling change intact and adds only non-conflicting work.
2. Invoke `agentxchain accept-turn --turn <second_id>`.
3. Assert:
   - the command succeeds
   - `state.active_turns` is empty
   - `history.jsonl` contains exactly two accepted entries
   - the final history order reflects deterministic `accepted_sequence`
   - no stale staging/dispatch artifacts remain for either turn

This CLI E2E intentionally covers Path A only. `human_merge` remains exercised by unit/command coverage unless operator UX changes enough to justify its own subprocess scenario.

---

## Error Cases

1. **Ambiguous resume silently targets a turn:** test must fail. Multi-turn targeting must remain explicit.
2. **Targeted acceptance cleans sibling artifacts:** test must fail. Cleanup is turn-scoped only.
3. **Conflict acceptance silently succeeds:** test must fail. The conflict contract regressed.
4. **`reject-turn --reassign` generates a new turn ID:** test must fail. Path A is a retained-turn retry.
5. **Redispatch omits conflict context from bundle artifacts:** test must fail. The operator/agent loses the rebase contract.
6. **Successful retry leaves the conflicted turn active or leaves stale dispatch/staging state behind:** test must fail. The acceptance transaction did not close cleanly.
7. **CLI status renders conflict state only in `--json` but not in human-readable output:** test must fail. Operators depend on the default surface.

---

## Acceptance Tests

1. `status --json` exposes both active turns in a `max_concurrent_turns = 2` run.
2. Human-readable `status` lists both active turns before any acceptance.
3. `step --resume` without `--turn` fails when multiple turns are active.
4. `accept-turn --turn <id>` accepts only the targeted turn and preserves the sibling.
5. Accepted-turn cleanup removes only the targeted turn's staging and dispatch directories.
6. A CLI acceptance of a conflicting sibling persists `status: "conflicted"` and `conflict_state`.
7. Conflict detection appends `conflict_detected` to `decision-ledger.jsonl`.
8. Human-readable `status` renders the conflict banner with the suggested resolution.
9. `reject-turn --turn <id> --reassign` preserves `turn_id` and increments `attempt`.
10. Reassign refreshes the retained turn baseline and `assigned_sequence`.
11. Redispatched `ASSIGNMENT.json` and `PROMPT.md` carry structured conflict context.
12. A rebased retry accepted through `accept-turn --turn <id>` drains the run cleanly and yields exactly two accepted history entries.

---

## Open Questions

1. Should `human_merge` get its own subprocess CLI E2E now, or is the current unit/command coverage sufficient until the operator UX changes materially?
2. Should the subprocess test assert exact human-readable status text, or only stable substrings plus the `--json` contract?
3. Should a future CLI E2E also cover queued phase-transition or queued run-completion behavior under parallel drain, or is that better kept at the library layer?
