# Coordinator CLI Pending Gate Presentation Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one human-readable pending-gate presentation contract for coordinator CLI surfaces so they do not flatten gate state into a lossy one-line summary while dashboard surfaces already expose the fuller shared contract.

## Interface

- Shared helper: `getCoordinatorPendingGateDetails(...)`
- CLI surface:
  - `agentxchain multi status`
  - `agentxchain multi step` pending-gate refusal path

## Behavior

1. `multi status`
   - When coordinator state includes `pending_gate`, the human-readable output must render a dedicated `Pending Gate:` section.
   - That section must consume `getCoordinatorPendingGateDetails(...)` instead of formatting `gate`, `gate_type`, and `from → to` inline.
2. `multi step`
   - When coordinator state already includes `pending_gate`, the command must fail closed before dispatch.
   - The refusal path must print `Coordinator has a pending gate.` followed by the same helper-backed `Pending Gate:` section and ordered next actions.
3. Canonical pending-gate rows
   - The CLI pending-gate section must render the same canonical labels already frozen for dashboard surfaces:
     - `Type`
     - `Gate`
     - `Current Phase`
     - `Target Phase`
     - `Required Repos` when present
     - `Approval State`
     - `Human Barriers` when present
4. Scope boundary
   - This slice changes only human-readable CLI rendering for coordinator pending-gate surfaces.
   - `multi status --json` continues to expose the raw `pending_gate` object rather than a second derived formatting layer.

## Error Cases

- If `pending_gate` exists but the shared helper cannot derive details, human-readable coordinator CLI surfaces must omit the `Pending Gate:` section instead of printing a lossy fallback string.
- Missing optional fields such as `required_repos` or `human_barriers` must omit only those rows, not the whole section.

## Acceptance Tests

- `AT-CLI-MR-018`: `multi status` renders canonical pending-gate detail rows via the shared helper, including `Approval State`, instead of a single inline summary.
- `AT-CLI-MR-020`: `multi step` refusal output renders canonical pending-gate detail rows via the shared helper instead of only printing the gate name.
- `AT-DOCS-MULTI-007`: CLI docs describe the canonical pending-gate detail rows surfaced by `multi status`.
- `AT-DOCS-MULTI-008`: CLI docs describe that `multi step` fails closed on pending gates and surfaces the same canonical pending-gate detail rows before next actions.

## Open Questions

- None for this slice.
