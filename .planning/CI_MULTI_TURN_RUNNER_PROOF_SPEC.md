# CI Multi-Turn Runner Proof Specification

## Purpose

Prove that the declared runner interface can drive a complete governed lifecycle across multiple turns, gate pauses, and gate approvals without CLI shell-out or operator re-entry between turns.

This is the first honest continuous-execution proof for the runner layer. It is intentionally runner-level, not a new CLI command.

## Problem Statement

`run-one-turn.mjs` proves that a second runner can execute one governed turn. That is necessary and insufficient.

The strategic gap from `VISION.md` is longer-horizon governed execution:

- more than one turn
- automatic continuation after acceptance
- explicit stop behavior at phase gates and completion gates
- auditably reaching `state.status === "completed"`

Shipping `agentxchain run` before this proof would be lazy. The current `step` command is a CLI surface with extensive `process.exit` behavior, operator printing, and adapter dispatch concerns. It is not the runner contract.

## Scope

### In Scope

- A standalone example runner script at `examples/ci-runner-proof/run-to-completion.mjs`
- Exactly one three-turn governed lifecycle:
  - planning / `pm`
  - implementation / `dev`
  - qa / `qa`
- One human-approved phase gate (`planning_signoff`)
- One automatic phase advance (`implementation_complete`)
- One human-approved run completion gate (`qa_ship_verdict`)
- Dispatch bundle generation for every assigned turn
- Pre-accept bundle existence checks and post-accept cleanup checks
- JSON and text proof reports
- A contract test guarding boundary purity and output shape
- GitHub Actions workflow execution

### Out Of Scope

- Real model dispatch
- CLI `run` command
- Looping until arbitrary stop conditions
- Parallel turns
- Hook and notification execution proof
- Retry / rejection / conflict recovery
- Multi-repo orchestration

## Interface

```bash
node examples/ci-runner-proof/run-to-completion.mjs [--json]
```

### Exit Codes

- `0`: lifecycle completed and artifacts are valid
- `1`: any runner step, gate approval, or artifact validation failed

### Required Imports

The script must import only through `cli/src/lib/runner-interface.js` for governed execution operations:

- `initRun`
- `loadState`
- `assignTurn`
- `writeDispatchBundle`
- `getTurnStagingResultPath`
- `acceptTurn`
- `approvePhaseGate`
- `approveCompletionGate`
- `RUNNER_INTERFACE_VERSION`

It must not import CLI commands, `turn-paths.js`, `governed-state.js`, or `child_process`.

## Behavior

1. Scaffold a minimal governed project in a temp directory with:
   - three roles: `pm`, `dev`, `qa`
   - three phases: `planning`, `implementation`, `qa`
   - human-approved `planning_signoff`
   - automatic `implementation_complete`
   - human-approved `qa_ship_verdict`

2. Execute this exact lifecycle:
   - `initRun`
   - assign `pm`
   - `writeDispatchBundle`
   - create planning gate files
   - stage valid PM result with `phase_transition_request: "implementation"`
   - `acceptTurn`
   - verify state paused on `pending_phase_transition`
   - `approvePhaseGate`
   - assign `dev`
   - `writeDispatchBundle`
   - stage valid dev result with `phase_transition_request: "qa"`
   - `acceptTurn`
   - verify state auto-advanced to `qa`
   - assign `qa`
   - `writeDispatchBundle`
   - create QA gate files
   - stage valid QA result with `run_completion_request: true`
   - `acceptTurn`
   - verify state paused on `pending_run_completion`
   - `approveCompletionGate`
   - verify `state.status === "completed"`

3. For each assigned turn:
   - verify `ASSIGNMENT.json`, `PROMPT.md`, and `CONTEXT.md` exist before acceptance
   - verify the dispatch bundle directory is removed after acceptance
   - verify the turn-scoped staging directory is removed after acceptance

4. Validate final artifacts:
   - `.agentxchain/state.json`
   - `.agentxchain/history.jsonl`
   - `.agentxchain/decision-ledger.jsonl`
   - `TALK.md`

## Proof Report

### JSON Mode

Must include at least:

- `runner`
- `runner_interface_version`
- `result`
- `turns_executed`
- `roles`
- `phase_transition_approvals`
- `completion_approvals`
- `dispatch_bundles`
- `artifacts`

### Text Mode

Must clearly state:

- runner-interface version
- three executed roles
- gate approvals performed
- final completed result

## Guard Test

`cli/test/ci-multi-turn-runner-proof-contract.test.js` enforces:

1. no `child_process` import
2. no exec/spawn shell-out
3. no `agentxchain` CLI references
4. no direct `turn-paths.js` or `governed-state.js` import
5. runner-interface import is present
6. lifecycle operations for gate approvals are imported
7. the script executes successfully in JSON and text modes
8. JSON output proves:
   - 3 turns executed
   - 1 phase gate approval
   - 1 completion approval
   - final status is `completed`
   - every dispatch bundle was observed pre-accept and cleaned up post-accept
9. CI workflow references and runs the new script

## Acceptance Tests

- `AT-CI-MULTI-001`: script exits 0 in JSON and text modes
- `AT-CI-MULTI-002`: script imports only from `runner-interface.js` for governed execution
- `AT-CI-MULTI-003`: script executes three governed turns to `completed`
- `AT-CI-MULTI-004`: script proves pause/approve behavior for both phase and completion gates
- `AT-CI-MULTI-005`: script proves dispatch bundle pre-accept existence and post-accept cleanup for all turns
- `AT-CI-MULTI-006`: workflow runs the script on push to `main` and on pull requests

## Open Questions

- Whether the next runner proof should exercise rejection/retry instead of expanding turn count further
- Whether a future CLI `run` command should compose a dedicated runner library rather than `step`
