# CI Runner Proof Specification

## Purpose

Prove that the governed protocol is runner-independent by shipping a second runner — a GitHub Actions workflow step that executes one governed turn using only the runner interface library. No CLI shell-out.

This is the narrowest proof that satisfies PROTOCOL-v6.md §3: "Other runners may expose different operator commands as long as they preserve the same artifact, validation, and state-transition contract."

## Problem Statement

The runner interface (`runner-interface.js`) is declared and tested programmatically. But there is no second runner that actually runs in a different execution environment. The CLI is still the only runner that has ever executed a governed turn in production or CI. Until a non-CLI runner executes a turn and produces valid artifacts, runner independence is a tested claim, not a proven fact.

## Design

### What the CI Runner Proof Is

A standalone Node.js script (`examples/ci-runner-proof/run-one-turn.mjs`) that:

1. Scaffolds a governed project in a temp directory (config, state, history, ledger, TALK.md)
2. Imports governed execution operations through `runner-interface.js` — no CLI commands, no Commander.js, no chalk, and no direct imports from internal library helpers outside the declared boundary
3. Executes exactly one governed turn: `initRun → assignTurn → [stage result] → acceptTurn`
4. Writes a structured JSON proof report to stdout with artifact checksums
5. Exits 0 on success, 1 on failure

A GitHub Actions workflow (`ci-runner-proof.yml`) that runs this script on every push to main and on PRs, proving the runner interface works in a real CI environment.

### What the CI Runner Proof Is NOT

- A multi-turn orchestrator
- A replacement for the CLI runner
- A hosted runner
- An auto-approve mechanism
- A CI/CD integration that runs governed turns on real repos

### Interface

```
node examples/ci-runner-proof/run-one-turn.mjs [--json]
```

**Exit codes:**
- `0` — turn executed, all artifacts valid
- `1` — turn execution failed or artifact validation failed

**Stdout (default):**
```
CI Runner Proof — AgentXchain runner-interface v0.2
  Project: ci-runner-proof
  Init:    ok (run_id: <id>)
  Assign:  ok (turn_id: <id>, role: pm)
  Accept:  ok
  Artifacts:
    state.json:            valid (sha256: <hash>)
    history.jsonl:         valid (1 entry)
    decision-ledger.jsonl: valid (>= 1 entry)
  Result: PASS — one governed turn executed via runner interface, no CLI shell-out
```

**Stdout (--json):**
```json
{
  "runner": "ci-runner-proof",
  "runner_interface_version": "0.2",
  "result": "pass",
  "run_id": "...",
  "turn_id": "...",
  "role": "pm",
  "artifacts": {
    "state": { "valid": true, "sha256": "..." },
    "history": { "valid": true, "entry_count": 1 },
    "ledger": { "valid": true, "entry_count": 1 }
  }
}
```

## Behavior

1. **Scaffolding**: Creates a minimal governed project with schema_version 4, three roles (pm/dev/qa), three phases, and budget rules. This mirrors `runner-interface.test.js` scaffolding but runs as a standalone process.

2. **Turn execution**: Imports `initRun`, `assignTurn`, `acceptTurn` from the runner interface. Stages a valid turn result (review-only PM turn). Accepts the result. No adapter dispatch — the "agent" is the script itself staging a pre-built result.

3. **Artifact validation**: After acceptance, reads back `state.json`, `history.jsonl`, and `decision-ledger.jsonl`. Validates structure, computes SHA256 of state file, counts history/ledger entries.

4. **No CLI dependency**: The script must not import, require, spawn, or exec any CLI command (`agentxchain`, `bin/agentxchain.js`).
5. **No boundary cheating**: The script must not reach into `turn-paths.js` or other internal modules for governed execution helpers that belong in the declared runner interface. This is enforced by the contract test.

## Guard Test

`cli/test/ci-runner-proof-contract.test.js` enforces:

1. **No CLI shell-out**: The proof script source must not contain `exec`, `spawn`, `execFile`, `execSync`, `spawnSync`, `child_process`, `agentxchain step`, `agentxchain.js`, or `bin/agentxchain`.
2. **Runner interface import**: The script must import from `runner-interface.js`.
3. **No internal path helper import**: The script must not import `turn-paths.js` directly.
4. **Script execution**: Running the script produces exit code 0 and valid JSON output (with `--json`).
5. **Artifact parity**: The JSON output confirms state, history, and ledger are all valid.

## Acceptance Tests

- `AT-CI-RUNNER-001`: The proof script executes successfully (exit 0) and produces valid output
- `AT-CI-RUNNER-002`: The proof script imports governed execution operations through runner-interface.js, not CLI commands or direct internal path helpers
- `AT-CI-RUNNER-003`: Artifacts produced match the same structure as CLI-produced artifacts
- `AT-CI-RUNNER-004`: The GitHub Actions workflow runs the proof script and succeeds
- `AT-CI-RUNNER-005`: The contract test guards against regression to CLI shell-out

## Open Questions

- Whether the CI runner proof should also test `rejectTurn` and `escalate` paths, or whether the happy-path single turn is sufficient for the first proof. This spec says: happy path only. Expand later if needed.
- Whether the proof script should be packaged as a reusable GitHub Action. This spec says: not yet. A standalone script is sufficient proof. Packaging is a future concern.
