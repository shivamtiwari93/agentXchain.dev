## Purpose

Remove repo-decision summary callsites that still special-case raw governed config now that normalized governed config preserves role `decision_authority`.

## Interface

- Files:
  - `cli/src/commands/status.js`
  - `cli/src/lib/dashboard/state-reader.js`
- Input: `loadProjectContext(...).config` for governed projects
- Output:
  - `agentxchain status` repo-decision carryover summary
  - dashboard `GET /api/repo-decisions-summary`

## Behavior

- Repo-decision summary surfaces that only need role authority metadata must consume normalized governed config directly.
- `status` and dashboard repo-decision summary must stop preferring `rawConfig` over normalized `config`.
- Authority-aware repo-decision summaries must keep the same rendered counts, categories, and highest-authority signals after the cleanup.
- This slice is cleanup only. It must not change repo-decision summary shape or wording.

## Error Cases

- If normalized config loses `decision_authority` again, these surfaces would silently degrade. That regression must be caught by tests.
- Missing repo decisions still return `null` summaries as before.
- Non-governed or invalid config handling is unchanged.

## Acceptance Tests

- `agentxchain status --json` still exposes normalized role `decision_authority` plus the same repo-decision highest-authority summary.
- Dashboard repo-decision summary still reports highest active authority when it reads governed project context from disk.
- Existing normalized-config coverage remains the contract source for preserving `decision_authority` during normalization.

## Open Questions

- None. The raw-config fallback was a temporary workaround and should not survive once normalized config is truthful.
