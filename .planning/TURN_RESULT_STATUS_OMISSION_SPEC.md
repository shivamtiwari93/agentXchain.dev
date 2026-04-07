# Turn Result Status Omission Spec

## Purpose

Close a newly observed `api_proxy` output-contract gap without weakening the acceptance boundary.

Live evidence in Turn 78 produced a coherent QA review payload that included:

- valid identity fields
- structured `decisions`, `objections`, `verification`, and `artifact`
- `phase_transition_request: "qa"`

But it omitted the required top-level `status` field, causing schema rejection before the retained QA turn could advance into the actual `qa` phase.

This is not the same defect as `artifacts_created` object drift or exit-gate-as-phase confusion. It needs its own narrow recovery rule.

## Interface

### `normalizeTurnResult(turnResult, config) -> { normalized, corrections[] }`

Extend the existing pre-validation normalization step in `cli/src/lib/turn-result-validator.js`.

No new command surface.

## Behavior

### Rule 1: Missing status + explicit human escalation -> `needs_human`

If `status` is absent and `needs_human_reason` is a non-empty string:

- set `status` to `"needs_human"`
- record a correction explaining that `needs_human_reason` made the intended status unambiguous

### Rule 2: Missing status + explicit forward-progress signal -> `completed`

If `status` is absent and either of these is true:

- `phase_transition_request` is a non-empty string
- `run_completion_request === true`

Then:

- set `status` to `"completed"`
- record a correction explaining which signal made the completion intent unambiguous

This is intentionally narrow. It recovers the observed live QA payload because that payload requested `phase_transition_request: "qa"`.

### Rule 3: Fail closed on ambiguous omissions

Do **not** infer `status` when it is missing but neither Rule 1 nor Rule 2 applies.

Examples that must still fail schema validation:

- summary + objections present, but no transition/completion request and no `needs_human_reason`
- malformed payload missing both `status` and other required fields

## Error Cases

| Condition | Required behavior |
|---|---|
| Missing `status`, `needs_human_reason` present | Normalize to `needs_human` |
| Missing `status`, `phase_transition_request` present | Normalize to `completed` |
| Missing `status`, `run_completion_request: true` present | Normalize to `completed` |
| Missing `status`, no unambiguous signal | Leave unchanged; schema validation fails |

## Acceptance Tests

- `AT-STATUS-001`: missing `status` + `phase_transition_request: "qa"` normalizes to `completed`
- `AT-STATUS-002`: missing `status` + `run_completion_request: true` normalizes to `completed`
- `AT-STATUS-003`: missing `status` + `needs_human_reason` normalizes to `needs_human`
- `AT-STATUS-004`: missing `status` with no forward-progress or escalation signal remains unchanged
- `AT-STATUS-005`: validator accepts an otherwise-valid staged result after `status` is normalized from `phase_transition_request`

## Open Questions

None. This slice intentionally avoids broad status inference.
