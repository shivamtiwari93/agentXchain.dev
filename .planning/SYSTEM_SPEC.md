# System Spec — M8: Persistent Run History and Governance Audit Trail

**Run:** `run_b2a4084d6b3fe3b3`
**Baseline:** git:a5f2ea547 (latest checkpoint)
**Package version:** `agentxchain@2.155.73`

## Purpose

Add persistent cross-project run history and a unified governance audit trail to the agentxchain.ai managed surface. Operators see full-fidelity run completion records (retrospective, provenance, gate results, lineage) aggregated across all registered projects, plus a chronological governance event timeline merging decisions, hook blocks, and lifecycle governance events from multiple sources.

This is ROADMAP.md:97 — the fourth M8 deliverable. It composes existing layers:
1. Org state aggregator (`cli/src/lib/api/org-state-aggregator.js:107`) — `createOrgAggregator(registry)` with `getOverview()`, `getRuns()`, `getDecisions()`
2. Hosted runner (`cli/src/lib/api/hosted-runner.js:386`) — `createHostedRunner(options)` with 22 routes + static file serving
3. State reader (`cli/src/lib/dashboard/state-reader.js:113-125`) — `readJsonFile()` and `readJsonlFile()` for JSONL reads
4. Run history persistence (`cli/src/lib/run-history.js:33`) — `recordRunHistory()` writes full-fidelity records to `run-history.jsonl`
5. Dashboard UI (`cli/dashboard/app.js:33-53`) — VIEWS and API_MAP with org views already present

---

## 1. Architecture Overview

### 1.1 Existing Infrastructure (Referenced)

| Layer | File | Key Exports Used |
|-------|------|-----------------|
| Org aggregator | `cli/src/lib/api/org-state-aggregator.js` | `createOrgAggregator(registry)` at :107, returned `{ getOverview, getRuns, getDecisions }` at :259 |
| Hosted runner | `cli/src/lib/api/hosted-runner.js` | `createHostedRunner(options)` at :386, `buildRoutes()` at :66, existing org routes at :219-271 |
| State reader | `cli/src/lib/dashboard/state-reader.js` | `readJsonFile(dir, filename)` at :113, `readJsonlFile(dir, filename)` at :125 |
| Run history writer | `cli/src/lib/run-history.js` | `recordRunHistory(root, state, config, status)` at :33 — writes full records to `run-history.jsonl` |
| Dashboard app | `cli/dashboard/app.js` | VIEWS at :33, API_MAP at :55, imports at :1-26 |
| Dashboard HTML | `cli/dashboard/index.html` | Org nav links at :398-399 |
| Project registry | `cli/src/lib/api/project-registry.js` | `createProjectRegistry(primaryRoot)` — registry.list() used by aggregator |

### 1.2 Data Sources Per Project

| File | Format | Writer | Content |
|------|--------|--------|---------|
| `.agentxchain/run-history.jsonl` | JSONL | `run-history.js:recordRunHistory()` | Complete run completion records (schema_version 0.1) |
| `.agentxchain/decision-ledger.jsonl` | JSONL | `governed-state.js` | Policy escalations, conflicts, timeouts, operator escalations |
| `.agentxchain/hook-audit.jsonl` | JSONL | `hook-runner.js:309` | Hook execution records with verdicts (allow/warn/block) |
| `.agentxchain/events.jsonl` | JSONL | `run-events.js` | 58 lifecycle event types including governance events |

---

## 2. Deliverables

### 2.1 Org State Aggregator — Add `getRunHistory()` and `getAuditTrail()`

**Modify existing file:** `cli/src/lib/api/org-state-aggregator.js`

#### 2.1.1 `getRunHistory(query?)`

Add after `getDecisions()` (after line 257). Reads `run-history.jsonl` from all registered projects and returns the **full** record shape (not the simplified shape used by `getRuns()`).

