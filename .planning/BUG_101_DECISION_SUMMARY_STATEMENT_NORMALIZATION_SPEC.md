# BUG-101 Decision Summary Statement Normalization Spec

## Purpose

BUG-101 was discovered during DOGFOOD-100 on shipped `agentxchain@2.155.54`, after BUG-100 recovery advanced the tusq.dev strict counter from 5 to 13. Dev turn `turn_cc1f4a9f48f528e8` produced a useful staged result, but each `decisions[]` item used `summary` plus `rationale` instead of the required `statement` plus `rationale`.

The framework already normalizes `decision` and `description` into missing `decisions[].statement`; `summary` is the same unambiguous decision-text synonym and should be normalized before schema validation.

## Interface

- Input: staged turn result JSON with `decisions[]` entries.
- Normalized output: when `decisions[i].statement` is missing or blank and `decisions[i].summary` is a non-empty string, copy `summary` into `statement`.
- Audit event: existing `staged_result_auto_normalized` event carries `field: decisions[i].statement` and `rationale: copied_from_summary`.
- Prompt surface: dispatch bundle field rules explicitly forbid using `summary` as the decision field name.

## Behavior

1. Preserve existing precedence: `decision` then `description` then `summary`.
2. Do not overwrite a valid existing `statement`.
3. Do not invent statement text when no meaningful synonym field exists.
4. Preserve existing rationale normalization and category normalization.
5. Keep review-only challenge enforcement unchanged.

## Error Cases

- A decision with no `statement`, `decision`, `description`, or `summary` remains a schema failure.
- A blank `summary` remains a schema failure when no higher-precedence source exists.
- Non-object decision entries remain schema failures.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-101-decision-summary-statement-normalization.test.js` proves an `accept-turn` command-chain accepts a staged result with seven `decisions[]` entries using `summary` and `rationale`, matching the tusq.dev BUG-101 failure shape.
- The same test proves an otherwise similar decision with no statement source still fails schema validation.
- `cli/test/beta-tester-scenarios/bug-96-decision-rationale-normalization.test.js` remains green to prove BUG-96 behavior is preserved.

## Open Questions

- None. `summary` is a deterministic synonym for the required decision statement when it is inside a `decisions[]` object.
