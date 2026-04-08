# API Proxy Proposed Lifecycle E2E Spec

## Purpose

Prove the missing governed-lifecycle slice where `api_proxy` uses `proposed` write authority across implementation and QA, and operator `proposal apply` actions are part of the real lifecycle rather than isolated side proofs.

## Interface

- `agentxchain step --role pm`
- `agentxchain approve-transition`
- `agentxchain step --role dev`
- `agentxchain proposal apply <turn_id>`
- `agentxchain step --role qa`
- `agentxchain approve-completion`
- Subprocess E2E test: `cli/test/e2e-api-proxy-proposed-lifecycle.test.js`

## Behavior

1. Planning uses a real governed phase transition, not a forged state patch. The planning turn must request `implementation`, satisfy the planning gate, and pause for human approval.
2. The first implementation turn uses `api_proxy` with `proposed` authority to stage product code plus `.planning/IMPLEMENTATION_NOTES.md`. The implementation gate must fail while those files exist only under `.agentxchain/proposed/<turn_id>/`.
3. After `proposal apply` copies the staged files into the workspace and they are committed, a second implementation turn may request `qa` and the implementation gate must pass.
4. The first QA turn uses `api_proxy` with `proposed` authority to stage `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, and `.planning/RELEASE_NOTES.md`. Run completion must fail while those files are proposal-only.
5. After the QA proposal is applied and committed, a second QA turn may request run completion and the run must pause on `pending_run_completion` because the final gate still requires human approval.
6. `approve-completion` is the only step that completes the run. Proposal materialization and gate passage do not bypass the human completion gate.

## Error Cases

- Planning gate passes structurally but does not pause for approval
- Implementation gate treats proposal-directory files as workspace truth
- QA completion gate treats proposal-directory files as workspace truth
- Applied proposal files are not committed, leaving the next governed turn with a dirty baseline
- Final QA request completes the run directly instead of pausing for `approve-completion`

## Acceptance Tests

1. `AT-APIPROXY-PROP-LC-001`: planning turn pauses for human transition approval before implementation begins
2. `AT-APIPROXY-PROP-LC-002`: first proposed implementation turn leaves the run in `implementation` and materializes a proposal
3. `AT-APIPROXY-PROP-LC-003`: applying the implementation proposal and running a second implementation turn advances the run to `qa`
4. `AT-APIPROXY-PROP-LC-004`: first proposed QA turn leaves the run active in `qa` because completion artifacts exist only in the proposal directory
5. `AT-APIPROXY-PROP-LC-005`: after applying QA completion artifacts, a second QA turn pauses on `pending_run_completion`
6. `AT-APIPROXY-PROP-LC-006`: `approve-completion` completes the run only after the decision ledger records the implementation and QA proposal-apply actions

## Open Questions

None.