**Parameters:**
- `query.project` — filter by project ID
- `query.status` — filter by run status (`completed` | `blocked`)
- `query.limit` — max results (default 50)
- `query.offset` — pagination offset (default 0)

**Response:**
```javascript
{
  data: [
    {
      // Full run-history.jsonl record shape (schema_version 0.1):
      schema_version: '0.1',
      run_id: string,
      project_id: string,      // from registry entry
      project_name: string,    // from registry entry
      template: string | null,
      status: 'completed' | 'blocked',
      started_at: string | null,
      completed_at: string | null,
      duration_ms: number | null,
      phases_completed: string[],
      total_turns: number,
      roles_used: string[],
      decisions_count: number,
      total_cost_usd: number | null,
      budget_limit_usd: number | null,
      blocked_reason: string | null,
      gate_results: { [gate_id]: 'passed' | 'pending' },
      connector_used: string | null,
      model_used: string | null,
      provenance: { trigger, parent_run_id, ... } | null,
      retrospective: {
        headline: string,
        terminal_reason: string,
        next_operator_action: string | null,
        follow_on_hint: string | null,
      } | null,
      recorded_at: string,
    }
  ],
  total: number,    // total matching records before pagination
}
```

**Implementation constraints:**
1. Each record is spread with `project_id` and `project_name` from the registry entry (overriding any stale values in the JSONL record itself)
2. Sort by `completed_at` or `recorded_at` descending (most recent first)
3. Pagination: apply `offset` then `limit` (not limit-then-offset)
4. If a project's `run-history.jsonl` is unreadable, skip silently (same isolation pattern as `getRuns()`)
5. `total` field enables the dashboard to show pagination controls

#### 2.1.2 `getAuditTrail(query?)`

Add after `getRunHistory()`. Merges governance events from 3 JSONL sources across all registered projects into a unified chronological timeline.

**Parameters:**
- `query.project` — filter by project ID
- `query.severity` — filter by severity (`high` | `medium` | `low`)
- `query.event_type` — filter by event type
- `query.source` — filter by source (`decision_ledger` | `hook_audit` | `events`)
- `query.limit` — max results (default 50)
- `query.offset` — pagination offset (default 0)

**Response — unified `AuditEvent` shape:**
```javascript
{
  data: [
    {
      timestamp: string | null,       // ISO 8601
      event_type: string,             // e.g. 'policy_escalation', 'hook_block', 'gate_failed'
      severity: 'high' | 'medium' | 'low',
      source: 'decision_ledger' | 'hook_audit' | 'events',
      project_id: string,
      project_name: string,
      run_id: string | null,
      phase: string | null,
      role: string | null,
      summary: string,                // human-readable one-line summary
      detail: object,                 // full original entry for drill-down
    }
  ],
  total: number,
}
```

#### 2.1.3 Source Inclusion Rules

**From `decision-ledger.jsonl`** — include entries where `decision` (or `type`) is one of:
- `policy_escalation`
- `conflict_detected`
- `conflict_rejected`
- `conflict_resolution_selected`
- `operator_escalated`
- `escalation_resolved`
- `timeout_turn_level`
- `timeout_phase_level`
- `timeout_run_level`

**From `hook-audit.jsonl`** — include entries where `verdict` is `block` or `warn`:
- `verdict === 'block'` → `event_type: 'hook_block'`, severity: high
- `verdict === 'warn'` → `event_type: 'hook_warn'`, severity: medium

**From `events.jsonl`** — include entries where `event_type` is one of:
- `escalation_raised`
- `escalation_resolved`
- `gate_pending`
- `gate_approved`
- `gate_failed`
- `run_blocked`
- `human_escalation_raised`
- `budget_exceeded_warn`

#### 2.1.4 Severity Classification

