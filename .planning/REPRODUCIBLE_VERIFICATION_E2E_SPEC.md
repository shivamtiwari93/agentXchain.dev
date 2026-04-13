# Reproducible Verification — Subprocess E2E Spec

## Purpose

Prove that `require_reproducible_verification` policy enforcement works through the real CLI subprocess path, not just library-level calls.

## Gap

`policy-runtime-integration.test.js` tests AT-RVP-004/005/006 call `acceptGovernedTurn()` directly. No test invokes `agentxchain run` or `agentxchain accept-turn` as a subprocess with this policy active.

## Acceptance Tests

| ID | Description | Method |
|----|-------------|--------|
| AT-RVP-E2E-001 | `agentxchain run --auto-approve --max-turns 1` with policy active + correct machine evidence completes successfully, replay recorded | subprocess via `spawnSync` |
| AT-RVP-E2E-002 | `agentxchain run --auto-approve --max-turns 1` with policy active + mismatched evidence exits non-zero with policy_violation message | subprocess via `spawnSync` |

## Design

- Reuse `scaffoldGoverned` + `local_cli` runtime pattern from `run-integration.test.js`
- Happy path: existing `mock-agent.mjs` already writes `{ command: 'echo ok', exit_code: 0 }` — replay succeeds
- Block path: new `mock-agent-bad-evidence.mjs` writes `{ command: 'node -e "process.exit(1)"', exit_code: 0 }` — replay sees exit 1 but evidence claims exit 0 → mismatch → policy blocks

## Decision

- `DEC-RVP-E2E-001`: `require_reproducible_verification` must have subprocess E2E proof through the CLI binary, not only library-level tests.
