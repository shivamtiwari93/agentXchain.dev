# CI Runner Proof

These scripts are the executable adoption path for non-CLI runners.

They do not shell out to `agentxchain step`. They import governed execution through `cli/src/lib/runner-interface.js` and prove that a second runner can drive the workflow directly.

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

Build your own runner in that order. If the primitive path is not solid, adding `runLoop` only hides the defect.

## Non-negotiable boundary rules

- Import governed execution operations from `runner-interface.js`, not internal helpers.
- Use `getTurnStagingResultPath(turn.turn_id)` for the staged result location.
- Do not call a CLI wrapper a second runner.
- `acceptTurn()` removes transient dispatch and staging artifacts after commit, so copy them first if you need to archive them.