```javascript
function classifySeverity(eventType) {
  // High: events that block run progress
  if (['run_blocked', 'timeout_run_level', 'policy_escalation', 'hook_block'].includes(eventType)) return 'high';
  // Medium: events that require attention but don't necessarily block
  if (['escalation_raised', 'human_escalation_raised', 'gate_failed', 'conflict_detected', 'timeout_phase_level', 'timeout_turn_level', 'hook_warn', 'budget_exceeded_warn'].includes(eventType)) return 'medium';
  // Low: informational governance events
  return 'low';
}
```

#### 2.1.5 Summary Builders

```javascript
// For decision-ledger entries:
function buildDecisionSummary(entry) {
  const type = entry.decision || entry.type || 'unknown';
  if (type === 'policy_escalation') return `Policy violation: ${(entry.violations || []).map(v => v.message).join('; ') || 'unknown'}`;
  if (type === 'conflict_detected') return `File conflict: ${(entry.conflict?.conflicting_files || []).join(', ')}`;
  if (type.startsWith('timeout_')) return `Timeout (${entry.scope || type}): ${entry.elapsed_minutes || '?'}m / ${entry.limit_minutes || '?'}m limit`;
  if (type === 'operator_escalated') return `Operator escalated: ${entry.escalation?.reason || entry.blocked_on || 'unknown'}`;
  if (type === 'escalation_resolved') return `Escalation resolved`;
  if (type.startsWith('conflict_')) return `Conflict ${type.replace('conflict_', '')}: ${(entry.conflict?.conflicting_files || []).join(', ')}`;
  return type;
}

// For hook-audit entries:
// summary = `Hook "${entry.hook_name}" ${entry.verdict}: ${entry.message || entry.event || ''}`

// For events.jsonl entries:
function buildEventSummary(entry) {
  const type = entry.event_type;
  const p = entry.payload || {};
  if (type === 'escalation_raised') return `Escalation: ${p.reason || p.blocked_on || 'unknown'}`;
  if (type === 'gate_pending') return `Gate pending: ${p.gate_id || 'unknown'}`;
  if (type === 'gate_approved') return `Gate approved: ${p.gate_id || 'unknown'}`;
  if (type === 'gate_failed') return `Gate failed: ${p.gate_id || 'unknown'}`;
  if (type === 'run_blocked') return `Run blocked: ${p.reason || p.blocked_on || 'unknown'}`;
  if (type === 'human_escalation_raised') return `Human escalation: ${p.reason || 'operator required'}`;
  if (type === 'budget_exceeded_warn') return `Budget warning: ${p.message || 'approaching limit'}`;
  if (type === 'escalation_resolved') return `Escalation resolved`;
  return type;
}
```

#### 2.1.6 Updated Module Export

Line 259 changes from:
```javascript
return { getOverview, getRuns, getDecisions };
```
to:
```javascript
return { getOverview, getRuns, getDecisions, getRunHistory, getAuditTrail };
```

---

### 2.2 Hosted Runner — Add 2 Org Routes

**Modify existing file:** `cli/src/lib/api/hosted-runner.js`

Insert 2 routes into `buildRoutes()` after the existing `/v1/org/decisions` route (after line 269, before the closing `]` at line 271):

| Method | Pattern | Handler | HTTP Status |
|--------|---------|---------|-------------|
| GET | `/v1/org/history` | `aggregator.getRunHistory(query)` | 200 |
| GET | `/v1/org/audit-trail` | `aggregator.getAuditTrail(query)` | 200 |

Route implementation:
```javascript
{
  method: 'GET',
  pattern: '/v1/org/history',
  handler: (_params, _body, query) => {
    return { status: 200, body: aggregator.getRunHistory(query) };
  },
},
{
  method: 'GET',
  pattern: '/v1/org/audit-trail',
  handler: (_params, _body, query) => {
    return { status: 200, body: aggregator.getAuditTrail(query) };
  },
},
```

No changes to `createHostedRunner()` — the aggregator already exists and is already passed to `buildRoutes()`. The new methods are simply available on the same `aggregator` instance.

---

### 2.3 Dashboard Org History Component — `cli/dashboard/components/org-history.js`

