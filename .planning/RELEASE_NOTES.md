# Release Notes — M8: Persistent Run History and Governance Audit Trail

## User Impact

This release delivers **persistent cross-project run history** and a **unified governance audit trail** to the agentxchain.ai managed surface. Operators managing multiple governed projects through the hosted runner can now view full-fidelity historical run completions and a single-pane-of-glass governance timeline — covering policy violations, hook blocks/warns, escalations, and gate transitions across all registered projects. This is ROADMAP.md:97.

### What Was Delivered

- **Full-Fidelity Run History** (`GET /v1/org/history`): Returns complete `run-history.jsonl` records with retrospective, provenance, gate_results, phases_completed, duration_ms, roles_used, connector_used — the full rich context that the simplified `/v1/org/runs` endpoint omitted. Supports status and project filters with pagination.

- **Unified Governance Audit Trail** (`GET /v1/org/audit-trail`): Merges governance events from 3 JSONL sources across all registered projects into a single chronological timeline:
  - `decision-ledger.jsonl` — 9 governance decision types (policy escalations, conflicts, timeouts, operator escalations)
  - `hook-audit.jsonl` — hook blocks (high severity) and warns (medium severity)
  - `events.jsonl` — 8 lifecycle governance events (escalations, gate transitions, run blocks, budget warnings)
  - Supports filtering by project, severity, event_type, and source with pagination

- **Severity Classification**: Events automatically classified as high (run_blocked, timeout_run_level, policy_escalation, hook_block), medium (escalation_raised, gate_failed, conflict_detected, timeouts, hook_warn, budget_exceeded_warn), or low (informational).

- **Org History Dashboard Component** (`cli/dashboard/components/org-history.js`): Full-fidelity run cards with run ID, project name, status badge, duration, cost, phases joined with arrows, retrospective headline, and gate results.

- **Audit Trail Dashboard Component** (`cli/dashboard/components/org-audit-trail.js`): Chronological event timeline with severity-colored left borders (red=high, yellow=medium, dim=low), filter bar with 3 dropdowns (project, severity, source), event cards with severity badge, event_type badge, and context.

- **8 Integration Tests** (`cli/test/org-history-audit.test.js`): Covers run history attribution (AT-HA-001), full-fidelity fields (AT-HA-002), status filtering (AT-HA-003), decision-ledger events (AT-HA-004), hook block/warn severity (AT-HA-005), lifecycle governance events (AT-HA-006), severity filtering (AT-HA-007), and multi-project aggregation (AT-HA-008).

### Architecture Highlights

- **Protocol parity invariant maintained.** Aggregator reads the same JSONL files the protocol engine writes. No new state formats or writer changes.
- **Zero new npm dependencies.** Uses existing `readJsonlFile` from state-reader.js and `node:path`.
- **Aggregation isolation.** Individual project JSONL read failures skip silently — never breaks the audit trail or history view.
- **Selective event inclusion.** Non-governance events (e.g., `turn_dispatched`) are correctly filtered out. Only governance-relevant entries appear in the audit trail.
- **Existing routes untouched.** All 26 prior hosted runner routes remain identical. Two new routes added at `/v1/org/history` and `/v1/org/audit-trail`.
- **Unified AuditEvent shape.** Common `{timestamp, event_type, severity, source, project_id, project_name, run_id, phase, role, summary, detail}` shape enables cross-source filtering and sorting.

### Files Changed

| File | Change | LOC |
|------|--------|-----|
| `cli/src/lib/api/org-state-aggregator.js` | Modified — added getRunHistory(), getAuditTrail(), helpers | ~170 |
| `cli/src/lib/api/hosted-runner.js` | Modified — 2 new org routes | ~14 |
| `cli/dashboard/components/org-history.js` | New — full-fidelity run history view | 141 |
| `cli/dashboard/components/org-audit-trail.js` | New — governance audit trail timeline | 162 |
| `cli/dashboard/app.js` | Modified — 2 views, 2 API_MAP entries, viewState, filter wiring | ~20 |
| `cli/dashboard/index.html` | Modified — 2 nav links | 2 |
| `cli/test/org-history-audit.test.js` | New — 8 integration tests | ~500 |
| `cli/test/vitest-contract.test.js` | Modified — file count 670 → 671 | 1 |

### Known Limitations

- Pre-existing `state.gates` vs `phase_gate_status` and `cost_tracker.total_cost_usd` vs `budget_status.spent_usd` field-name mismatches in `getOverview()` remain from previous run (ROADMAP.md:96). Not introduced by this run. Tracked for follow-up.

## Verification Summary

- 8/8 SYSTEM_SPEC acceptance tests pass (AT-HA-001 through AT-HA-008)
- 132 tests across 6 files, 0 failures, 0 regressions
- Vitest contract: 11/11 pass (file count = 671)
- Code reviewed for correctness, HTML escaping, spec compliance, aggregation isolation, and architecture invariants
