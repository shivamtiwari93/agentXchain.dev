# Delegation Chains CLI Proof — Spec

## Purpose

Prove delegation chains through the real governed CLI lifecycle instead of direct state-library mutation.

The proof target is narrow:

- `agentxchain step` assigns the delegating role
- the delegating role emits `delegations`
- delegated turns run through a real adapter (`local_cli`)
- delegated turns receive `delegation_context`
- the parent review turn receives `delegation_review`
- the run completes cleanly after the review turn

## Interface

### Proof Script

- `examples/governed-todo-app/run-delegation-proof.mjs`
- Runs a temp governed project with:
  - one phase: `delivery`
  - roles: `director`, `dev`, `qa`
  - real `local_cli` adapter backed by `cli/test-support/delegation-mock-agent.mjs`

### Continuous Proof

- `cli/test/e2e-delegation-chains-proof.test.js`
- Executes the proof script in `--json` mode and asserts pass/fail proof fields

### Docs Truth

- `website-v2/docs/delegation-chains.mdx`
- Must name the proof script, the command, and recorded evidence from the latest run

## Behavior

1. The proof script scaffolds a clean git-backed temp workspace with a governed config.
2. Step 1 runs `agentxchain step` for `director`.
3. The mock agent emits two delegations:
   - `del-001` → `dev`
   - `del-002` → `qa`
4. Step 2 runs `agentxchain step` for `dev`.
   - The delegate writes durable proof artifact `.agentxchain/proof/delegation/del-001.json`
   - The artifact records the incoming `delegation_context`
5. Step 3 runs `agentxchain step` for `qa`.
   - The delegate writes durable proof artifact `.agentxchain/proof/delegation/del-002.json`
   - After acceptance, `pending_delegation_review` is populated
6. Step 4 runs `agentxchain step` for `director`.
   - The review turn writes durable proof artifact `.agentxchain/proof/delegation/review-turn.json`
   - The artifact records the incoming `delegation_review` aggregation
   - The turn requests run completion
7. The final state must be `completed`

## Error Cases

1. Director turn completes without populating `delegation_queue`
2. Dev or QA turn runs without durable proof of `delegation_context`
3. QA completion does not produce `pending_delegation_review`
4. Review turn runs without durable proof of `delegation_review`
5. Final role order drifts from `director -> dev -> qa -> director`
6. Final run status is not `completed`

## Acceptance Tests

- AT-DEL-PROOF-001: director step enqueues two delegations and recommends `dev`
- AT-DEL-PROOF-002: dev step persists proof of `delegation_context` for `del-001`
- AT-DEL-PROOF-003: qa step persists proof of `delegation_context` for `del-002`
- AT-DEL-PROOF-004: qa completion produces `pending_delegation_review`
- AT-DEL-PROOF-005: director review step persists proof of aggregated `delegation_review`
- AT-DEL-PROOF-006: accepted history role order is `director -> dev -> qa -> director`
- AT-DEL-PROOF-007: final run status is `completed`
- AT-DEL-PROOF-008: docs page names the proof script, command, and evidence

## Open Questions

1. Should a future live proof use `api_proxy` once delegation prompts are reliable enough to avoid fragile prompt steering?
2. Should delegation proofs eventually cover failure/rejection branches in addition to the clean success path?
