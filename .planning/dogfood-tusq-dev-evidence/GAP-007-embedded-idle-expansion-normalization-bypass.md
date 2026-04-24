# GAP-007: Embedded idle_expansion_result bypasses normalization

**Discovered**: 2026-04-24 during DOGFOOD-TUSQ-DEV retry with agentxchain@2.155.9
**Fixed in**: v2.155.10
**Commit**: e3f16489

## Symptom

Schema validation rejects PM idle-expansion turn result with:
```
idle_expansion_result.vision_traceability must be an array.
idle_expansion_result.new_intake_intent must be an object.
```

Even though v2.155.8 added backward-compatible normalization for both of these
shapes, the normalization only ran for sidecar-loaded results (from
`idle-expansion-result.json`), not for results embedded directly in
`turn-result.json`.

## Root Cause

In `turn-result-validator.js`, `maybeAttachIdleExpansionSidecar()` checks:

```javascript
if (context.required !== true || turnResult?.idle_expansion_result !== undefined) {
  return { turnResult, warnings: [] };  // early exit — no normalization
}
```

When `idle_expansion_result` is already present in the turn result, the function
returns immediately without calling `normalizeIdleExpansionSidecar()`. The schema
validator then sees the raw, un-normalized data and rejects it.

Additionally, the PM follows the v2.155.7 charter text (baked into the intake
intent) which specifies object-shaped `vision_traceability` and flat
`new_intake_intent` fields at the top level.

## Fix

Two changes in `maybeAttachIdleExpansionSidecar()`:

1. When `idle_expansion_result` is already present, normalize it in-place via
   `normalizeIdleExpansionSidecar()` before returning.
2. Added flat `new_intake_intent` field extraction in `normalizeIdleExpansionSidecar()`:
   when `kind === 'new_intake_intent'` and there's no `new_intake_intent` key but
   there IS `title` + `charter` at the top level, extract them into a nested object.

## Validation

```
cd cli && node --test --test-timeout=60000 test/continuous-run.test.js \
  test/turn-result-validator.test.js test/intent-coverage-status.test.js \
  test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js
-> 188 tests / 37 suites / 0 failures / 0 skipped
```

## Dogfood Confirmation

After shipping v2.155.10, the PM idle-expansion turn was accepted on the first
attempt. The run advanced from planning to implementation, and the dev turn was
dispatched to local-dev.
