# Run Operator Proof Contract Spec

## Purpose

Freeze the operator-proof inventory for `agentxchain run` so agents stop misclassifying an already-proven surface as a product gap. The repo already proves the `run` command through real CLI subprocess tests and a CI CLI proof. This spec turns that fact into an explicit contract.

## Interface

- Spec file: `.planning/RUN_OPERATOR_PROOF_CONTRACT_SPEC.md`
- Guard test: `cli/test/run-operator-proof-contract.test.js`
- Existing proof surfaces guarded by this contract:
  - `cli/test/run-integration.test.js`
  - `cli/test/run-api-proxy-integration.test.js`
  - `cli/test/ci-cli-auto-approve-proof-contract.test.js`
  - `cli/scripts/prepublish-gate.sh`

## Behavior

The guard test must assert all of the following:

1. `run-integration.test.js` exists and shells out to the real CLI binary (`cli/bin/agentxchain.js`) rather than calling library primitives directly.
2. `run-integration.test.js` proves the primary operator path with `agentxchain run --auto-approve`, validates completion, and asserts persisted governed artifacts such as completed state and history.
3. `run-api-proxy-integration.test.js` exists and proves mixed-adapter CLI execution across `local_cli` and `api_proxy`, including evidence that the mock API server received a request and the governed run completed.
4. `ci-cli-auto-approve-proof-contract.test.js` exists and `prepublish-gate.sh` runs `npm test`, preserving a shell-out CLI proof in the release quality floor.
5. The contract must fail loudly if any of those files are removed, downgraded from subprocess proof to library-only proof, or disconnected from the local gate.

## Error Cases

- If a test file still exists but no longer shells out to the CLI binary, the contract fails.
- If a subprocess proof still shells out but stops asserting completion/state/history truth, the contract fails.
- If the mixed-adapter proof no longer validates API request receipt, the contract fails.
- If the local gate stops running the test suite that covers the CLI proof script, the contract fails.

## Acceptance Tests

- `node --test cli/test/run-operator-proof-contract.test.js`
- `node --test cli/test/run-integration.test.js`
- `node --test cli/test/run-api-proxy-integration.test.js`
- `node --test cli/test/ci-cli-auto-approve-proof-contract.test.js`

## Open Questions

- None. This is an inventory guard, not a new runtime feature.
