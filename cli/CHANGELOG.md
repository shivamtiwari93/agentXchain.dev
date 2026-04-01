# Changelog

## 1.0.0

- Finalized the governed v4 protocol as the canonical CLI surface: orchestrator-owned `.agentxchain/state.json`, structured turn results, append-only `history.jsonl` and `decision-ledger.jsonl`, gate-driven phase progression, and explicit completion approval.
- Shipped the full governed turn lifecycle across the CLI: `init --governed`, `migrate`, `status`, `resume`, `step`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, and `validate --mode turn`.
- Froze the dispatch contract around `.agentxchain/dispatch/current/{ASSIGNMENT.json,PROMPT.md,CONTEXT.md}` with retry-aware redispatch, rejected-attempt preservation, and warning-bearing degraded context handling.
- Added the governed validation pipeline as a release contract: structural schema checks, assignment identity checks, observed artifact validation, verification normalization, and protocol-compliance enforcement.
- Completed the v1 adapter surface: `manual` polling, `local_cli` subprocess dispatch, and `api_proxy` synchronous review-only execution.
- Added typed `api_proxy` recovery classification for missing credentials, auth failure, rate limits, model resolution errors, context overflow, network/timeout failures, response parsing failures, and turn-result extraction failures, with `api-error.json` audit artifacts.
- Proved the governed lifecycle through automated end-to-end coverage for the happy path and reject/retry path, alongside CLI-level guards for malformed config rejection and concurrent turn prevention.
- Expanded the planning/spec package to 13 governed v1 artifacts covering CLI, types, state machine, dispatch bundle, operator recovery, adapter contracts, e2e flows, API error recovery, and release gating.

## 0.9.0

- Introduced governed protocol mode with orchestrator-owned `state.json`, phase routing, and gate enforcement.
- Added the full governed turn lifecycle: assign, dispatch, validate, accept, reject, retry, and escalation.
- Added three governed adapter classes: `manual`, `local_cli`, and `api_proxy`.
- Added recovery descriptors across operator surfaces so blocked states expose `typed_reason`, `owner`, `recovery_action`, and `turn_retained`.
- Added phase transition approvals and run-completion approval flows with explicit human sign-off.
- Added the operator recovery contract and blocked-state coverage for validation failures, human pauses, dispatch failures, and retry exhaustion.
- Expanded automated CLI coverage for governed flows, including 115+ tests and focused recovery-surface tests.
