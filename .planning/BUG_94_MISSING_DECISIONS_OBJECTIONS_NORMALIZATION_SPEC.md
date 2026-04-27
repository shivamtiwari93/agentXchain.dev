# BUG-94 Missing Decisions And Objections Array Normalization Spec

## Purpose

DOGFOOD-100 on `tusq.dev` paused on `agentxchain@2.155.47` after a useful authoritative `dev` turn emitted a staged result without the required top-level `decisions` and `objections` arrays.

The turn result contained enough protocol evidence to accept after the prior BUG-91/92/93 recovery chain, but schema validation failed before protocol validation:

```text
acceptTurn(dev): Validation failed at stage schema: Missing required field: decisions; Missing required field: objections
```

This is another BUG-79-class staged-result shape mismatch. Empty `decisions` is valid. Empty `objections` is valid for authoritative roles and invalid for `review_only` roles only because the challenge rule requires a non-empty objection set at protocol validation.

## Interface

The normalization boundary is `normalizeTurnResult(tr, config, context)` in `cli/src/lib/turn-result-validator.js`, before `validateSchema()`.

New normalization behavior:

- Missing top-level `decisions` normalizes to `[]`.
- Missing top-level `objections` normalizes to `[]`.
- Existing arrays are preserved.
- Existing non-array values still fail schema validation.
- Normalization emits `staged_result_auto_normalized` events with field names `decisions` and `objections`.

Prompt hardening lives in `cli/src/lib/dispatch-bundle.js` and must state that both arrays are always required, even when empty.

## Behavior

When a staged result omits `decisions`, AgentXchain inserts:

```json
"decisions": []
```

When a staged result omits `objections`, AgentXchain inserts:

```json
"objections": []
```

This is safe because the schema already allows empty arrays. Protocol validation remains responsible for role-specific challenge rules. A `review_only` role with omitted objections normalizes to an empty array and then fails with the existing challenge-required protocol error.

## Error Cases

- `decisions: null`, `decisions: {}`, or other non-array values still fail schema validation.
- `objections: null`, `objections: {}`, or other non-array values still fail schema validation.
- `review_only` roles with omitted objections still fail Stage E protocol validation because objections are empty after normalization.
- The normalizer must not synthesize fake objection statements from sidecar fields such as `challenge_to_prior_pm_turn`; an empty array is the only safe default.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-94-missing-decisions-objections-normalization.test.js` proves a command-chain retained `failed_acceptance` turn with missing top-level `decisions` and `objections` accepts through `agentxchain run --max-turns 1 --auto-approve --auto-checkpoint`.
- The same test proves normalization events are emitted for both missing arrays.
- The same test proves a `review_only` role with missing `objections` still fails with the challenge-required protocol error after normalization.
- Existing BUG-90 broad normalizer tests still pass.
- Existing BUG-92 failed-acceptance resume tests still pass.

## Open Questions

- None for BUG-94. Future dogfood failures may justify additional required-field defaults, but each new dogfood pause remains a top-level BUG per the DOGFOOD-100 discovery loop.