**New file.** Renders persistent cross-project run history with full-fidelity data.

#### 2.3.1 Module API

```javascript
/**
 * @param {{ orgHistory: { data: object[], total: number }, liveMeta: object }} data
 * @returns {string} HTML string
 */
export function render(data)
```

#### 2.3.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Org Run History                                       Total: 47 runs   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ run_abc123 • project-alpha • completed • 2h 15m • $4.20        │    │
│  │ Phases: planning → implementation → qa                         │    │
│  │ "Delivered cursor connector with 14 tests"                     │    │
│  │ Gates: planning_signoff ✓  implementation_complete ✓  qa ✓     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ run_def456 • project-beta • blocked • 45m • $2.10              │    │
│  │ Phases: planning → implementation                              │    │
│  │ "Blocked: budget exceeded during implementation"               │    │
│  │ Gates: planning_signoff ✓  implementation_complete pending     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  [← Prev]  Page 1 of 3  [Next →]                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 2.3.3 Record Card Content

Each run history record card displays:
- **Header row:** Run ID (truncated, monospace), project name, status badge, duration (formatted), cost (USD)
- **Phases row:** `phases_completed` joined with " → " arrows
- **Retrospective row:** `retrospective.headline` in italic (if present)
- **Gates row:** `gate_results` entries with ✓ for passed, pending for pending
- **Metadata (collapsed):** roles_used, connector_used, provenance.trigger, provenance.parent_run_id

#### 2.3.4 Patterns

Follow exact patterns from existing `run-history.js` component:
- `esc()` for HTML escaping
- `badge()` and `statusBadge()` helpers
- `formatDuration()` and `formatCost()` from run-history.js
- `.section` wrapper div
- `.data-table` or card layout

---

### 2.4 Dashboard Org Audit Trail Component — `cli/dashboard/components/org-audit-trail.js`

**New file.** Renders unified governance audit trail as a filterable chronological event list.

#### 2.4.1 Module API

```javascript
/**
 * @param {{ orgAuditTrail: { data: object[], total: number }, liveMeta: object }} data
 * @returns {string} HTML string
 */
export function render(data)
```

#### 2.4.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Governance Audit Trail                                 47 events       │
├─────────────────────────────────────────────────────────────────────────┤
│  Filter: [Project ▼] [Severity ▼] [Source ▼]                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ● HIGH  policy_escalation  project-alpha  May 4, 10:15 AM             │
│    Policy violation: turn exceeds budget reservation                    │
│    Phase: implementation  Role: dev  Run: run_abc123                    │
│  ─────────────────────────────────────────────────────────────────────  │
│  ● MED   hook_block        project-beta   May 4, 09:45 AM              │
│    Hook "budget-guard" block: cost exceeds threshold                    │
│    Phase: qa                                                            │
│  ─────────────────────────────────────────────────────────────────────  │
│  ● MED   gate_failed       project-alpha  May 4, 09:30 AM              │
│    Gate failed: qa_ship_verdict — ship verdict not affirmative          │
│    Phase: qa  Role: qa  Run: run_abc123                                 │
│  ─────────────────────────────────────────────────────────────────────  │
│  ● LOW   gate_approved     project-gamma  May 4, 09:00 AM              │
│    Gate approved: planning_signoff                                      │
│    Phase: planning  Run: run_ghi789                                     │
│                                                                         │
│  [← Prev]  Page 1 of 3  [Next →]                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 2.4.3 Severity Badges

- `HIGH` → red badge (border-color: var(--red))
- `MED` → yellow badge (border-color: var(--yellow))
- `LOW` → dim badge (border-color: var(--text-dim))

#### 2.4.4 Filter Bar

3 dropdown selects (same pattern as `ledger.js` filter bar):
- **Project:** `all` + one option per registered project
- **Severity:** `all`, `high`, `medium`, `low`
- **Source:** `all`, `decision_ledger`, `hook_audit`, `events`

