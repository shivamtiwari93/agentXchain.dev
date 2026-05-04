# Acceptance Matrix — M8: Persistent Run History and Governance Audit Trail

**Run:** run_b2a4084d6b3fe3b3
**Turn:** turn_2f903c5a3d12867f (QA)
**Scope:** 2 aggregator methods, 2 hosted runner routes, 2 dashboard components, dashboard app/nav updates, 8 integration tests. Vitest contract bumped 670 → 671.

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AT-HA-001 | GET /v1/org/history returns records with project attribution | QA ran test independently: HTTP 200, `data` is array, `total` is number, each entry has `project_id` and `project_name`. 8/8 pass. | PASS |
| AT-HA-002 | Records include full-fidelity fields (retrospective, provenance, gate_results, phases_completed, duration_ms) | QA verified: `run_hist_001` found with `retrospective.headline`, `provenance`, `gate_results.qa_ship_verdict === 'passed'`, `phases_completed === ['planning', 'implementation', 'qa']`, `duration_ms === 8100000`. | PASS |
| AT-HA-003 | Run history supports status filter | QA verified: `?status=completed` returns only completed entries, `?status=blocked` returns only blocked entries. Strict equality assertion on each entry. | PASS |
| AT-HA-004 | Audit trail includes decision-ledger events | QA verified: response includes `source: 'decision_ledger'` events. Found `policy_escalation` with summary containing "Policy violation". Has `project_id` and `project_name`. | PASS |
| AT-HA-005 | Audit trail includes hook block/warn events with correct severity | QA verified: `hook_block` event found with `severity: 'high'`, summary includes hook name "budget-guard". `hook_warn` event found with `severity: 'medium'`. Source is `hook_audit`. | PASS |
| AT-HA-006 | Audit trail includes lifecycle governance events from events.jsonl | QA verified: `gate_failed` event found with `source: 'events'`, summary includes "Gate failed". Non-governance event `turn_dispatched` correctly excluded. | PASS |
| AT-HA-007 | Audit trail supports severity filter | QA verified: `?severity=high` returns only high-severity events, `?severity=medium` returns only medium-severity events. Strict equality assertion on each entry. | PASS |
| AT-HA-008 | Multi-project aggregation for both endpoints | QA verified: secondary project registered via POST, history returns `total >= 3` with records from both projects (identified by `run_id`), audit trail returns `total >= 2` with events from both projects (`policy_escalation` from primary, `timeout_run_level` from secondary, different `project_id`s). | PASS |

