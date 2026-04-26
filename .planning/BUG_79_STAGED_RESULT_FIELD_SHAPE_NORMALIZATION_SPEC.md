# BUG-79 Staged Result Field-Shape Normalization Spec

## Purpose

BUG-78 and BUG-79 are the same defect class: a role completes useful work, emits a staged result with a recoverable field-shape mismatch, and AgentXchain pauses full-auto execution until an operator edits `.agentxchain/staging/<turn>/turn-result.json` with `jq`.

BUG-79 specifically covers objections that use `summary` and/or `detail` but omit the required `statement` field. The content is useful and mechanically recoverable; the substrate should normalize it before schema validation, preserve an audit trail, and keep unknown mismatches fail-closed.

## Interface

- `agentxchain accept-turn`
  - Runs staged-result normalization before schema validation.
  - Emits `staged_result_auto_normalized` for each field-shape repair.
- `agentxchain accept-turn --normalize-staged-result`
  - Explicit operator recovery flag that runs the same normalizer before acceptance.
  - The default path already runs known-safe normalization; the flag exists so blocker guidance never points operators at raw staging JSON.
- Staged-result normalizer table:
  - `artifact.type === "workspace"` + empty `files_changed` + explicit no-edit signal -> `artifact.type = "review"` (BUG-78)
  - `objections[].statement` missing/blank + `summary` string present -> `statement = summary`
  - `objections[].statement` missing/blank + no summary + `detail` string present -> `statement = detail`
- Prompt surfaces:
  - Every objection must include non-empty `statement`.
  - `summary` and `detail` are allowed only as supplemental fields, never substitutes for `statement`.

## Behavior

1. PM, QA, and product-marketing turns with `objections[].summary` but no `statement` accept after normalization.
2. PM, QA, and product-marketing turns with `objections[].detail` but no `statement` accept after normalization.
3. When both `summary` and `detail` exist, `summary` is used as the canonical `statement`.
4. Valid objections with `statement` do not emit a normalization event.
5. Objections with none of `statement`, `summary`, or `detail` still fail schema validation and surface `--normalize-staged-result` as the CLI recovery boundary.
6. BUG-78 artifact-type recovery emits the same generic `staged_result_auto_normalized` event in addition to the existing `artifact_type_auto_normalized` compatibility event.

## Error Cases

- Unknown schema mismatches still fail fast.
- Empty `summary` / empty `detail` are not used as recovery material.
- The normalizer does not invent objection content.
- Dirty worktrees still fail observed-diff validation after any artifact normalization.

## Acceptance Tests

- `AT-BUG79-001`: Child-process `agentxchain accept-turn` normalizes PM `summary`-only objections and accepts.
- `AT-BUG79-002`: Child-process `agentxchain accept-turn` normalizes PM `detail`-only objections and accepts.
- `AT-BUG79-003`: Child-process `agentxchain accept-turn` prefers `summary` over `detail`.
- `AT-BUG79-004`: Child-process `agentxchain accept-turn` accepts valid `statement` objections without normalization event.
- `AT-BUG79-005`: Child-process `agentxchain accept-turn` fails an objection with no recoverable text and prints `--normalize-staged-result`.
- `AT-BUG79-006`: The same summary/detail normalization coverage runs for `qa` and `product_marketing`.
- `AT-BUG79-007`: BUG-78 artifact recovery emits `staged_result_auto_normalized`.
- `AT-BUG79-008`: `.planning/STAGED_RESULT_INVARIANT_AUDIT.md` documents validator invariants, prompt coverage, normalizer coverage, and fail-fast-only cases.

## Open Questions

- Bounded retry with correction prompts remains future work after the known-safe normalizer table. The operator recovery flag prevents raw JSON edits for this class while keeping unknown mismatches fail-closed.

## Decisions

- `DEC-BUG79-STAGED-RESULT-NORMALIZER-001`: Treat BUG-78 and BUG-79 as one `staged_result_field_shape_mismatch_requires_manual_recovery` class. Safe repairs live in the staged-result normalizer table and emit typed audit events; unknown mismatches remain schema failures.