Filters pass as query parameters to the API: `/v1/org/audit-trail?severity=high&project=abc123`

#### 2.4.5 Patterns

Follow exact patterns from existing `ledger.js` and `hooks.js` components:
- `esc()` for HTML escaping
- `.filter-bar` and `.filter-control` CSS classes for filter dropdowns
- `.section` wrapper div
- Severity-colored left border on event entries
- `.badge` class for severity and event_type badges

---

### 2.5 Dashboard App Modifications — `cli/dashboard/app.js`

**Modify existing file.**

#### 2.5.1 New Imports (after line 26)

```javascript
import { render as renderOrgHistory } from './components/org-history.js';
import { render as renderOrgAuditTrail } from './components/org-audit-trail.js';
```

#### 2.5.2 New VIEWS Entries (after `'org-runs'` at line 35)

```javascript
'org-history': { fetch: ['orgHistory'], render: renderOrgHistory },
'org-audit-trail': { fetch: ['orgAuditTrail'], render: renderOrgAuditTrail },
```

#### 2.5.3 New API_MAP Entries (after `orgRuns` at line 85)

```javascript
orgHistory: '/v1/org/history',
orgAuditTrail: '/v1/org/audit-trail',
```

#### 2.5.4 New viewState Entry (after `'org-runs'` at line 89)

```javascript
'org-audit-trail': { project: 'all', severity: 'all', source: 'all' },
```

---

### 2.6 Dashboard Nav Modifications — `cli/dashboard/index.html`

**Modify existing file.**

Insert 2 nav links after the "Org Runs" link at line 399:

```html
<a href="#org-history">Org History</a>
<a href="#org-audit-trail">Audit Trail</a>
```

---

### 2.7 Integration Tests — `cli/test/org-history-audit.test.js`

**New file.** Tests for run history aggregation, audit trail aggregation, and the 2 new routes.

| # | Test ID | Description | Assertion |
|---|---------|-------------|-----------|
| T1 | AT-HA-001 | GET /v1/org/history returns records with project attribution | Response 200, each entry has `project_id` and `project_name` fields |
| T2 | AT-HA-002 | Run history records include full-fidelity fields | At least one entry has `retrospective`, `provenance`, `gate_results`, `phases_completed`, `duration_ms` fields |
| T3 | AT-HA-003 | Run history supports status filter | GET with `?status=completed` returns only completed entries |
| T4 | AT-HA-004 | GET /v1/org/audit-trail returns governance events from decision-ledger | Write a decision-ledger entry with `decision: 'policy_escalation'`; audit trail includes it with `source: 'decision_ledger'` |
| T5 | AT-HA-005 | Audit trail returns hook block events | Write a hook-audit entry with `verdict: 'block'`; audit trail includes it with `event_type: 'hook_block'`, `severity: 'high'` |
| T6 | AT-HA-006 | Audit trail returns lifecycle governance events | Write an events.jsonl entry with `event_type: 'gate_failed'`; audit trail includes it with `source: 'events'` |
| T7 | AT-HA-007 | Audit trail supports severity filter | GET with `?severity=high` returns only high-severity events |
| T8 | AT-HA-008 | Multi-project aggregation for both endpoints | Register 2 temp projects with different run-history + decision-ledger; verify /v1/org/history `total >= 2` and /v1/org/audit-trail `total >= 2` with entries from both projects |

#### 2.7.1 Test Setup Pattern

Follow `org-dashboard.test.js` patterns:
- Create temp directories with `mkdtempSync`
- Write minimal `agentxchain.json` in each temp dir
- Write `.agentxchain/run-history.jsonl` with sample records
- Write `.agentxchain/decision-ledger.jsonl` with governance entries
- Write `.agentxchain/hook-audit.jsonl` with block verdict entries
- Write `.agentxchain/events.jsonl` with governance event entries
- Start hosted runner on random port
- Make HTTP requests via `node:http`
- Cleanup temp dirs in `afterAll`

