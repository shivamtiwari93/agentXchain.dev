# Governed Todo App Run-Chain Proof Spec

## Purpose

Prove that `agentxchain run --chain` works on a real product-shaped governed example, not just in isolated unit tests. The proof must exercise at least one real automatic continuation, inherited context, provenance lineage, and per-run governance artifacts across chained runs.

## Interface

Proof script:

```bash
node examples/governed-todo-app/run-chain-proof.mjs [--json]
```

CI workflow entry:

- `.github/workflows/governed-todo-app-proof.yml`

## Behavior

The proof harness must:

1. Scaffold a temporary governed-todo-app project that preserves the example's 4-role / 3-phase topology.
2. Replace manual and local-cli adapters with `api_proxy` so the run can execute unattended.
3. Invoke the real CLI binary with:
   - `run --chain`
   - `--max-chains 2`
   - `--chain-cooldown 0`
   - `--auto-approve`
   - bounded `--max-turns`
4. Validate that:
   - at least two governed runs execute (initial + one continuation)
   - the continuation has `trigger: continuation`
   - the continuation points to the correct parent run
   - the chain report records inherited-context summaries for the child run
   - each run produces its own export and markdown governance report
5. Clean up the temporary workspace after completion.

## Error Cases

1. `ANTHROPIC_API_KEY` missing: exit 1 with a clear error.
2. CLI exits non-zero: fail the proof and capture stdout/stderr tails.
3. Chain report missing or malformed: fail the proof.
4. No continuation run occurs: fail the proof.
5. Missing continuation lineage or inherited-context summaries: fail the proof.
6. Missing per-run export/report artifacts: fail the proof.

## Acceptance Tests

- `AT-TODO-CHAIN-001`: the proof shells out to the real CLI with `run --chain`.
- `AT-TODO-CHAIN-002`: the proof uses `--max-chains 2`, `--chain-cooldown 0`, and bounded `--max-turns`.
- `AT-TODO-CHAIN-003`: the proof validates a chain report with at least 2 runs and a real continuation.
- `AT-TODO-CHAIN-004`: the proof validates continuation parent lineage and inherited-context summaries.
- `AT-TODO-CHAIN-005`: the proof validates per-run governance export/report artifacts.
- `AT-TODO-CHAIN-006`: the workflow runs both text and JSON proof modes.

Deterministic exhaustion of `max_chains` remains covered by repo-local `cli/test/run-chain-e2e.test.js`. The live API proof does not require 3 completed runs because the inherited-context content can legitimately make later model turns terminate as `blocked`.

## Open Questions

None.
