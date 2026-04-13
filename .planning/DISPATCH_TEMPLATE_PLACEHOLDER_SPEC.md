# Dispatch Template Placeholder Cleanup Spec

## Purpose

Replace raw `TODO:` and `TODO` placeholder strings in the dispatch-bundle turn-result template with schema-guided descriptive placeholders. The template is embedded in PROMPT.md (operator- and agent-facing), and raw TODOs look like development debris rather than professional schema guidance.

## Problem

`buildTurnResultTemplate()` in `cli/src/lib/dispatch-bundle.js` uses 10 `TODO` strings as placeholder values in the JSON schema template written to `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`. These strings:
1. Look unprofessional in operator-facing artifacts
2. Could leak into accepted-turn artifacts if an agent copies the template without replacing
3. Bare `TODO` (no description) in `proposed_next_role` and `machine_evidence[0].command` gives zero guidance

## Interface

Replace `TODO` placeholders with `<angle-bracket descriptive placeholders>` following JSON Schema `description` conventions:

| Field | Old | New |
|---|---|---|
| `summary` | `TODO: describe what you accomplished this turn` | `<one-line summary of what you accomplished>` |
| `decisions[0].statement` | `TODO: describe the decision` | `<what was decided and why it matters>` |
| `decisions[0].rationale` | `TODO: explain why` | `<reasoning behind this decision>` |
| `against_turn_id` (fallback) | `TODO` | `<turn_id of the turn you are reviewing>` |
| `objections[0].statement` | `TODO: challenge the previous turn (required for review_only roles)` | `<specific objection to the previous turn — required for review_only roles>` |
| `files_changed` | `TODO: list every file you modified` | `<path/to/modified/file>` |
| `verification.commands` | `TODO: list commands you ran` | `<command you ran to verify>` |
| `verification.evidence_summary` | `TODO: describe what you verified` | `<what you verified and how>` |
| `machine_evidence[0].command` | `TODO` | `<exact command that was run>` |
| `proposed_next_role` | `TODO` | `<role_id that should act next>` |

## Acceptance Tests

- AT-DPT-001: No literal `TODO` strings appear in any PROMPT.md written by `writeDispatchBundle()`
- AT-DPT-002: All placeholder values in the template use `<angle-bracket>` format
- AT-DPT-003: `accept-turn` validation rejects turn results containing literal `<angle-bracket>` placeholders in required fields (`summary`, `proposed_next_role`)
- AT-DPT-004: Existing dispatch-bundle tests still pass (no regressions)

## Open Questions

- None. This is a straightforward string replacement plus a validation guard.
