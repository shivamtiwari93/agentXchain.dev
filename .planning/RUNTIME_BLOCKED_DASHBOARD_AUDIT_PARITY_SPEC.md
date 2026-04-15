# Runtime Blocked Dashboard And Audit Parity Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

`status` and `report` already expose runtime-aware blocked guidance and ordered operator next actions. The live dashboard blocked view and `audit` contract were still weaker:

- the dashboard only showed generic blocked metadata plus one recovery command
- the audit reference page did not freeze parity on the derived blocked-run fields
- no regression test proved that live dashboard state API responses carry the same derived runtime guidance truth

That gap is not cosmetic. A blocked-state truth surface is only credible when every live operator surface exposes the same diagnosis and next action ordering.

## Interface

### Dashboard state API

`GET /api/state` remains the live governed state endpoint, but when a valid governed config is available it now adds:

```json
{
  "runtime_guidance": [
    {
      "code": "proposal_apply_required",
      "phase": "implementation",
      "gate_id": "implementation_complete",
      "role_id": "dev",
      "artifact_path": ".planning/IMPLEMENTATION_NOTES.md",
      "command": "agentxchain proposal apply turn_dev_001",
      "reason": "Artifact ... stages required files behind proposal apply."
    }
  ],
  "next_actions": [
    {
      "command": "agentxchain proposal apply turn_dev_001",
      "reason": "Artifact ... stages required files behind proposal apply."
    },
    {
      "command": "agentxchain step --resume",
      "reason": "After resolving the proposal_apply_required blocker, continue the run."
    }
  ]
}
```

These are additive fields. Existing dashboard consumers remain valid.

### Dashboard blocked view

The Blocked view must render:

- `Runtime Guidance` when `runtime_guidance[]` is present
- `Next Actions` when `next_actions[]` is present
- existing `Recovery` and audit context sections unchanged

### Audit contract

`agentxchain audit --format json` already reuses the governance report contract. This slice freezes that parity explicitly:

- governed-run audit JSON must expose `subject.run.next_actions`
- blocked governed-run audit JSON must expose `subject.run.recovery_summary.runtime_guidance`

## Behavior

### 1. Derivation source of truth

The dashboard bridge must derive `runtime_guidance` and `next_actions` from the same helpers used by `status` and `report`:

- `deriveRuntimeBlockedGuidance(state, config)`
- `deriveGovernedRunNextActions(state, config)`

The browser must not guess runtime guidance from raw `state.json`.

### 2. Config boundary

Only enrich `/api/state` when a valid governed config is available. If the config cannot be normalized, the bridge must return the raw state instead of inventing a partial runtime diagnosis.

### 3. Audit parity

No audit-only logic fork is allowed. `audit` must continue using the same report builder as `report`; tests and docs freeze that operator contract instead of duplicating logic.

## Error Cases

- Missing config: `/api/state` returns the raw state object without added `runtime_guidance` or `next_actions`.
- Non-governed repo: `/api/state` remains unchanged.
- Empty guidance: dashboard blocked view does not render empty Runtime Guidance or Next Actions sections.
- Replay/export mode: additive fields may appear if the replayed snapshot includes a valid governed config; this is valid because the same live derivation contract applies.

## Acceptance Tests

- `AT-RBDAP-001`: `GET /api/state` derives `runtime_guidance[]` and `next_actions[]` for a blocked governed run with a provable runtime/config blocker.
- `AT-RBDAP-002`: dashboard Blocked view renders Runtime Guidance and Next Actions when those fields are present.
- `AT-RBDAP-003`: `agentxchain audit --format json` exposes `subject.run.next_actions` and `subject.run.recovery_summary.runtime_guidance` for a blocked governed run with runtime guidance.
- `AT-RBDAP-004`: dashboard and audit docs describe the parity truthfully.

## Open Questions

- Coordinator-specific blocked next-action parity remains a separate slice. This spec only covers governed-run runtime guidance parity.
