# BUG-89: Objection ID Normalization Spec

## Purpose

Extend the staged-result normalization table (BUG-79 class) to handle invalid objection `id` fields that do not match the required `OBJ-NNN` pattern. Invalid but structurally unambiguous objection IDs should be deterministically rewritten to `OBJ-001`, `OBJ-002`, ... before schema validation runs.

## Context

Discovered during DOGFOOD-100-TURNS on `agentxchain@2.155.42`. QA turn `turn_4125be3cf057395a` emitted `"id": "OBJ-002-M31"` which fails `/^OBJ-\d+$/`. The objection content is valid and useful — only the ID shape is wrong. This is the same staged-result field-shape mismatch class as BUG-79 (objection `statement`) and BUG-78 (artifact `type`).

Per `DEC-GPT56-BUG89-CLASS-REGRESSION-001`: this should extend the existing normalization table, not be a one-off prompt tweak.

## Interface

The fix adds to the existing `normalizeTurnResult()` in `cli/src/lib/turn-result-validator.js`.

### Normalization Rule

For each `objections[i]`:
1. If `id` is a non-empty string matching `/^OBJ-\d+$/` → no normalization needed.
2. If `id` is missing, empty, or does not match `/^OBJ-\d+$/` → rewrite to `OBJ-{i+1}` (zero-padded to 3 digits: `OBJ-001`, `OBJ-002`, etc.).
3. Emit `staged_result_auto_normalized` event with `field: "objections[i].id"`, `original_value`, `normalized_value`, `rationale: "invalid_objection_id_rewritten"`.

### Prompt Hardening

Add explicit `OBJ-NNN` requirement to QA role prompt injection in `dispatch-bundle.js` (the `pm` and `product_marketing` prompts already have this via the BUG-79 prompt hardening, but QA needs it too).

## Behavior

- Normalizer runs BEFORE `validateSchema()` / `validateObjection()`.
- Invalid IDs are replaced deterministically by array index.
- The original ID is preserved in the audit event payload.
- Valid IDs are never touched.
- Non-object objections are passed through for validator to reject.

## Error Cases

- Objection with no `id`, no `statement`, no `summary`, no `detail` → ID normalization applies, but statement normalization fails → fail-fast with CLI recovery guidance (existing BUG-79 behavior).
- Objection that is `null` or non-object → passed through unchanged (existing guard).

## Acceptance Tests

1. QA turn with `id: "OBJ-002-M31"` → normalized to `OBJ-001`, accepted cleanly. Audit event emitted.
2. PM turn with `id: ""` (empty string) → normalized to `OBJ-001`, accepted cleanly.
3. Turn with `id: "obj-1"` (wrong case/format) → normalized to `OBJ-001`.
4. Turn with valid `id: "OBJ-001"` → no normalization, accepted as-is.
5. Multiple objections with invalid IDs → sequential `OBJ-001`, `OBJ-002`, etc.
6. Turn with `id: null` → normalized to `OBJ-001`.

## Open Questions

None — this is a mechanical extension of the BUG-79 normalization table.
