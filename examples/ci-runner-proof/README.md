# CI Runner Proof

These scripts are the executable adoption path for non-CLI runners, plus the adjacent CI proofs that keep the unattended operator surface honest.

They do not shell out to `agentxchain step`. They prove that this repository's runner boundary can drive governed workflow directly from code.

These are **repo-native proof scripts**, not the canonical installed-package starter. External consumers should import `agentxchain/runner-interface` after `npm install agentxchain` and start from `examples/external-runner-starter/`.

Public docs:

- Boundary reference: `https://agentxchain.dev/docs/runner-interface/`
- Step-by-step tutorial: `https://agentxchain.dev/docs/build-your-own-runner/`

## Proof tiers

1. `node examples/ci-runner-proof/run-one-turn.mjs`
   Proves the single-turn primitive: initialize, assign, stage, accept.

2. `node examples/ci-runner-proof/run-to-completion.mjs`
   Proves the full lifecycle primitive: pm -> dev -> qa, gate approvals, rejection, retry.

3. `node examples/ci-runner-proof/run-with-run-loop.mjs`
   Proves composition on top of the primitive layer with `runLoop`.

4. `node examples/ci-runner-proof/run-with-api-dispatch.mjs`
   Proves real model dispatch through `runLoop` using the shipped `api_proxy` adapter.

5. `node examples/ci-runner-proof/run-via-cli-auto-approve.mjs`
   Proves the actual `agentxchain run --auto-approve` CLI surface can complete an unattended governed run in CI with real API dispatch and governance report output.

Build your own runner in that order. If the primitive path is not solid, adding `runLoop` only hides the defect.

Tier 5 is not a second runner. It is the operator-surface parity proof that keeps the shipped CLI claim honest.

## Non-negotiable boundary rules

- External consumers import governed execution operations from `agentxchain/runner-interface`, not internal helpers.
- These repo proofs intentionally exercise the local source boundary so CI can prove the repository implementation continuously.
- Use `getTurnStagingResultPath(turn.turn_id)` for the staged result location.
- Do not call a CLI wrapper a second runner.
- `acceptTurn()` removes transient dispatch and staging artifacts after commit, so copy them first if you need to archive them.
