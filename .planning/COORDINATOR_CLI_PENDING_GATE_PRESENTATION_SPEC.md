# Coordinator CLI Pending Gate Presentation Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one human-readable pending-gate presentation contract for `agentxchain multi status` so the coordinator CLI does not flatten gate state into a lossy one-line summary while dashboard surfaces already expose the fuller shared contract.

## Interface

- Shared helper: `getCoordinatorPendingGateDetails(...)`
- CLI surface:
  - `agentxchain multi status`

## Behavior

1. `multi status`
   - When coordinator state includes `pending_gate`, the human-readable output must render a dedicated `Pending Gate:` section.
   - That section must consume `getCoordinatorPendingGateDetails(...)` instead of formatting `gate`, `gate_type`, and `from → to` inline.
2. Canonical pending-gate rows
   - The CLI pending-gate section must render the same canonical labels already frozen for dashboard surfaces:
     - `Type`
     - `Gate`
     - `Current Phase`
     - `Target Phase`
     - `Required Repos` when present
     - `Approval State`
     - `Human Barriers` when present
3. Scope boundary
   - This slice changes only the human-readable `multi status` rendering.
   - `multi status --json` continues to expose the raw `pending_gate` object rather than a second derived formatting layer.

## Error Cases

- If `pending_gate` exists but the shared helper cannot derive details, `multi status` must omit the `Pending Gate:` section instead of printing a lossy fallback string.
- Missing optional fields such as `required_repos` or `human_barriers` must omit only those rows, not the whole section.

## Acceptance Tests

- `AT-CLI-MR-018`: `multi status` renders canonical pending-gate detail rows via the shared helper, including `Approval State`, instead of a single inline summary.
- `AT-DOCS-MULTI-007`: CLI docs describe the canonical pending-gate detail rows surfaced by `multi status`.

## Open Questions

- None for this slice.
