# Coordinator CLI Step Blocker Output Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze the `multi step` no-assignment gate-readiness contract so the command stops carrying a second private blocker renderer while neighboring coordinator surfaces already use the shared blocker presentation helper.

## Interface

- Shared helpers:
  - `getCoordinatorBlockerDetails(...)`
- CLI surface:
  - `agentxchain multi step`

## Behavior

1. Pending-gate fail-closed remains unchanged
   - If the coordinator already has a `pending_gate`, `multi step` must stop before assignment and print the canonical `Pending Gate:` detail rows plus ordered next actions.
2. No-assignable workstream with gate blockers
   - If no workstream is assignable and the follow-on coordinator gate is not ready, `multi step` must print:
     - the `No assignable workstream: ...` reason line
     - any available detail line from assignment selection
     - `Coordinator phase gate is not ready:` or `Coordinator completion gate is not ready:`
     - one message row per blocker
   - Typed `repo_run_id_mismatch` blockers, if they reach this path, must render canonical `Repo`, `Expected`, and `Actual` detail rows via the shared blocker presentation helper rather than private lowercase `expected:` / `actual:` labels.
3. Scope note
   - `multi step` performs divergence detection before gate evaluation, so executable CLI proof for this slice focuses on the no-assignable gate-blocker path and a source-level guard for typed mismatch formatting. That boundary is intentional, not a missing test.

## Error Cases

- Blockers without a typed detail mapping must still print their message row and must not invent fake detail labels.
- If no gate blockers exist, the command must not print a gate-blocker heading.

## Acceptance Tests

- `AT-CLI-MR-031`: `multi step` with no assignable workstream and an unready gate prints the gate-blocker heading plus blocker messages.
- `AT-CLI-MR-032`: `multi step` no-assignment gate-blocker output does not fall back to private lowercase run-id detail labels.
- `AT-DOCS-MULTI-012`: CLI docs explain the no-assignable gate-blocker output and the typed mismatch detail-label contract.

## Open Questions

- None for this slice.
