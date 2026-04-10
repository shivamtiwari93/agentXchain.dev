# CI CLI Auto-Approve Proof Specification

## Purpose

Prove the actual operator-facing `agentxchain run --auto-approve` surface can complete an unattended governed run in CI with real `api_proxy` model dispatch.

The existing runner proofs are necessary and insufficient:

- `run-one-turn.mjs` proves primitive runner-interface operations
- `run-to-completion.mjs` proves multi-turn runner-interface lifecycle
- `run-with-run-loop.mjs` proves composition through `runLoop`
- `run-with-api-dispatch.mjs` proves real model dispatch through `runLoop`

None of those proves the shipped CLI binary itself. The real operator surface is `agentxchain run --auto-approve`. This proof closes that gap.

## Interface

```bash
node examples/ci-runner-proof/run-via-cli-auto-approve.mjs [--json]
```

### Exit codes

- `0`: the CLI binary completed the governed run and all audited artifacts are valid
- `1`: the CLI failed, the run did not complete, or the proof artifacts are invalid

## Scope

### In scope

- A temp governed project with real `agentxchain.json`
- The actual CLI binary at `cli/bin/agentxchain.js`
- `agentxchain run --auto-approve --max-turns 6`
- Real `api_proxy` dispatch using `ANTHROPIC_API_KEY`
- Auto-report generation under `.agentxchain/reports/`
- Artifact validation for:
  - `.agentxchain/state.json`
  - `.agentxchain/history.jsonl`
  - `.agentxchain/decision-ledger.jsonl`
  - `TALK.md`
  - `.agentxchain/reports/export-<run_id>.json`
  - `.agentxchain/reports/report-<run_id>.md`
- Real non-zero model cost for accepted turns
- GitHub Actions workflow execution on `push` to `main`

### Out of scope

- Hosted/cloud `.ai` orchestration
- Multi-repo coordinator execution in CI
- Authoritative local workspace mutation in CI
- Long-running checkpoint/restart CI jobs
- PR-triggered secret-backed proof runs

## Config shape

The proof uses a minimal two-phase, two-role governed config:

- `planning` -> `review`
- `planner` and `reviewer` are both `review_only`
- both roles use `api_proxy`
- no gate requires human approval
- no gate requires repo-local file writes
- `workflow_kit: {}` explicitly opts out of default planning/implementation/QA artifact templates, because this proof is validating unattended CLI execution, not the default workflow-kit content contract

This keeps the proof focused on unattended CLI execution with real model dispatch instead of mixing in authoritative-write assumptions that the remote review-only runtime does not own.

## Behavior

1. Scaffold a temp governed project with:
   - `agentxchain.json`
   - `.agentxchain/state.json`
   - `.agentxchain/history.jsonl`
   - `.agentxchain/decision-ledger.jsonl`
   - `TALK.md`
   - a valid git baseline
2. Execute:
   - `node cli/bin/agentxchain.js run --auto-approve --max-turns 6`
3. Require:
   - exit status `0`
   - stdout includes `Run completed`
   - final state status is `completed`
   - history has at least 2 accepted turns
   - both accepted turns show real non-zero `cost.usd`
   - decision ledger has entries
   - `TALK.md` includes both role names
   - governance export and governance report exist under `.agentxchain/reports/`
4. Emit a text or JSON summary describing:
   - CLI path used
   - turns executed
   - roles executed
   - total cost
   - report paths
   - pass/fail result
   - retry metadata when multiple attempts were needed, while still emitting exactly one top-level JSON document in `--json` mode

## Error cases

| Scenario | Expected behavior |
| --- | --- |
| `ANTHROPIC_API_KEY` missing | CLI exits non-zero and the proof reports the missing credential clearly |
| model output is invalid | CLI exits non-zero; the proof does not coerce the result locally |
| run stops before completion | proof fails |
| reports are not generated | proof fails |
| accepted turns show zero cost | proof fails because the run would be indistinguishable from synthetic staging |

## Boundary rules

1. The proof must shell out to the real CLI binary, not import `runLoop` directly.
2. The proof must not normalize or semantically rewrite turn results locally.
3. The proof must use `--auto-approve`, because unattended CI is the claimed operator mode.
4. The proof must validate the auto-generated governance report surface, because operator-visible evidence is part of the product claim.

## Acceptance tests

- `AT-CICLI-001`: the proof script exits 0 in text and JSON modes with `ANTHROPIC_API_KEY` set
- `AT-CICLI-002`: the proof shells out to `cli/bin/agentxchain.js` with `run --auto-approve --max-turns 6`
- `AT-CICLI-003`: the CLI completes the governed run to `state.status === "completed"`
- `AT-CICLI-004`: the run produces at least 2 accepted turns with real non-zero cost
- `AT-CICLI-005`: the governance export and governance report exist under `.agentxchain/reports/`
- `AT-CICLI-006`: the GitHub Actions workflow runs the proof on `push` to `main`
- `AT-CICLI-007`: the proof does not perform proof-local turn-result normalization or semantic coercion
- `AT-CICLI-008`: `--json` mode emits one parseable payload even when retries are exhausted

## Open questions

- Whether the next widening slice should add an authoritative-write CI proof instead of staying review-only
- Whether a future CI matrix should run this proof against additional providers once the credential and cost model is explicit enough
