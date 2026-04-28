# BUG-103 Decision Title Statement Normalization Spec

## Purpose

DOGFOOD-100 on tusq.dev found a PM roadmap-replenishment turn that produced useful planning work and valid decision objects, but used `decisions[].title` plus `rationale` instead of the required `decisions[].statement`.

The framework must recover this unambiguous result-shape drift before schema validation, without weakening the acceptance boundary for decision objects that contain no decision text.

## Interface

- Input: staged `turn-result.json` before schema validation.
- Field affected: `decisions[].statement`.
- Recoverable source fields, in precedence order:
  1. `decision`
  2. `description`
  3. `summary`
  4. `title`
- Audit event:
  - `field`: `decisions[N].statement`
  - `rationale`: `copied_from_title`

## Behavior

- If `decisions[].statement` is missing or blank and `decisions[].title` is a non-empty string, copy the trimmed title into `statement`.
- Preserve the original `title` field for audit readability.
- Preserve existing `decision`, `description`, and `summary` precedence.
- Continue normalizing decision IDs and categories as already implemented.
- Do not synthesize a statement from `rationale` alone; rationale explains a decision but is not the decision statement.

## Error Cases

- A decision with no non-empty `statement`, `decision`, `description`, `summary`, or `title` still fails schema validation.
- A non-string `title` is ignored and does not bypass schema validation.
- Non-array `decisions` still fails unless handled by the existing missing-array default path.

## Acceptance Tests

- `AT-BUG-103-001`: accept a staged PM turn whose decisions have `title` and `rationale` but no `statement`, and emit `copied_from_title` normalization events.
- `AT-BUG-103-002`: preserve existing fail-closed behavior when a decision has `rationale` but no statement source material.
- `AT-BUG-103-003`: existing BUG-101 summary-to-statement tests remain green.

## Open Questions

- None. This is a deterministic staged-result normalization extension in the existing BUG-79/90/101 class.
