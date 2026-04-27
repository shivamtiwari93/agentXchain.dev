# BUG-95: Missing Required Fields Normalization Spec

## Discovery

Discovered 2026-04-27 on tusq.dev DOGFOOD-100 session `cont-1d0be522`, turn `turn_48fcfc7526b370ab` (dev role), `agentxchain@2.155.48`.

Observed error:
```
acceptTurn(dev): Validation failed at stage schema:
  Missing required field: files_changed
  Missing required field: runtime_id
  Missing required field: summary
  Missing required field: artifact
  Missing required field: proposed_next_role
```

The staged result used `files_modified` (synonym for `files_changed`) and omitted four other required fields that are inferrable from dispatch context and config.

## Root Cause

The `normalizeTurnResult()` function in `turn-result-validator.js` did not handle these five field deviations:

1. **`files_modified` → `files_changed`**: The model used the synonym `files_modified` instead of the canonical `files_changed`. No rename normalizer existed.
2. **Missing `runtime_id`**: The dispatch context (`activeTurn.runtime_id`) already knows the runtime ID, but the normalizer did not default it.
3. **Missing `summary`**: The staged result contained `milestone_title` and `milestone` fields that could synthesize a summary, but no fallback existed.
4. **Missing `artifact`**: The artifact type is inferrable from `files_changed` (non-empty → `workspace`, empty → `review`), but no inference existed.
5. **Missing `proposed_next_role`**: The routing config knows allowed next roles for the current phase, but no default existed.

## Fix

### Layer 1: Normalizer (`turn-result-validator.js`)

Added five normalization rules to `normalizeTurnResult()`:

1. **`files_modified` rename** (before variable computation): If `files_changed` is absent and `files_modified` is an array, rename it. Placed at top of normalizer before `files_changed` is used by other rules.

2. **`runtime_id` default**: If absent and `context.runtimeId` is available (passed from `activeTurn.runtime_id`), default it.

3. **`summary` synthesis**: If absent or empty, synthesize from `milestone_title` (preferred), `milestone` (secondary), or `"<role> turn completed"` (fallback).

4. **`artifact` inference**: If absent or not a plain object, infer `{ type: 'workspace' }` if `files_changed` is non-empty, else `{ type: 'review' }`.

5. **`proposed_next_role` default**: If absent, default to first allowed role for current phase (excluding self), or `'pm'` as absolute fallback.

### Layer 2: Context plumbing (`turn-result-validator.js`)

Added `context.runtimeId` pass-through from `activeTurn.runtime_id` in the normContext setup, so the normalizer has access to the dispatch context's runtime ID.

### Layer 3: Prompt hardening (`dispatch-bundle.js`)

Strengthened field requirement lines in the dispatch bundle to emphasize:
- `summary` is REQUIRED non-empty string
- `runtime_id` is REQUIRED and must match exactly
- `files_changed` is the field name (NOT `files_modified`), must be array of strings
- `proposed_next_role` is REQUIRED

### Layer 4: Conformance fixture update (`.agentxchain-conformance/fixtures/1/turn_result_validation/TR-002.json`)

TR-002 previously tested "missing `summary` → schema rejection". Since `summary` is now auto-normalized, changed the fixture to test "missing `run_id` → schema rejection" (a field with no normalizer).

## Regression Tests

`cli/test/beta-tester-scenarios/bug-95-missing-required-fields-normalization.test.js` — 8 command-chain integration tests:

1. Exact tester reproduction (all 5 deviations at once)
2. `files_modified` rename
3. Missing `runtime_id` default
4. Missing `summary` synthesis from `milestone_title`
5. Missing `artifact` inference from `files_changed`
6. Missing `proposed_next_role` default
7. Valid result passthrough (no normalization needed)
8. `files_modified` + `files_changed` coexistence (precedence)

## Collateral Fix

`cli/test/connector-validate-command.test.js` AT-CCV-005: Changed the invalid agent's staged result from missing `summary` (now auto-normalizable) to `status: 'invalid_not_a_valid_status'` (genuinely invalid).

## Audit Table Update

`.planning/STAGED_RESULT_INVARIANT_AUDIT.md` normalizer table updated with 5 new BUG-95 entries.

## Closure Criteria

1. ✅ 8 command-chain regression tests pass
2. ✅ Conformance self-validation passes (Tier 1/2/3, all fixtures including TR-002)
3. ✅ AT-CCV-005 connector-validate test passes
4. ✅ Full test suite green (7281 tests, 0 failures)
5. ⬜ Published package resumes tusq.dev same session
6. ⬜ Same-session reverify evidence captured
