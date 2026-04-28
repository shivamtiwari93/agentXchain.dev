# BUG-104 Structured Machine Evidence Normalization Spec

Status: Implemented in v2.155.58 candidate
Owner: GPT 5.5 (Codex)
Date: 2026-04-28

## Purpose

Prevent full-auto DOGFOOD-100 turns from blocking when a useful staged result places typed structured observations in `verification.machine_evidence[]` without executable `command` and integer `exit_code` fields.

The `machine_evidence` contract remains strict: it is for executable command records. Typed observations such as file-marker checks, bucket summaries, VISION citation checks, and acceptance-contract checks are evidence, but they are not replayable command records. The framework should preserve them as `evidence_summary` text instead of forcing manual staging JSON edits.

## Interface

- Input: staged turn result JSON with `verification.machine_evidence[]`.
- Output: normalized turn result before schema and verification validation.
- Event surface: `staged_result_auto_normalized` entries with:
  - `field`: `verification.machine_evidence[N]`
  - `rationale`: `structured_machine_evidence_moved_to_evidence_summary`
  - `normalized_value`: concise summary text

## Behavior

1. Valid command evidence remains unchanged when an entry has:
   - non-empty string `command`
   - integer `exit_code`
2. Recoverable structured evidence is detected when an entry is an object with a non-empty string `type` but lacks valid command evidence.
3. Recoverable structured evidence is removed from `machine_evidence[]` and appended to `verification.evidence_summary` under a `Structured evidence:` prefix.
4. Existing `evidence_summary` text is preserved.
5. Mixed arrays keep valid command entries while moving typed structured entries.
6. The normalizer does not synthesize fake shell commands.

## Error Cases

1. Non-object `machine_evidence[]` entries still fail validation.
2. Object entries without valid command evidence and without a non-empty `type` still fail validation.
3. Command entries with missing or non-integer `exit_code` still fail validation unless they are typed structured observations moved out of `machine_evidence[]`.
4. Passing verification with no commands, no machine evidence, and no evidence summary remains only a warning, preserving existing behavior.

## Acceptance Tests

1. `AT-BUG104-001`: `accept-turn` accepts a PM turn whose `verification.machine_evidence[]` contains typed marker objects copied from the tusq.dev BUG-104 shape.
2. `AT-BUG104-002`: the accepted turn emits `staged_result_auto_normalized` for `verification.machine_evidence[0]` with `rationale: structured_machine_evidence_moved_to_evidence_summary`.
3. `AT-BUG104-003`: valid command-shaped machine evidence remains in `machine_evidence[]` after normalization.
4. `AT-BUG104-004`: unrecognizable malformed machine evidence still fails closed with the existing validation error.
5. `AT-BUG104-005`: dispatch-bundle instructions tell agents to put typed observations in `evidence_summary`, not `machine_evidence`.

## Open Questions

None for this patch. Future work may add a first-class `structured_evidence` schema, but that would be a protocol change and is not required to unblock DOGFOOD-100.
