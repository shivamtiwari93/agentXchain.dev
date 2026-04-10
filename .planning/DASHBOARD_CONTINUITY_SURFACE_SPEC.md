# Dashboard Continuity Surface Spec

## Purpose

Make cross-session continuity visible in the dashboard Timeline view so operators can see checkpoint truth, restart guidance, and recovery-report presence without switching back to `agentxchain status`.

This closes the remaining gap from the continuity observability slice: the bridge already exposes continuity data, but the dashboard frontend still hides it.

Continuity actionability and checkpoint-drift truth are extended by `.planning/CONTINUITY_ACTIONABILITY_SPEC.md`.

## Interface

- `GET /api/continuity`
  - Returns the same computed continuity shape used by `agentxchain status --json`
  - Payload:
    - `checkpoint`
    - `stale_checkpoint`
    - `recovery_report_path`
    - `restart_recommended`
- Dashboard Timeline view
  - Renders an optional `Continuity` panel above active turns/history
  - Shows:
    - session id
    - checkpoint summary
    - last turn
    - last role
    - stale warning when checkpoint `run_id` does not match `state.json`
    - `agentxchain restart` when restart is truthful
    - `.agentxchain/SESSION_RECOVERY.md` path when present

## Behavior

- Continuity is computed from repo-local durable state, not from browser state:
  - `.agentxchain/state.json`
  - `.agentxchain/session.json`
  - `.agentxchain/SESSION_RECOVERY.md`
- The dashboard must reuse the same continuity semantics as `status`:
  - `restart_recommended` is false for `blocked`, `completed`, and `failed`
  - stale checkpoint is a warning, not a hard error
  - missing checkpoint is allowed when a recovery report exists
- `GET /api/continuity` is a read-only observation endpoint. It does not mutate state and does not invent dashboard-only fields.
- The Timeline view omits the panel entirely when continuity is `null`.

## Error Cases

- Missing `session.json` and missing `SESSION_RECOVERY.md`
  - `/api/continuity` returns `null`
  - Timeline omits the continuity panel
- Missing `state.json`
  - `/api/continuity` still returns `null` rather than failing the whole dashboard
- Stale checkpoint (`checkpoint.run_id !== state.run_id`)
  - Continuity remains visible
  - UI warns that `state.json` remains source of truth
- Recovery report exists without a checkpoint
  - Continuity still renders report presence
  - Restart recommendation still follows the governed run state when available

## Acceptance Tests

- `AT-DASH-CONT-001`: `/api/continuity` returns computed continuity metadata (`checkpoint`, `stale_checkpoint`, `recovery_report_path`, `restart_recommended`) instead of raw `session.json`.
- `AT-DASH-CONT-002`: Timeline renders checkpoint details, `agentxchain restart`, and `.agentxchain/SESSION_RECOVERY.md` when continuity exists for a restartable run.
- `AT-DASH-CONT-003`: Timeline warns on stale checkpoints but still renders continuity details.
- `AT-DASH-CONT-004`: Timeline omits restart guidance when the run state makes restart untruthful.
- `AT-DASH-CONT-005`: Dashboard docs describe the continuity panel and `/api/continuity` contract in the same turn.

## Open Questions

- None for this slice. Per-repo coordinator continuity belongs to coordinator views only if there is a concrete operator decision tied to it.
