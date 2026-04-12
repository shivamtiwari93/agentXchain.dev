# Governance Events in Report — Spec

## Purpose

Surface operational governance events (escalations, policy violations, conflicts) in the `report` command output. Currently these 6 decision-ledger entry types are persisted but invisible in reports:

- `policy_escalation` — policy rule triggered an escalation
- `conflict_detected` — file conflict detected during turn acceptance
- `conflict_rejected` — turn rejected due to conflict
- `conflict_resolution_selected` — operator chose a resolution method
- `operator_escalated` — operator explicitly escalated a run
- `escalation_resolved` — escalation was resolved

## Interface

### Extraction

New `extractGovernanceEventDigest(artifact, relPath)` function in `report.js`:

- Reads `.agentxchain/decision-ledger.jsonl` by default
- Reads `.agentxchain/multirepo/decision-ledger.jsonl` for coordinator-level report extraction
- Filters entries where `decision` is one of the 6 types above
- Returns normalized array with: `type`, `timestamp`, `turn_id`, `role`, `phase`, and type-specific fields:
  - `policy_escalation`: `violations[]` (policy_id, rule, message)
  - `conflict_detected`: `conflicting_files[]`, `overlap_ratio`
  - `conflict_rejected`: `conflicting_files[]`
  - `conflict_resolution_selected`: `resolution_method`
  - `operator_escalated`: `blocked_on`, `reason`
  - `escalation_resolved`: `resolved_via`, `previous_blocked_on`

### Report Subject

Added as `governance_events` array on the run subject, alongside existing `gate_failures`, `approval_policy_events`, etc.

Coordinator reports also expose a top-level `governance_events` array sourced from `.agentxchain/multirepo/decision-ledger.jsonl`.

### Rendering

All three report formats (text, markdown, JSON) render a "Governance Events" section when the array is non-empty. Each event shows: type, timestamp, phase, role, and type-specific detail.

## Behavior

- Empty array when no governance events exist (section omitted from output)
- Events sorted chronologically by timestamp
- Multi-repo report extracts governance events per-repo from child exports
- Coordinator reports also render coordinator-level governance events from `.agentxchain/multirepo/decision-ledger.jsonl`

## Error Cases

- Missing or empty decision-ledger.jsonl → empty array (no error)
- Malformed entries → skipped (same pattern as other extractors)

## Acceptance Tests

1. Report includes governance_events in JSON when policy_escalation exists in ledger
2. Report includes governance_events in JSON when conflict_detected exists in ledger
3. Report text output shows "Governance Events:" section header when events exist
4. Report omits section when no governance events exist
5. Events are sorted chronologically
6. Multi-repo report extracts governance events per child repo
7. Coordinator report includes coordinator-level governance events in JSON, text, and markdown

## Open Questions

None — this follows the established extraction/rendering pattern used by gate_failures, approval_policy_events, and timeout_events.