**Summary: 8/8 PASS**

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| getRunHistory() (org-state-aggregator.js:261-292) | Reads `run-history.jsonl` from all registered projects via `readJsonlFile()`. Tags each record with `project_id`/`project_name` from registry (overrides stale JSONL values). Supports `?status` and `?project` filters. Sorts by `completed_at`/`recorded_at` descending. Pagination via `offset`+`limit` (default 50). Returns `{ data, total }`. | PASS |
| getAuditTrail() (org-state-aggregator.js:341-424) | Merges governance events from 3 JSONL sources per project: `decision-ledger.jsonl` (9 types via `GOVERNANCE_DECISION_TYPES` set), `hook-audit.jsonl` (block/warn only), `events.jsonl` (8 types via `GOVERNANCE_EVENT_TYPES` set). Normalizes to unified AuditEvent shape. Supports 4 filters: `?project`, `?severity`, `?event_type`, `?source`. Sorts by `timestamp` descending. Pagination via `offset`+`limit`. Returns `{ data, total }`. | PASS |
| classifySeverity() (org-state-aggregator.js:310-314) | High: `run_blocked`, `timeout_run_level`, `policy_escalation`, `hook_block`. Medium: `escalation_raised`, `human_escalation_raised`, `gate_failed`, `conflict_detected`, `timeout_phase_level`, `timeout_turn_level`, `hook_warn`, `budget_exceeded_warn`. Low: everything else. Matches §2.1.3 mappings with 3 justified additions (DEC-001/DEC-003). | PASS |
| buildDecisionSummary() (org-state-aggregator.js:316-325) | Handles `policy_escalation`, `conflict_detected`, `timeout_*`, `operator_escalated`, `escalation_resolved`, `conflict_*`. Falls back to type name. | PASS |
| buildEventSummary() (org-state-aggregator.js:327-339) | Handles all 8 GOVERNANCE_EVENT_TYPES with payload extraction. Falls back to event_type. | PASS |
| Source inclusion rules | `GOVERNANCE_DECISION_TYPES` (9 types, line 303-308), `GOVERNANCE_EVENT_TYPES` (8 types, line 296-301), hook-audit block/warn check (line 372). Matches SYSTEM_SPEC §2.3 exactly. | PASS |
| Hosted runner routes (hosted-runner.js:271-284) | GET `/v1/org/history` → `aggregator.getRunHistory(query)` → 200. GET `/v1/org/audit-trail` → `aggregator.getAuditTrail(query)` → 200. Inserted after `/v1/org/decisions`. No existing routes changed. | PASS |
| org-history.js (141 LOC) | Pure render function. `esc()` HTML escaping (5 entities). `statusBadge()`, `formatDuration()`, `formatCost()`, `truncateId()`. Run cards with phases joined by " → ", retrospective headline in italic, gate results with ✓/pending. Summary banner with completed/blocked badges. | PASS |
| org-audit-trail.js (162 LOC) | Pure render function. Filter bar with 3 dropdowns (project, severity, source). Severity-colored left borders (red=high, yellow=medium, dim=low). Event cards with severity badge, event_type badge, project name, timestamp, summary, context. Client-side `applyFilter()`. `esc()` HTML escaping. | PASS |
| Dashboard app.js modifications | 2 imports (renderOrgHistory, renderOrgAuditTrail). 2 VIEWS entries. 2 API_MAP entries (`orgHistory: '/v1/org/history'`, `orgAuditTrail: '/v1/org/audit-trail'`). 1 viewState entry for `org-audit-trail` filters. `buildRenderData()` passes filter for `org-audit-trail`. Change event handler wires 3 filter controls. | PASS |
| Dashboard index.html | 2 nav links ("Org History", "Audit Trail") inserted after "Org Runs" at line 400-401. | PASS |
| Aggregation isolation | Each project's 3 JSONL reads wrapped in try/catch — individual failures skip silently. Never throws. | PASS |
| Zero new dependencies | All modules use node:path and existing `readJsonlFile` from state-reader.js. No npm packages added. | PASS |
| Vitest contract | vitest-contract.test.js:56 asserts 671 files (bumped from 670). 11/11 pass. | PASS |
| Aggregator export | Returns `{ getOverview, getRuns, getDecisions, getRunHistory, getAuditTrail }` (line 427). All 5 methods available to hosted-runner.js. | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| org-history-audit.test.js | 8 | PASS |
| org-dashboard.test.js | 8 | PASS |
| hosted-runner.test.js | 11 | PASS |
| vitest-contract.test.js | 11 | PASS |
| dashboard-bridge.test.js | 87 | PASS |
| control-plane-schema.test.js | 7 | PASS |
| **Total (6 files)** | **132** | **0 failures** |

## Section D: Dev Challenge Review

### DEC-001 (hook_block added to high severity): APPROVED

PM SYSTEM_SPEC §2.1.4 lists `run_blocked`, `timeout_run_level`, `policy_escalation` as high-severity but omits `hook_block`. However, §2.1.3 explicitly maps `verdict === 'block'` to `severity: high`. The spec is internally inconsistent. Dev correctly resolved by including `hook_block` in the high-severity array (line 311). Test AT-HA-005 asserts `blockEvent.severity === 'high'`. This is the correct interpretation.

### DEC-002 (AT-HA-008 uses run_id/event_type instead of project_name): APPROVED

PM SYSTEM_SPEC's AT-HA-008 expects filtering by `project_name` to identify records from different projects. Dev uses `run_id` to locate records and `project_id` inequality to verify cross-project aggregation (lines 482-499). This is actually stronger — `run_id` is globally unique while `project_name` could collide. The test still verifies the core requirement: multi-project records appear in both endpoints with correct attribution.

### DEC-003 (hook_warn and budget_exceeded_warn added to medium severity): APPROVED

PM SYSTEM_SPEC §2.1.4 omits `hook_warn` and `budget_exceeded_warn` from the medium-severity classification. However: `hook_warn` derives from `verdict === 'warn'` (§2.1.3), and `budget_exceeded_warn` is included in `GOVERNANCE_EVENT_TYPES` (line 300) as a governance event. Both are attention-worthy but non-blocking. Without this addition, these events would fall through to `low` severity, which is incorrect — a budget warning should be medium-severity. Correct deviation.

## Section E: QA Findings

### Finding 1 (info): Dev verification evidence is accurate

Dev claimed 132 tests across 6 files (8+8+11+11+87+7). QA independently ran all 6 suites and confirmed 132 tests, 0 failures. No evidence inflation.

### Finding 2 (info): Stale field-name findings from previous run still present

The `state.gates` vs `phase_gate_status` and `cost_tracker.total_cost_usd` vs `budget_status.spent_usd` mismatches identified in run_76ce2c791a84e1cb remain in the pre-existing `getOverview()` and `readProjectState()` code. These are not introduced by this run's changes and remain out of scope. Tracked for follow-up.

### Finding 3 (info): No dead imports or unused code in new additions

QA verified: all new imports used, all new exports consumed, no orphaned helper functions. Clean implementation.
