# Live Scenario A Report — 2026-04-01

Purpose: capture the evidence from the delegated live governed dogfood run so release judgments are anchored in an actual execution trace rather than inference from tests.

## Scope

- Example project: `examples/governed-todo-app`
- Temp workspace: `/tmp/agentxchain-live-vl5tVJ`
- Run id: `run_399aea020ebb68d4`
- Goal: exercise the governed PM -> Dev -> QA loop with real adapters where possible and record the actual outcomes

## Execution Summary

1. PM turn succeeded in manual mode.
   - `turn_c87e687cf32e5f84` accepted.
   - Planning gate approved.
   - Orchestrator state committed as `a50f1c01ceef07f22d58e66ca9eb708702c36498`.

2. Dev turn did not complete through `local_cli`.
   - `agentxchain step --verbose` dispatched `claude --print -p {prompt}`.
   - The subprocess exited with: `You're out of extra usage · resets 6am (America/Toronto)`.
   - No staged turn result was produced by the subprocess.
   - The governed turn remained assigned, which allowed operator recovery without corrupting run state.

3. The assigned dev turn was then completed manually to keep the governed loop moving.
   - Implemented `todo.js`, `package.json`, and `test/todo.test.js`.
   - `npm test` passed: `3` tests, `0` failures.
   - `turn_c5d584f73ba69b4a` accepted successfully.

4. QA turn succeeded through the real Anthropic `api_proxy` adapter.
   - `agentxchain step` dispatched `turn_9f5639c671280a8f` to `claude-sonnet-4-6`.
   - Provider usage captured in staging:
     - `input_tokens`: `1559`
     - `output_tokens`: `2696`
     - `usd`: `0.045`
   - First-pass staged result failed schema validation because `artifacts_created[]` contained objects instead of strings.
   - The response still contained coherent review content, so the review artifacts were materialized under `.planning/` and `.agentxchain/reviews/`, the staged JSON was normalized to the v1 schema, and the same QA turn was accepted.

5. Final governed state after acceptance:
   - `status`: `paused`
   - `phase`: `qa`
   - `last_completed_turn_id`: `turn_9f5639c671280a8f`
   - `phase_gate_status`:
     - `planning_signoff`: `passed`
     - `implementation_complete`: `passed`
     - `qa_ship_verdict`: `pending`
   - `accepted_integration_ref`: `git:5f9801b0526602500a961771ca1ae3914d514f41`

## Key Evidence

## 1. `accepted_integration_ref` Semantics

The accepted dev turn used:

- `artifact.type = "workspace"`
- `artifact.ref = "git:dirty"`

But the accepted history entry recorded:

- `observed_artifact.baseline_ref = "git:a50f1c01ceef07f22d58e66ca9eb708702c36498"`
- `observed_artifact.accepted_ref = "git:a50f1c01ceef07f22d58e66ca9eb708702c36498"`

This confirms the current v1 behavior:

- `accepted_integration_ref` is the best-known git lineage anchor, not a serialization of the dirty workspace state
- the exact uncommitted accepted workspace state lives in `history.jsonl -> observed_artifact`

## 2. Live `api_proxy` Behavior

Confirmed against the real provider:

- synchronous dispatch works
- provider usage telemetry is captured and persisted
- the adapter can stage a structured turn result into the governed loop

Observed quality issue from the real model response:

- schema compliance is not guaranteed on the first attempt even when the high-level review is coherent
- the model also claimed review conclusions that did not fully align with the dev turn's `machine_evidence`

This does **not** contradict the protocol. It validates why the orchestrator's acceptance boundary must remain:

- structural validation first
- artifact observation second
- explicit human/agent judgment after that

## 3. Approval Command Semantics

This run did not reach a pending completion approval, but the current paused QA state plus the code path in `approvePhaseTransition()` / `approveRunCompletion()` are consistent with the frozen strict semantics:

- approval only succeeds when the matching pending object exists
- approval fails otherwise
- there is no request identifier that would let v1 distinguish `already approved` from `nothing pending`

## Judgment

- Live `api_proxy` validation: **confirmed**
- Full live Scenario A with both live adapters: **not confirmed**

Reason:

- `api_proxy` executed against the real provider and entered governed acceptance successfully.
- `local_cli` failed for an external quota reason before producing a staged result, so the full all-live PM -> Dev -> QA chain was not proven end-to-end in one uninterrupted run.

## Recommended Interpretation For Release

1. The original release-critical gap described in `HUMAN_TASKS.md` was the real Anthropic-backed QA turn inside the governed loop. That gap is now closed by evidence.
2. The full live `local_cli` proof remains desirable dogfood, but this run shows the remaining blocker is external CLI quota, not a protocol contradiction.
3. `accepted_integration_ref` should stay as currently specified: git anchor in state, exact accepted dirty workspace snapshot in `observed_artifact`.
4. `approve-transition` and `approve-completion` should stay strict in v1.

## Residual Risks

- `api_proxy` review quality can still be weak even when the response is structurally usable.
- Review artifacts for `api_proxy` are not materialized automatically from the provider response; an operator or follow-up automation still has to reconcile that gap.
- A future release should either tighten prompt/schema adherence further or add a post-processing layer for review artifact materialization.
