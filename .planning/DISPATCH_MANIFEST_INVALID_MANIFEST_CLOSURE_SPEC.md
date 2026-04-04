# Dispatch Manifest Invalid Manifest Closure Spec

## Purpose

Close the remaining `dispatch_manifest` Tier 2 conformance gap by proving `invalid_manifest` behavior with executable fixtures, while removing fixture-order coupling that would incorrectly treat reference adapter error ordering as protocol truth.

## Interface

### Fixture matcher extension

Add a new assertion object for fixture expectations:

```json
{
  "assert": "unordered_array",
  "items": [ ... ]
}
```

Behavior:

- `actual` MUST be an array.
- `actual.length` MUST equal `items.length`.
- Every expected item MUST match exactly one actual item using the existing recursive partial-object matcher.
- Array order is ignored.

This is required for `verification_errors`, where the protocol cares about which integrity violations are reported, not the internal iteration order used by one implementation.

### Manifest mutation extension

Add `setup.post_finalize_corrupt_manifest` to conformance fixtures.

Shape:

```json
{
  "post_finalize_corrupt_manifest": {
    "turn_abc": "{ invalid json"
  }
}
```

or

```json
{
  "post_finalize_corrupt_manifest": {
    "turn_abc": { "manifest_version": "1.0" }
  }
}
```

Behavior:

- The adapter finalizes the bundle normally.
- After finalization, it overwrites `MANIFEST.json`.
- String values are written verbatim.
- Object values are JSON-stringified.

## Behavior

1. `DM-006` and `DM-007` stop asserting `error_type` and ordered `verification_errors`.
2. `DM-009` proves malformed `MANIFEST.json` returns `error_type: "invalid_manifest"`.
3. `DM-010` proves schema-invalid `MANIFEST.json` returns `error_type: "invalid_manifest"`.
4. Tier 2 fixture counts increase from `11` to `13`.
5. `dispatch_manifest` surface counts increase from `8` to `10`.
6. Total public corpus count increases from `56` to `58`.

## Error Cases

- If `unordered_array.items` is not an array, the matcher must fail closed.
- If `post_finalize_corrupt_manifest` is absent, existing fixtures remain unchanged.
- If manifest corruption writes invalid JSON, verification must surface `invalid_manifest`, not a fixture-setup error.
- If manifest corruption writes valid JSON without required fields, verification must surface `invalid_manifest`, not `missing_manifest`.

## Acceptance Tests

- `agentxchain verify protocol --tier 2 --surface dispatch_manifest --target . --format json` passes with `10` fixtures run and `10` fixtures passed.
- `agentxchain verify protocol --tier 2 --target . --format json` passes with `13` Tier 2 fixtures run and `13` passed.
- `DM-006` passes even if `size_mismatch` and `digest_mismatch` are returned in either order.
- `DM-007` passes even if `missing_file` and `unexpected_file` are returned in either order.
- `DM-009` passes only when malformed manifest content maps to `invalid_manifest`.
- `DM-010` passes only when schema-invalid manifest content maps to `invalid_manifest`.
- Website and marketing surfaces show `58` conformance fixtures, and the implementor guide shows Tier 2 fixture count `13`.

## Open Questions

- None for this slice. `invalid_manifest` is already shipped behavior in the verifier; this work only closes executable proof and removes matcher brittleness.
