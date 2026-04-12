# Coordinator Dashboard Decision Ledger Spec

## Purpose

Make the dashboard `Decisions` view truthful in coordinator workspaces. Today the bridge already exposes `.agentxchain/multirepo/decision-ledger.jsonl` at `GET /api/coordinator/ledger`, but the SPA never fetches or renders it. In a coordinator-only workspace, clicking `Decisions` incorrectly shows "No decisions recorded yet" even when coordinator decisions exist.

## Interface

No new command and no new top-level dashboard tab.

Existing surfaces are enriched:

- `GET /api/coordinator/ledger`
  - Existing file-backed endpoint remains the coordinator JSONL read surface.
- Dashboard `Decisions` view
  - Fetches repo-local and coordinator ledgers.
  - Renders repo-local decisions, coordinator decisions, or both, depending on workspace state.

## Behavior

- Repo-local governed workspace:
  - `Decisions` behaves exactly as before and renders the repo-local ledger.
- Coordinator-only workspace:
  - `Decisions` renders the coordinator ledger instead of the false empty placeholder.
  - Section title is `Coordinator Decision Ledger`.
- Workspace with both repo-local and coordinator ledgers present:
  - `Decisions` renders both sections in one view.
  - Shared filters apply to both sections so the operator can narrow by role, phase, date, or query once.
- Filter controls derive their options from the combined visible ledgers so coordinator-only workspaces still get truthful role/phase filters.

## Error Cases

- No repo-local ledger and no coordinator ledger:
  - Keep the existing empty placeholder.
- Coordinator state exists but coordinator ledger file is absent:
  - Render `Coordinator Decision Ledger` with an empty-state message, not the generic repo-local message.
- One ledger is malformed:
  - Existing bridge/file-read behavior remains authoritative; this slice does not add recovery logic.

## Acceptance Tests

1. `GET /api/coordinator/ledger` returns the multirepo `decision-ledger.jsonl` array.
2. `Decisions` renders coordinator decision entries in a coordinator workspace.
3. Coordinator-only rendering does not show the false generic "No decisions recorded yet" placeholder when coordinator decisions exist.
4. When both repo-local and coordinator ledgers are present, the view renders separate repo and coordinator sections.
5. Public dashboard docs describe that `Decisions` can render coordinator decisions and mention `GET /api/coordinator/ledger`.

## Open Questions

None. This is a bounded dashboard-truth fix using an existing endpoint and existing ledger data.