---

## 3. Integration Points

### 3.1 State Reader — `state-reader.js:113-125`

Both new aggregator methods use the same `readJsonlFile(dir, filename)` function already imported at line 11 of org-state-aggregator.js. No new imports needed.

### 3.2 Hosted Runner — `hosted-runner.js:219-271`

The 2 new routes are added to the same route array in `buildRoutes()`. They follow the identical pattern as existing org routes: `{ method, pattern, handler }` objects calling aggregator methods.

### 3.3 Dashboard App — `app.js:33-96`

New views and API_MAP entries follow the exact same pattern as existing org entries (`orgOverview`, `orgRuns`). The `fetchData()` function uses `fetch()` with relative paths — since the dashboard is served from the hosted runner, `/v1/org/history` and `/v1/org/audit-trail` resolve correctly.

### 3.4 Run History Record Shape — `run-history.js:74-128`

The `getRunHistory()` aggregator returns records in the same shape that `recordRunHistory()` writes. The dev should reference the record construction at run-history.js:74 to understand available fields.

---

## 4. Files Changed (Expected)

| File | Change Type | LOC | Description |
|------|-------------|-----|-------------|
| `cli/src/lib/api/org-state-aggregator.js` | **Modify** | ~150 | Add `getRunHistory()`, `getAuditTrail()`, helpers, update export |
| `cli/src/lib/api/hosted-runner.js` | **Modify** | ~15 | Add 2 org routes after `/v1/org/decisions` |
| `cli/dashboard/components/org-history.js` | **Create** | ~200 | Full-fidelity cross-project run history view |
| `cli/dashboard/components/org-audit-trail.js` | **Create** | ~250 | Governance audit trail timeline with filters |
| `cli/dashboard/app.js` | **Modify** | ~10 | Add 2 views, 2 API_MAP entries, viewState, imports |
| `cli/dashboard/index.html` | **Modify** | ~2 | Add 2 nav links |
| `cli/test/org-history-audit.test.js` | **Create** | ~350 | 8 integration tests |

3 new files, 4 modified files. Vitest contract file count increases from 670 to 671.

---

## 5. Key Architecture Invariants

1. **No writer changes.** The JSONL writers (`run-history.js`, `governed-state.js`, `hook-runner.js`, `run-events.js`) are untouched. This deliverable adds read-only aggregation only.
2. **Zero new dependencies.** All modules use `node:path` and the existing `readJsonlFile` from state-reader.js.
3. **Aggregation isolation.** A single project's read failure does not break the audit trail or history — failed projects are skipped silently (same pattern as existing `getRuns()`).
4. **Existing routes untouched.** All 22 existing hosted runner routes remain identical. New routes use distinct paths (`/v1/org/history`, `/v1/org/audit-trail`).
5. **Selective event inclusion.** Not all events.jsonl entries appear in the audit trail — only governance-relevant types are included, filtering out routine lifecycle noise.
6. **Pagination support.** Both new endpoints return `{ data, total }` enabling dashboard pagination without loading all records at once.

---

## Interface

### Audit Trail Data Flow

```
Browser (http://localhost:4100/#org-audit-trail)
    │
    ├─ GET /v1/org/audit-trail?severity=high&limit=50
    │
    ▼
┌──────────────────────────────────────────────────┐
│  Hosted Runner (hosted-runner.js)                 │
│  Route: /v1/org/audit-trail                       │
│  Handler: aggregator.getAuditTrail(query)         │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  Org State Aggregator (org-state-aggregator.js)   │
│  getAuditTrail(query):                            │
│    1. registry.list() → [proj_A, proj_B, ...]     │
│    2. For each project:                           │
│       a. readJsonlFile(axDir, 'decision-ledger.jsonl')  → governance decisions  │
│       b. readJsonlFile(axDir, 'hook-audit.jsonl')       → block/warn verdicts   │
│       c. readJsonlFile(axDir, 'events.jsonl')           → governance events     │
│    3. Normalize each entry → AuditEvent shape     │
│    4. Filter by query params                      │
│    5. Sort by timestamp desc                      │
│    6. Paginate: slice(offset, offset+limit)       │
│    7. Return { data: AuditEvent[], total: N }     │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼ (for each registered project)
┌──────────────────────────────────────────────────┐
│  .agentxchain/decision-ledger.jsonl              │
│  .agentxchain/hook-audit.jsonl                   │
│  .agentxchain/events.jsonl                       │
└──────────────────────────────────────────────────┘
```

