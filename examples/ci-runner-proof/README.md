# CI Runner Proof

These scripts are the executable adoption path for non-CLI runners, plus the adjacent CI proofs that keep the unattended operator surface honest.

The primitive proofs do not shell out to `agentxchain step`. They prove that this repository's runner boundary can drive governed workflow directly from code. The separate `run-via-cli-auto-approve.mjs` proof intentionally shells out to the real `agentxchain run` binary to defend the shipped operator surface.

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

6. `node examples/ci-runner-proof/run-multi-phase-write.mjs`
   Proves a 3-phase governed run (planning → implementation → qa) with a write-owning (proposed) turn, real gate artifact check (`requires_files: ["src/server.js"]`), proposal application, and explicit gate-pass reporting through `phase_gate_status`. This is the widest lights-out proof: multi-phase lifecycle, file mutations, and gate-driven phase advancement.

Build your own runner in that order. If the primitive path is not solid, adding `runLoop` only hides the defect.

Tier 5 is not a second runner. It is the operator-surface parity proof that keeps the shipped CLI claim honest. Tier 6 is the multi-phase widening proof that closes the gap between review-only CI and real governed delivery.

Tier 6 intentionally reports both `gates_approved` and `phase_gate_status`. For this proof, `gates_approved` can remain `0` because no gate pauses for human approval; the actual pass evidence is `phase_gate_status`.

## Non-negotiable boundary rules

- External consumers import governed execution operations from `agentxchain/runner-interface`, not internal helpers.
- These repo proofs intentionally exercise the local source boundary so CI can prove the repository implementation continuously.
- Use `getTurnStagingResultPath(turn.turn_id)` for the staged result location.
- Do not call a CLI wrapper a second runner.
- `acceptTurn()` removes transient dispatch and staging artifacts after commit, so copy them first if you need to archive them.
