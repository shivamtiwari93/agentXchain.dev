# Coordinator CLI Status Repo Rows Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze the `multi status` repo-row contract so operators see repo-authority state first instead of raw coordinator bookkeeping labels like `linked` and `initialized`.

## Interface

- Shared helper: `cli/src/lib/coordinator-repo-status-presentation.js`
- Coordinator CLI surface:
  - `agentxchain multi status`

## Behavior

1. Authority-first repo rows
   - `multi status` must prefer repo-local authority for each repo row when coordinator config is readable.
   - Text rows must render the repo-local run status, phase, and run ID when available.
2. Coordinator provenance stays visible
   - Coordinator linkage provenance is still shown, but as metadata, not as the primary repo status.
   - `linked` / `initialized` may appear only as a `coordinator: ...` detail in the row payload, not as the row status itself.
3. Run-identity drift stays explicit
   - If the repo-local run ID differs from the coordinator's expected run ID, the row must show the actual repo-local run ID and the coordinator's expected run ID.
4. Degraded fallback
   - If repo authority cannot be read, `multi status` may fall back to coordinator state.
   - In that fallback, `linked` / `initialized` must still normalize to `active` for the displayed repo status.

## Error Cases

- Missing or unreadable coordinator config must not break `multi status`; repo rows may fall back to coordinator state.
- Missing repo-local state must not suppress the row entirely.
- Repo rows must not print raw coordinator status as the primary status when repo authority is available.

## Acceptance Tests

- `AT-CLI-MR-033`: `multi status` shows repo-authority `active` status while preserving coordinator provenance as metadata.
- `AT-CLI-MR-034`: `multi status` shows actual repo-local run IDs and coordinator expected run IDs when run identity drifts.
- `AT-CLI-MR-035`: `multi status` imports the shared repo-row presentation helper instead of formatting raw `info.status` inline.
- `AT-DOCS-MULTI-013`: CLI docs explain that `multi status` repo rows are authority-first and relegate coordinator linkage to metadata.

## Open Questions

- None for this slice. If dashboard repo rows need the same repair, they should adopt the same helper-backed contract rather than re-deriving row wording.