### Run History Data Flow

```
Browser (http://localhost:4100/#org-history)
    │
    ├─ GET /v1/org/history?limit=50&offset=0
    │
    ▼
┌──────────────────────────────────────────────────┐
│  Hosted Runner → aggregator.getRunHistory(query)  │
│    1. registry.list() → [proj_A, proj_B, ...]     │
│    2. For each project:                           │
│       readJsonlFile(axDir, 'run-history.jsonl')   │
│    3. Tag each record with project_id/name        │
│    4. Filter, sort by completed_at desc           │
│    5. Return { data: FullRecord[], total: N }     │
└──────────────────────────────────────────────────┘
```

---

## Dev Charter

### Scope

**3 new files + 4 modifications: aggregator methods + 2 routes + 2 dashboard components + app/nav mods + tests.**

1. `cli/src/lib/api/org-state-aggregator.js` — Add `getRunHistory(query)` + `getAuditTrail(query)` + helper functions + update return object
2. `cli/src/lib/api/hosted-runner.js` — Add 2 routes: `GET /v1/org/history`, `GET /v1/org/audit-trail`
3. `cli/dashboard/components/org-history.js` — Full-fidelity cross-project run history view
4. `cli/dashboard/components/org-audit-trail.js` — Governance audit trail timeline with severity/source filters
5. `cli/dashboard/app.js` — Add 2 views + 2 API_MAP entries + viewState + imports
6. `cli/dashboard/index.html` — Add 2 nav links after "Org Runs"
7. `cli/test/org-history-audit.test.js` — 8 integration tests

### Out of Scope

- Changes to any JSONL writer (run-history.js, governed-state.js, hook-runner.js, run-events.js)
- Changes to state-reader.js, bridge-server.js, protocol-bridge.js
- Full-text search or indexing
- Retention policies or pruning
- Real-time event streaming
- Authentication/authorization
- Export or report generation from audit trail

### Verification

Dev must confirm:
1. GET /v1/org/history returns full-fidelity records (retrospective, provenance, gate_results, duration_ms present)
2. GET /v1/org/history?status=completed returns only completed entries
3. GET /v1/org/audit-trail returns events from all 3 sources (decision_ledger, hook_audit, events)
4. GET /v1/org/audit-trail?severity=high returns only high-severity events
5. Both endpoints include project_id and project_name attribution
6. Both endpoints return `{ data, total }` for pagination
7. Dashboard org-history view renders run cards with retrospective headlines
8. Dashboard org-audit-trail view renders event timeline with severity badges
9. All 8 integration tests pass
10. Vitest contract passes with 671 files
11. No existing tests broken

## Acceptance Tests

- [ ] AT-HA-001: Run history returns records with project attribution
- [ ] AT-HA-002: Records include full-fidelity fields (retrospective, provenance, gate_results)
- [ ] AT-HA-003: Run history supports status filter
- [ ] AT-HA-004: Audit trail includes decision-ledger governance events
- [ ] AT-HA-005: Audit trail includes hook block/warn events with correct severity
- [ ] AT-HA-006: Audit trail includes lifecycle governance events from events.jsonl
- [ ] AT-HA-007: Audit trail supports severity filter
- [ ] AT-HA-008: Multi-project aggregation works for both endpoints
