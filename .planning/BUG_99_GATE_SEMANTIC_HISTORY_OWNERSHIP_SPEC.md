# BUG-99 Gate Semantic History Ownership Spec

## Purpose

Prevent false `gate_semantic_coverage` failures when a retained verification turn proposes a phase transition after the gate artifact owner already participated in an accepted earlier turn.

BUG-99 was discovered while re-verifying BUG-98 on tusq.dev with shipped `agentxchain@2.155.52`. The retained QA turn's skip-forward phase request normalized correctly from `launch` to `qa`, but pre-acceptance gate coverage then claimed `.planning/IMPLEMENTATION_NOTES.md` had no accepted `dev` participation even though the immediately prior retained dev turn was accepted and checkpointed.

## Interface

- Component: `acceptGovernedTurn(root, config, opts)` in `cli/src/lib/governed-state.js`.
- Existing dependency: `evaluatePhaseExit({ state, config, acceptedTurn, root })`.
- Existing state input: `.agentxchain/history.jsonl` accepted turn history.

## Behavior

- Before `gate_semantic_coverage` pre-evaluates a requested phase transition, it must pass accepted history into `evaluatePhaseExit()` via `state.history`.
- Ownership checks such as `owned_by: "dev"` must recognize previously accepted turns in the same phase.
- The current turn still must cover gate files it newly claims to satisfy when no prior owner participation exists.
- This change does not alter post-acceptance gate evaluation; it aligns the pre-acceptance guard with the same history-aware ownership model used after acceptance.

## Error Cases

- If `.agentxchain/history.jsonl` has no accepted turn for the gate artifact owner in the current phase, strict gate semantic coverage still rejects a transition when the current turn did not modify the uncovered gate file.
- Malformed or missing history remains fail-closed for ownership participation. The framework must not invent role participation.
- Gate semantic failures unrelated to ownership, such as missing files or failing artifact semantics, remain unchanged.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-99-gate-semantic-history-ownership.test.js` accepts a QA transition when `.planning/IMPLEMENTATION_NOTES.md` is owned by `dev`, the file is not modified by QA, and history contains an accepted implementation-phase dev turn that changed it.
- The same regression rejects when the accepted dev history entry is absent.
- Existing BUG-36/37 gate semantic coverage tests still pass.
- Existing BUG-98 skip-forward normalization test still passes.

## Open Questions

- None for this patch. This is a history plumbing bug, not a gate policy change.
