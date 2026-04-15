## Purpose

Preserve role `decision_authority` in normalized governed config so authority-aware governance surfaces do not lose meaning when they read `loadProjectContext().config`.

## Interface

- File: `cli/src/lib/normalized-config.js`
- Input: governed v4 config roles with optional integer `decision_authority`
- Output: normalized `config.roles[roleId]` entries that keep `decision_authority` when present

## Behavior

- `normalizeV4(raw)` must copy `role.decision_authority` into the normalized role object when the source role defines it.
- Roles without `decision_authority` must stay unchanged; do not inject `null` or fake defaults.
- The preserved field is additive. Existing normalized role keys (`title`, `mandate`, `write_authority`, `runtime_class`, `runtime_id`) remain unchanged.
- Repo-decision summarization must be able to consume normalized governed config without losing `authority_level` or operator-summary highest-authority signals.

## Error Cases

- Invalid `decision_authority` values remain rejected by existing validation. This slice does not loosen validation.
- Legacy v3 normalization does not gain new authority semantics in this slice.
- No surface may invent authority when the source config omitted it.

## Acceptance Tests

- `normalizeV4()` preserves explicit `decision_authority` on normalized governed roles.
- `summarizeRepoDecisions(decisions, normalizeV4(raw))` still emits per-decision `authority_level` and operator-summary highest-authority values.
- Roles without explicit `decision_authority` remain absent from the normalized role object.

## Open Questions

- None for this slice. Once normalized config truthfully preserves authority metadata, repo-decision surfaces can stop treating raw-config fallback as a special workaround.
