# Turn Result Placeholder Validation Spec

Status: shipped
Owner: GPT 5.4
Created: 2026-04-13

## Purpose

Tighten the governed turn-result acceptance boundary so copied dispatch-bundle scaffold placeholders cannot be accepted as valid run artifacts.

The existing dispatch template uses descriptive angle-bracket placeholders such as `<one-line summary of what you accomplished>` and `<path/to/modified/file>`. Rejecting only `summary` and `proposed_next_role` still allows accepted turn artifacts to contain meaningless placeholder text in decisions, objections, file paths, and verification payloads. That weakens the audit surface and makes accepted turns look complete when they are not.

## Interface

- File: `cli/src/lib/turn-result-validator.js`
- Validation stage: Stage A (`schema`)
- Input: staged turn result JSON
- Output: schema errors for any exact unfilled template placeholder string emitted by `buildTurnResultTemplate()`

## Behavior

Reject exact angle-bracket placeholder strings in these turn-result fields:

- `summary`
- `decisions[].statement`
- `decisions[].rationale`
- `objections[].against_turn_id`
- `objections[].statement`
- `files_changed[]`
- `verification.commands[]`
- `verification.evidence_summary`
- `verification.machine_evidence[].command`
- `proposed_next_role`

Rules:

- Reject only whole-string scaffold placeholders matching `^<[^>]+>$`.
- Do not reject normal prose that happens to contain angle brackets mid-string, such as `Fixed <Config> parsing bug`.
- Surface the failing field path in the schema error so the operator or agent can replace the placeholder directly.

## Error Cases

- A copied dispatch scaffold is submitted unchanged for an authoritative turn.
- A review-only turn leaves `objections[0].statement` or `against_turn_id` at the scaffold value.
- Verification metadata keeps `<command you ran to verify>` or `<exact command that was run>` while claiming `verification.status: "pass"`.
- A real sentence containing angle brackets mid-string must remain valid.

## Acceptance Tests

- `AT-TRPV-001`: reject `decisions[0].statement` and `decisions[0].rationale` when they remain exact scaffold placeholders.
- `AT-TRPV-002`: reject `objections[0].against_turn_id` and `objections[0].statement` when they remain exact scaffold placeholders.
- `AT-TRPV-003`: reject `files_changed[0]`, `verification.commands[0]`, `verification.evidence_summary`, and `verification.machine_evidence[0].command` when they remain exact scaffold placeholders.
- `AT-TRPV-004`: accept real strings with angle brackets embedded mid-string.

## Open Questions

- None for this slice. The validator should fail closed on scaffold placeholders emitted by the shipped dispatch template.
