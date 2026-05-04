# Implementation Notes — M8: Persistent Run History and Governance Audit Trail

**Run:** `run_b2a4084d6b3fe3b3`
**Turn:** `turn_f38c631f9df22e69`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Delivered persistent cross-project run history and a unified governance audit trail for the agentxchain.ai managed surface. Two new aggregator methods read full-fidelity run-history.jsonl records and merge governance events from 3 JSONL sources (decision-ledger, hook-audit, events) across all registered projects. Two new hosted runner routes expose these as paginated APIs. Two new dashboard components render the data with filtering support. This is ROADMAP.md:97.

Three new files, four modified files, one test file, vitest contract bumped from 670 to 671.

## Changes

**`cli/src/lib/api/org-state-aggregator.js`** — Modified to add 2 new methods + helpers:
- `getRunHistory(query)`: reads `run-history.jsonl` from all registered projects, tags each record with `project_id`/`project_name` from registry, supports `?status` and `?project` filters, sorts by `completed_at` descending, returns `{ data, total }` for pagination
- `getAuditTrail(query)`: merges governance events from 3 JSONL sources per project — `decision-ledger.jsonl` (9 governance decision types), `hook-audit.jsonl` (block/warn verdicts only), `events.jsonl` (8 governance event types) — normalizes to unified AuditEvent shape with `classifySeverity()`, supports `?severity`/`?project`/`?source`/`?event_type` filters, returns `{ data, total }`
- Helper functions: `classifySeverity()`, `buildDecisionSummary()`, `buildEventSummary()`
- Updated return from `{ getOverview, getRuns, getDecisions }` to `{ getOverview, getRuns, getDecisions, getRunHistory, getAuditTrail }`

**`cli/src/lib/api/hosted-runner.js`** — Modified (2 new routes):
- `GET /v1/org/history` → `aggregator.getRunHistory(query)` → 200
- `GET /v1/org/audit-trail` → `aggregator.getAuditTrail(query)` → 200
- Inserted after existing `/v1/org/decisions` route; no existing routes changed

**`cli/dashboard/components/org-history.js`** — New org-level run history component:
- Renders full-fidelity run cards with run ID, project name, status badge, duration, cost, phases (joined with →), retrospective headline, gate results (✓/pending)
- Summary banner with total count and completed/blocked badges
- Follows run-history.js patterns: `esc()`, `badge()`, `statusBadge()`, `formatDuration()`, `formatCost()`

**`cli/dashboard/components/org-audit-trail.js`** — New governance audit trail component:
- Renders chronological event timeline with severity-colored left borders (red=high, yellow=medium, dim=low)
- Filter bar with 3 dropdowns: Project, Severity, Source (client-side filtering matching ledger.js patterns)
- Each event card shows severity badge, event_type badge, project name, timestamp, summary, and context (phase/role/run_id)
- Follows ledger.js/hooks.js patterns: `.filter-bar`, `.filter-control`, `esc()`, `.badge`

**`cli/dashboard/app.js`** — Modified:
- 2 new imports: `renderOrgHistory`, `renderOrgAuditTrail`
- 2 new VIEWS entries: `org-history`, `org-audit-trail`
- 2 new API_MAP entries: `orgHistory: '/v1/org/history'`, `orgAuditTrail: '/v1/org/audit-trail'`
- 1 new viewState entry for `org-audit-trail` filters
- `buildRenderData()` updated to pass filter for `org-audit-trail` view
- `change` event handler updated for audit trail filter controls

**`cli/dashboard/index.html`** — Modified (2 lines):
- 2 new nav links: "Org History" and "Audit Trail" inserted after "Org Runs"

**`cli/test/org-history-audit.test.js`** — New integration tests (8 tests):
- AT-HA-001 through AT-HA-008 covering run history attribution, full-fidelity fields, status filter, decision-ledger events, hook block/warn events, lifecycle governance events, severity filter, multi-project aggregation

**`cli/test/vitest-contract.test.js`** — Modified:
- File count bumped from 670 to 671

## Challenges to PM Spec

1. **PM spec `classifySeverity` omits `hook_block` from high severity list** — SYSTEM_SPEC §2.1.4 lists `run_blocked`, `timeout_run_level`, `policy_escalation` as high severity but omits `hook_block`. However, §2.1.3 maps `verdict === 'block'` to severity: high explicitly. Included `hook_block` in the high severity classification to match the §2.1.3 spec and the `event_type` assigned to block verdicts.

2. **PM spec test assertions use `project_name` for multi-project identification** — AT-HA-008 in SYSTEM_SPEC expects filtering by `project_name` to identify records from different projects. However, the project registry uses `basename(dir)` as project name, not the config's `project.name`. Tests use `run_id` and `event_type` to identify records from each project instead, which is more reliable.

3. **PM spec §2.1.2 `classifySeverity` omits `hook_warn` and `budget_exceeded_warn`** — SYSTEM_SPEC §2.1.4 lists medium-severity events but omits `hook_warn` and `budget_exceeded_warn`. These are clearly medium severity (attention-worthy but not blocking). Added to the medium severity classification.

## Verification

1. **New integration tests**: `npx vitest run test/org-history-audit.test.js` — 8/8 pass (AT-HA-001 through AT-HA-008)
2. **Org dashboard tests**: `npx vitest run test/org-dashboard.test.js` — 8/8 pass (no regressions)
3. **Hosted runner tests**: `npx vitest run test/hosted-runner.test.js` — 11/11 pass (no regressions)
4. **Vitest contract**: `npx vitest run test/vitest-contract.test.js` — 11/11 pass (671 files counted)
5. **Dashboard bridge tests**: `npx vitest run test/dashboard-bridge.test.js` — 87/87 pass (no regressions)
6. **Control plane schema tests**: `npx vitest run test/control-plane-schema.test.js` — 7/7 pass (no regressions)

## Architecture Invariants Maintained

1. **No writer changes**: All JSONL writers (run-history.js, governed-state.js, hook-runner.js, run-events.js) are untouched — this deliverable adds read-only aggregation only
2. **Zero new dependencies**: All modules use node:path and the existing `readJsonlFile` from state-reader.js
3. **Aggregation isolation**: A single project's JSONL read failure does not break the audit trail or history — failed projects are skipped silently (same pattern as existing `getRuns()`)
4. **Existing routes untouched**: All 24 existing hosted runner routes remain identical; new routes use distinct paths (`/v1/org/history`, `/v1/org/audit-trail`)
5. **Selective event inclusion**: Not all events.jsonl entries appear in the audit trail — only 8 governance-relevant types are included, filtering out routine lifecycle noise (turn_dispatched, etc.)
6. **Pagination support**: Both new endpoints return `{ data, total }` enabling dashboard pagination
