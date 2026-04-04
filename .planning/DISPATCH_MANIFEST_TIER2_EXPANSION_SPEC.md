# Dispatch Manifest Tier 2 Fixture Expansion Spec

> IMPLEMENTED 2026-04-04 in Turns 21-22. Retained as historical scope record.

## Status

This expansion is complete and the original target counts are stale.

- `DM-006` through `DM-010` shipped
- `dispatch_manifest` error coverage is complete for the shipped verifier surface
- public docs and guards now reflect the current surface instead of the original 5→8 slice

## Purpose

Expand the `dispatch_manifest` conformance surface from 5 fixtures to 8, closing three verified coverage gaps in the verification error taxonomy.

## Gap Analysis

The shipped `verifyDispatchManifest()` in `dispatch-manifest.js` produces six error types:

| Error Type | Fixture Coverage | Gap? |
|---|---|---|
| `unexpected_file` | DM-002 | No |
| `digest_mismatch` | DM-003 | No |
| `missing_file` | DM-004 | No |
| `size_mismatch` | **None** | **Yes — DM-006** |
| `missing_manifest` | **None** | **Yes — DM-008** |
| `invalid_manifest` | **None** | Not in this slice (requires manifest corruption, lower priority) |

Additionally, no fixture tests **multiple simultaneous errors** in a single verification pass. The verifier accumulates all errors (lines 109-152 of `dispatch-manifest.js`), but no fixture proves this contract.

## New Fixtures

### DM-006: Size mismatch detection

**Type:** `reject`

**Rationale:** `verifyDispatchManifest()` checks file size independently from digest (lines 124-129). DM-003 tampers content to the same byte length ("Original content here." → "Tampered content here!" — both 22 bytes), so it triggers `digest_mismatch` only. No fixture triggers `size_mismatch`.

**Setup:** Bundle with a known file. `post_finalize_tamper` replaces the file content with a different-length string, guaranteeing both `size_mismatch` and `digest_mismatch` fire.

**Expected:** `result: "error"`, `error_type: "size_mismatch"` (the first error in the array, since size is checked before digest), `verification_errors` contains both `size_mismatch` and `digest_mismatch` entries.

### DM-007: Multiple simultaneous integrity violations

**Type:** `reject`

**Rationale:** The verifier accumulates ALL errors across all files and reports them in a single response. No existing fixture proves this contract — every reject fixture has exactly one error.

**Setup:** Bundle with two files. `post_finalize_inject` adds an extra file, `post_finalize_delete` removes one declared file. This produces at least `unexpected_file` + `missing_file` — two different error types from two different verification phases.

**Expected:** `result: "error"`, `verification_errors` array length >= 2, containing both `unexpected_file` and `missing_file` entries.

### DM-008: Missing manifest after finalization

**Type:** `reject`

**Rationale:** `verifyDispatchManifest()` returns `missing_manifest` when MANIFEST.json does not exist (lines 82-88). No fixture exercises this path because `finalizeManifestForFixture()` always creates MANIFEST.json before mutations.

**Implementation:** Add `post_finalize_delete_manifest: true` support to `applyManifestFixtureMutations()`. When set, the mutation step deletes MANIFEST.json itself after finalization.

**Expected:** `result: "error"`, `error_type: "missing_manifest"`, `verification_errors` contains one `missing_manifest` entry.

## Adapter Changes

### `applyManifestFixtureMutations()` extension

Add handling for `setup.post_finalize_delete_manifest`:

```javascript
if (fixture.setup.post_finalize_delete_manifest) {
  const manifestPath = join(bundleDir, 'MANIFEST.json');
  try { unlinkSync(manifestPath); } catch { /* surfaced by verification */ }
}
```

This is a narrow, additive change. Existing fixtures do not set `post_finalize_delete_manifest`, so they are unaffected.

## Out of Scope

- `invalid_manifest` (malformed JSON or missing schema fields) — would require `post_finalize_corrupt_manifest` mutation. Lower priority than the three gaps above.
- Hook audit surface expansion — separate slice per GPT's "pick one surface" instruction.
- Fixture count enforcement in guards — per `DEC-EVIDENCE` open question, structural alignment is sufficient.

## Acceptance Tests

1. `DM-006` passes against the reference adapter with `size_mismatch` as the first error type.
2. `DM-007` passes with >= 2 errors containing both `unexpected_file` and `missing_file`.
3. `DM-008` passes with `missing_manifest` error type.
4. All existing fixtures (DM-001 through DM-005) continue to pass unchanged.
5. Full `agentxchain verify protocol --tier 2` passes with 0 failures.
6. Fixture counts in `protocol-implementor-guide.mdx` updated from `8` to `11` for Tier 2.
7. Website homepage stat updated from `53` to `56`.
