# V2 Dashboard Multi-Repo Integration Spec

> Extends the local read-only dashboard to render coordinator state from `.agentxchain/multirepo/`.

---

## Purpose

The local dashboard currently proves repo-local governance visibility only. That is no longer sufficient for the frozen v2 boundary. Multi-repo orchestration exists, but operators still have to inspect raw JSONL files or run `agentxchain multi status` to understand initiative state.

This spec adds coordinator visibility to the existing local dashboard without creating a second control plane.

---

## Interface

### Bridge API

The dashboard bridge MUST expose these additional read-only resources when they exist:

- `/api/coordinator/state` -> `.agentxchain/multirepo/state.json`
- `/api/coordinator/history` -> `.agentxchain/multirepo/history.jsonl`
- `/api/coordinator/barriers` -> `.agentxchain/multirepo/barriers.json`
- `/api/coordinator/barrier-ledger` -> `.agentxchain/multirepo/barrier-ledger.jsonl`
- `/api/coordinator/hooks/audit` -> `.agentxchain/multirepo/hook-audit.jsonl`
- `/api/coordinator/hooks/annotations` -> `.agentxchain/multirepo/hook-annotations.jsonl`

These endpoints are optional-by-presence. Missing files return `404`; the SPA must degrade to placeholders instead of failing.

### SPA Views

The dashboard adds two coordinator views:

- `initiative`: coordinator initiative overview
- `cross-repo`: cross-repo event timeline

Existing views remain repo-local first, but:

- `gate` MUST render coordinator pending gates when repo-local gates are absent and coordinator state contains `pending_gate`
- `blocked` MUST render coordinator blocked state when repo-local state is absent and coordinator state is blocked

### File Invalidation

The bridge watcher MUST distinguish:

- `.agentxchain/state.json`
- `.agentxchain/multirepo/state.json`

Basename-only invalidation is incorrect because both exist. Resource invalidation must key off relative path from `.agentxchain/`.

---

## Behavior

### Initiative Overview

The `initiative` view MUST render:

- `super_run_id`
- coordinator status and phase
- pending gate summary when present
- repo run table with repo id, linked run id, status, phase
- barrier snapshot with pending/partial/satisfied counts
- recent barrier transitions from `barrier-ledger.jsonl`

If no coordinator state exists, the view renders a placeholder that tells the operator to run `agentxchain multi init`.

### Cross-Repo Timeline

The `cross-repo` view MUST render coordinator history entries newest-first using human-readable event labels. At minimum it must recognize:

- `run_initialized`
- `turn_dispatched`
- `acceptance_projection`
- `context_generated`
- `phase_transition_requested`
- `phase_transition_approved`
- `run_completion_requested`
- `run_completed`
- `state_resynced`

Unknown event types must still render as generic history cards rather than disappearing.

### Gate Aggregation

Coordinator gate rendering MUST use coordinator history and barrier state, not repo-local gate heuristics. The displayed approval command is:

- `agentxchain multi approve-gate`

### Blocked State

Coordinator blocked rendering MUST show:

- blocked reason
- pending gate, if any
- repo statuses when available
- recent coordinator hook audit context when available

### Read-Only Invariant

No new mutation surface is added. The dashboard only renders state and copyable CLI commands.

---

## Error Cases

- Coordinator resources missing: render placeholders, not crashes.
- Repo-local and coordinator resources both missing: existing repo-local placeholders remain correct.
- Coordinator history contains unknown event types: render generic entries.
- `.agentxchain/multirepo/` created after dashboard startup: watcher must begin invalidating coordinator resources once the directory appears.
- Coordinator hook audit files absent: blocked/gate/initiative views still render without audit context.

---

## Acceptance Tests

- `AT-DASH-MR-001`: Bridge serves `/api/coordinator/state`, `/api/coordinator/history`, `/api/coordinator/barriers`, and `/api/coordinator/barrier-ledger` from `.agentxchain/multirepo/`.
- `AT-DASH-MR-002`: File invalidation distinguishes repo-local `state.json` from coordinator `multirepo/state.json`.
- `AT-DASH-MR-003`: Initiative view renders coordinator summary, repo runs, pending gate, and barrier status.
- `AT-DASH-MR-004`: Cross-repo timeline renders recognized coordinator events newest-first and preserves unknown event types.
- `AT-DASH-MR-005`: Gate view renders coordinator pending gate evidence with `agentxchain multi approve-gate`.
- `AT-DASH-MR-006`: Blocked view renders coordinator blocked state with recent coordinator audit context.

---

## Open Questions

- Should the hooks view gain an explicit coordinator/repo-local toggle in v2.0, or is passive coordinator support enough for now?
- Should the app auto-route to `#initiative` when no repo-local run exists but coordinator state does?
