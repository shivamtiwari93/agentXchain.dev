# GAP-005 — Charter/Validator Schema Mismatch for idle_expansion_result

Date: 2026-04-24

## Trigger

After `agentxchain@2.155.7` shipped the GAP-004 charter fix, the PM now
produces structured `idle_expansion_result` JSON. However, schema validation
fails with:

```text
acceptTurn(pm): Validation failed at stage schema:
  idle_expansion_result.vision_traceability must be an array.;
  idle_expansion_result.new_intake_intent must be an object.
```

## Root Cause

The charter OUTPUT FORMAT section (added in GAP-004 fix) specified a schema
that doesn't match the validator's expectations:

| Field | Charter says | Validator expects |
|-------|-------------|-------------------|
| `vision_traceability` | Object `{headings: [...], rationale: "..."}` | Array of `{vision_heading, goal, kind}` |
| `new_intake_intent` fields | Flat at top level (`title`, `charter`, etc.) | Nested under `new_intake_intent` object |

The PM faithfully produced the charter's specified shape, but the validator
rejected it because the shapes don't match.

## Fix

1. **Charter updated** (`continuous-run.js`): now specifies `new_intake_intent`
   as a nested object and `vision_traceability` as an array of
   `{vision_heading, goal, kind}` entries, matching the validator schema.

2. **Normalizer hardened** (`turn-result-validator.js`): the
   `normalizeVisionTraceabilityForTurnResult` function now transforms
   object-shaped traceability `{headings: [...], rationale: "..."}` into the
   expected array format, providing backward compatibility for PMs that cached
   the prior charter format.

## Related

- GAP-004: charter didn't specify output format at all (PM produced text only)
- GAP-005: charter specified wrong schema (PM produced structured JSON that
  didn't match validator)
- Both are now fixed — the charter matches the validator and the normalizer
  handles legacy shapes.
