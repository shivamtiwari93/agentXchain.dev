# BUG-96: Decision Rationale Normalization Spec

## Purpose

Close the next DOGFOOD-100 blocker discovered while re-verifying BUG-95 on `tusq.dev`.

The retained dev turn `turn_48fcfc7526b370ab` now passes the BUG-95 missing top-level field normalization, but schema validation still rejects its `decisions[]` entries because each decision uses `description` without a required `rationale`.

## Interface

Normalizer entry point:

- `normalizeTurnResult(turnResult, config, context)`

Affected schema field:

- `decisions[].rationale`

Accepted source fields for normalization, in order:

1. `reason`
2. `why`
3. `description`
4. `decision`
5. `statement`

## Behavior

- If `decisions[i].rationale` is a non-empty string, leave it unchanged.
- If `decisions[i].rationale` is missing or blank, copy the first non-empty string from the source fields above.
- If the same object also needs `statement` normalization, `statement` may be filled from `description` or `decision` first, and then used as a fallback rationale source.
- Emit a `staged_result_auto_normalized` event with field `decisions[i].rationale` and rationale `copied_from_<source>`.
- Preserve existing decision ID, statement, and category normalization behavior.

## Error Cases

- If a decision has no non-empty `rationale` and no usable source text, schema validation must still fail.
- Do not synthesize generic rationale text with no source material.
- Do not normalize non-object decision entries; schema validation must reject them.
- Do not normalize decision rationale from unrelated top-level fields such as turn `summary`.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-96-decision-rationale-normalization.test.js` accepts the exact cascade: BUG-95 top-level drift plus decision `description` with no `rationale`.
- The same test proves `reason` can populate missing `rationale` when `statement` is already present.
- The same test proves a decision object with no statement/rationale source material still fails.
- Existing BUG-95 tests continue to pass.

## Open Questions

- None for this patch. Broader question remains whether `decision` object schema should permanently support `description` as an alias, but the normalizer keeps the canonical stored shape as `statement` + `rationale`.
