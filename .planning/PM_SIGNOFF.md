# PM Signoff — M8: Persistent Run History and Governance Audit Trail

Approved: YES

**Run:** `run_b2a4084d6b3fe3b3`
**Phase:** planning
**Turn:** `turn_488e6de6e1646914`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running **governed projects through the hosted runner** who need cross-project visibility into historical run completions and a unified governance audit trail — policy violations, escalations, hook blocks, and gate transitions — from a single dashboard surface.

### Core Pain Point

The org dashboard (ROADMAP.md:96, run_76ce2c791a84e1cb) provides real-time cross-project visibility via `/v1/org/runs` and `/v1/org/decisions`, but has two critical gaps:

1. **Simplified run history shape:** `/v1/org/runs` reads `run-history.jsonl` but returns only `{run_id, status, phase, turns_completed, cost_usd, started_at, updated_at}`. The rich records in `run-history.jsonl` — retrospective headlines, gate_results, provenance/lineage, duration_ms, phases_completed, roles_used, connector_used — are **not exposed** through any org API endpoint.

2. **No unified governance audit trail:** Governance events are scattered across 3 separate JSONL files per project:
   - `decision-ledger.jsonl` — policy escalations, conflict decisions, operator escalations, timeouts
   - `hook-audit.jsonl` — hook verdicts (blocks, warnings, passes)
   - `events.jsonl` — lifecycle events (escalation_raised, gate_pending, gate_approved, run_blocked)
   
   There is **no cross-project unified audit trail API** and **no dashboard view** that shows these governance events in a single chronological timeline. The `agentxchain audit` command only works for the current run in the current project.

**An operator managing 5 projects cannot answer:** "What governance events happened across all projects in the last 24 hours?" or "Show me all hook blocks and escalations across the org."

## Challenge to Previous Turn

### OBJ-PM-001: Planning artifacts still describe org dashboard (run_76ce2c791a84e1cb, ROADMAP.md:96) — this run targets ROADMAP.md:97 (severity: high)

All three planning artifacts were written for ROADMAP.md:96 — "Organization dashboard with multi-project visibility":
- PM_SIGNOFF.md scoped project registry + org aggregator + 6 org routes + 2 dashboard components (9 files)
- SYSTEM_SPEC.md described project-registry.js, org-state-aggregator.js, org-overview.js, org-runs.js, org-dashboard.test.js
- ROADMAP.md phases table shows org dashboard implementation phases for `run_76ce2c791a84e1cb`

This run targets ROADMAP.md:97 — "Persistent run history and governance audit trail." All three artifacts rewritten from scratch.

### OBJ-PM-002: ROADMAP.md:96 still unchecked despite QA ship verdict YES (severity: medium)

ROADMAP.md:96 ("Organization dashboard with multi-project visibility") was completed in run_76ce2c791a84e1cb:
- QA ship verdict YES (turn_dc56f800c660b6cc): "all 8 SYSTEM_SPEC acceptance criteria independently verified, all 3 dev architectural decisions sound, 136 tests across 6 files with 0 failures"
- All 8 AT-OD acceptance criteria passed

The checkbox remains `[ ]` in ROADMAP.md. This turn checks it off based on QA-verified evidence.

### Core Workflow (this run)

1. **PM (this turn)** — Scope persistent run history + governance audit trail: full-fidelity history route, unified audit trail aggregation, 2 dashboard components, integration tests
2. **Dev** — Implement org history aggregation, audit trail aggregation, 2 org routes, 2 dashboard components, app/nav modifications, integration tests
3. **QA** — Verify cross-project history shows full records, audit trail aggregates governance events across projects, full test suite, check off ROADMAP.md:97

### MVP Scope (this run)

**This run scopes ROADMAP.md:97 — "Persistent run history and governance audit trail."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, architecture decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with file:line integration points
3. ROADMAP.md: Check off :96, update phases table for :97

**Dev deliverables:**
1. `cli/src/lib/api/org-state-aggregator.js` — **Modify** to add `getRunHistory(query)` (full-fidelity cross-project run history from run-history.jsonl) and `getAuditTrail(query)` (unified governance events from decision-ledger + hook-audit + events JSONL files across projects)
2. `cli/src/lib/api/hosted-runner.js` — **Modify** to add 2 new org routes: `GET /v1/org/history` and `GET /v1/org/audit-trail`
3. `cli/dashboard/components/org-history.js` — **New** org-level persistent run history view with full detail (retrospective, duration, phases, cost, lineage)
4. `cli/dashboard/components/org-audit-trail.js` — **New** governance audit trail timeline (decisions, hook blocks, escalations, gate transitions across projects)
5. `cli/dashboard/app.js` — **Modify** to add 2 new views + 2 API_MAP entries + viewState entries + imports
6. `cli/dashboard/index.html` — **Modify** to add 2 nav links ("Org History", "Audit Trail")
7. `cli/test/org-history-audit.test.js` — **New** 8 integration tests

### Out of Scope

- Cloud persistence (filesystem JSONL reads via state-reader.js patterns as-is)
- Full-text search or indexing over audit trail (linear scan is sufficient for MVP <20 projects)
- Audit trail mutations or annotations (read-only surface)
- Cross-project run comparison or diff analysis
- Retention policies or automated pruning of JSONL files
- Real-time audit event streaming (SSE/WebSocket — future enhancement)
- Changes to existing run-history.js, governed-state.js, hook-runner.js, run-events.js (writers are unchanged)
- Changes to existing bridge-server.js or state-reader.js
- Changes to protocol-bridge.js, run-loop.js, api-proxy-adapter.js, runner-interface.js
- Authentication/authorization for audit trail access
- Export or report generation from the audit trail view (existing `agentxchain audit` command is separate)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP | ROADMAP.md:97 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: Persistent run history and governance audit trail | GET /v1/org/history returns full-fidelity run records with retrospective/provenance from all registered projects; GET /v1/org/audit-trail returns unified governance events across projects |
| 3 | Evidence source: .planning/ROADMAP.md:97 | ROADMAP.md:97 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Large JSONL files slow aggregation | Low | Pagination via `limit`+`offset` query params; capped at 200 entries per response |
| Event type inconsistency across projects | Low | Normalize to common event schema with `event_type` + `severity` classification |
| Hook-audit entries have different structure than decision-ledger | Medium | Audit trail normalizer converts each source format to a unified `AuditEvent` shape |
| Dashboard component performance with many events | Low | Client-side pagination (same pattern as ledger.js); default page size 50 |
| New routes must not conflict with existing org routes | Low | Use distinct paths: `/v1/org/history` and `/v1/org/audit-trail` — no overlap with existing `/v1/org/overview`, `/v1/org/runs`, `/v1/org/projects`, `/v1/org/decisions` |

### Design Decision: Full-Fidelity Run History, Not Simplified (DEC-001)

The new `/v1/org/history` route returns the complete `run-history.jsonl` record shape (retrospective, gate_results, provenance, phases_completed, roles_used, duration_ms, connector_used) rather than the simplified shape from the existing `/v1/org/runs`. Rationale:
1. **Rich data already exists** — `run-history.jsonl` stores comprehensive run completion records; stripping them to 8 fields loses valuable operator context
2. **Distinct purpose** — `/v1/org/runs` shows active+recent runs for quick status; `/v1/org/history` provides the full historical archive for audit, retrospective review, and lineage tracing
3. **No performance cost** — Records are read from disk regardless; returning the full shape avoids a lossy transform

### Design Decision: Unified Audit Trail From Three Sources (DEC-002)

The governance audit trail merges events from three JSONL files per project into a single chronological timeline:
1. `decision-ledger.jsonl` → policy escalations, conflict decisions, operator escalations, timeouts
2. `hook-audit.jsonl` → hook verdicts that blocked or warned (governance-relevant hook outcomes)
3. `events.jsonl` → escalation_raised, gate_pending, gate_approved, gate_failed, run_blocked, human_escalation_raised

Rationale:
1. **Single pane of glass** — Governance visibility requires seeing all governance actions together, not switching between 3 separate views
2. **Common shape** — Each source is normalized to `{ timestamp, event_type, severity, project_id, project_name, run_id, phase, role, summary, detail }` enabling unified filtering/sorting
3. **Selective inclusion** — Not all events.jsonl entries are governance-relevant; only escalation/gate/block events are included (not routine turn_dispatched/turn_accepted lifecycle noise)

### Design Decision: Extend Existing Aggregator, Not New Module (DEC-003)

The new `getRunHistory()` and `getAuditTrail()` methods are added to the existing `org-state-aggregator.js` rather than creating a new module because:
1. **Same data access pattern** — Both methods read JSONL from registered projects via `readJsonlFile`, same as existing `getRuns()` and `getDecisions()`
2. **Same lifecycle** — Created alongside the aggregator in `createHostedRunner()`, passed to `buildRoutes()`
3. **Module cohesion** — All org-level data aggregation lives in one file (overview, runs, decisions, history, audit trail)
4. **No new imports in hosted-runner.js** — Just 2 new routes calling methods on the same aggregator instance

## Notes for Dev

**Your charter is 2 new files + 4 modifications + 1 test file (7 total).**

### 1. Org State Aggregator Modifications — `cli/src/lib/api/org-state-aggregator.js`

Add two new methods to the returned object from `createOrgAggregator(registry)`:

#### `getRunHistory(query?)`

```javascript
function getRunHistory(query) {
  const projects = registry.list();
  const records = [];

  for (const project of projects) {
    const axDir = join(project.root, '.agentxchain');
    try {
      const entries = readJsonlFile(axDir, 'run-history.jsonl') || [];
      for (const entry of entries) {
        records.push({
          ...entry,
          project_id: project.id,
          project_name: project.name,
        });
      }
    } catch { /* skip unreadable */ }
  }

  // Apply filters
  let filtered = records;
  if (query?.project) filtered = filtered.filter(r => r.project_id === query.project);
  if (query?.status) filtered = filtered.filter(r => r.status === query.status);

  // Sort by completed_at or recorded_at descending (most recent first)
  filtered.sort((a, b) => {
    const ta = a.completed_at || a.recorded_at || '';
    const tb = b.completed_at || b.recorded_at || '';
    return tb.localeCompare(ta);
  });

  const limit = parseInt(query?.limit, 10) || 50;
  const offset = parseInt(query?.offset, 10) || 0;
  return { data: filtered.slice(offset, offset + limit), total: filtered.length };
}
```

#### `getAuditTrail(query?)`

```javascript
// Governance event types from events.jsonl to include
const GOVERNANCE_EVENT_TYPES = new Set([
  'escalation_raised', 'escalation_resolved',
  'gate_pending', 'gate_approved', 'gate_failed',
  'run_blocked', 'human_escalation_raised',
  'budget_exceeded_warn',
]);

// Decision types from decision-ledger.jsonl
const GOVERNANCE_DECISION_TYPES = new Set([
  'policy_escalation', 'conflict_detected', 'conflict_rejected',
  'conflict_resolution_selected', 'operator_escalated',
  'escalation_resolved', 'timeout_turn_level',
  'timeout_phase_level', 'timeout_run_level',
]);

function classifySeverity(eventType) {
  if (['run_blocked', 'timeout_run_level', 'policy_escalation'].includes(eventType)) return 'high';
  if (['escalation_raised', 'human_escalation_raised', 'gate_failed', 'conflict_detected', 'timeout_phase_level'].includes(eventType)) return 'medium';
  return 'low';
}

function getAuditTrail(query) {
  const projects = registry.list();
  const events = [];

  for (const project of projects) {
    const axDir = join(project.root, '.agentxchain');

    try {
      // Source 1: decision-ledger.jsonl — governance decisions
      const ledger = readJsonlFile(axDir, 'decision-ledger.jsonl') || [];
      for (const entry of ledger) {
        const decisionType = entry.decision || entry.type || '';
        if (!GOVERNANCE_DECISION_TYPES.has(decisionType)) continue;
        events.push({
          timestamp: entry.timestamp || null,
          event_type: decisionType,
          severity: classifySeverity(decisionType),
          source: 'decision_ledger',
          project_id: project.id,
          project_name: project.name,
          run_id: entry.run_id || null,
          phase: entry.phase || null,
          role: entry.role || null,
          summary: buildDecisionSummary(entry),
          detail: entry,
        });
      }
    } catch { /* skip */ }

    try {
      // Source 2: hook-audit.jsonl — governance-relevant hook verdicts (block/warn only)
      const hooks = readJsonlFile(axDir, 'hook-audit.jsonl') || [];
      for (const entry of hooks) {
        if (entry.verdict !== 'block' && entry.verdict !== 'warn') continue;
        events.push({
          timestamp: entry.timestamp || null,
          event_type: `hook_${entry.verdict}`,
          severity: entry.verdict === 'block' ? 'high' : 'medium',
          source: 'hook_audit',
          project_id: project.id,
          project_name: project.name,
          run_id: null,  // hook-audit doesn't always have run_id
          phase: entry.phase || null,
          role: null,
          summary: `Hook "${entry.hook_name}" ${entry.verdict}: ${entry.message || entry.event || ''}`,
          detail: entry,
        });
      }
    } catch { /* skip */ }

    try {
      // Source 3: events.jsonl — governance lifecycle events
      const evts = readJsonlFile(axDir, 'events.jsonl') || [];
      for (const entry of evts) {
        if (!GOVERNANCE_EVENT_TYPES.has(entry.event_type)) continue;
        events.push({
          timestamp: entry.timestamp || null,
          event_type: entry.event_type,
          severity: classifySeverity(entry.event_type),
          source: 'events',
          project_id: project.id,
          project_name: project.name,
          run_id: entry.run_id || null,
          phase: entry.phase || null,
          role: entry.turn?.role_id || null,
          summary: buildEventSummary(entry),
          detail: entry,
        });
      }
    } catch { /* skip */ }
  }

  // Apply filters
  let filtered = events;
  if (query?.project) filtered = filtered.filter(e => e.project_id === query.project);
  if (query?.severity) filtered = filtered.filter(e => e.severity === query.severity);
  if (query?.event_type) filtered = filtered.filter(e => e.event_type === query.event_type);
  if (query?.source) filtered = filtered.filter(e => e.source === query.source);

  // Sort by timestamp descending
  filtered.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    return tb.localeCompare(ta);
  });

  const limit = parseInt(query?.limit, 10) || 50;
  const offset = parseInt(query?.offset, 10) || 0;
  return { data: filtered.slice(offset, offset + limit), total: filtered.length };
}
```

Helper functions:
```javascript
function buildDecisionSummary(entry) {
  const type = entry.decision || entry.type || 'unknown';
  if (type === 'policy_escalation') return `Policy violation: ${(entry.violations || []).map(v => v.message).join('; ') || 'unknown'}`;
  if (type === 'conflict_detected') return `File conflict detected: ${(entry.conflict?.conflicting_files || []).join(', ')}`;
  if (type.startsWith('timeout_')) return `Timeout (${entry.scope || type}): ${entry.elapsed_minutes || '?'}m elapsed vs ${entry.limit_minutes || '?'}m limit`;
  if (type === 'operator_escalated') return `Operator escalated: ${entry.escalation?.reason || entry.blocked_on || 'unknown'}`;
  if (type === 'escalation_resolved') return `Escalation resolved: ${entry.resolution || 'resolved'}`;
  return `${type}: ${JSON.stringify(entry).slice(0, 100)}`;
}

function buildEventSummary(entry) {
  const type = entry.event_type || 'unknown';
  const payload = entry.payload || {};
  if (type === 'escalation_raised') return `Escalation: ${payload.reason || payload.blocked_on || 'unknown'}`;
  if (type === 'gate_pending') return `Gate pending: ${payload.gate_id || 'unknown'}`;
  if (type === 'gate_approved') return `Gate approved: ${payload.gate_id || 'unknown'}`;
  if (type === 'gate_failed') return `Gate failed: ${payload.gate_id || 'unknown'} — ${(payload.reasons || []).join('; ')}`;
  if (type === 'run_blocked') return `Run blocked: ${payload.reason || payload.blocked_on || 'unknown'}`;
  if (type === 'human_escalation_raised') return `Human escalation: ${payload.reason || 'operator required'}`;
  if (type === 'budget_exceeded_warn') return `Budget warning: ${payload.message || 'approaching limit'}`;
  return type;
}
```

Updated return value:
```javascript
return { getOverview, getRuns, getDecisions, getRunHistory, getAuditTrail };
```

### 2. Hosted Runner Modifications — `cli/src/lib/api/hosted-runner.js`

Add 2 routes to `buildRoutes()` after the existing org routes (after the `/v1/org/decisions` route):

| Method | Pattern | Handler | Status |
|--------|---------|---------|--------|
| GET | `/v1/org/history` | `aggregator.getRunHistory(query)` | 200 |
| GET | `/v1/org/audit-trail` | `aggregator.getAuditTrail(query)` | 200 |

### 3. Dashboard Org History — `cli/dashboard/components/org-history.js`

```javascript
export function render(data) {
  // data = { orgHistory: { data: [...], total: N }, liveMeta }
  // Returns HTML string
  // Layout:
  //   1. Summary banner: total runs, completed/blocked counts
  //   2. Data table: Project, Run ID, Status, Phases, Turns, Cost, Duration, Retrospective, Completed
  //   3. Each row shows full-fidelity data: retrospective.headline, duration (formatted), phases_completed
  //   4. Expandable detail: gate_results, provenance, roles_used
}
```

Follow existing `run-history.js` component patterns (badges, duration formatting, cost formatting) but add cross-project context (project_name column) and full record richness.

### 4. Dashboard Org Audit Trail — `cli/dashboard/components/org-audit-trail.js`

```javascript
export function render(data) {
  // data = { orgAuditTrail: { data: [...], total: N }, liveMeta }
  // Returns HTML string
  // Layout:
  //   1. Filter bar: Project (all/specific), Severity (all/high/medium/low), Source (all/decision_ledger/hook_audit/events)
  //   2. Event timeline: chronological list of governance events
  //   3. Each event card: timestamp, severity badge, event_type badge, project name, summary text
  //   4. Expandable detail panel for full event payload
}
```

### 5. Dashboard App Updates — `cli/dashboard/app.js`

Add imports (after line 26):
```javascript
import { render as renderOrgHistory } from './components/org-history.js';
import { render as renderOrgAuditTrail } from './components/org-audit-trail.js';
```

Add to VIEWS (after `'org-runs'` entry):
```javascript
'org-history': { fetch: ['orgHistory'], render: renderOrgHistory },
'org-audit-trail': { fetch: ['orgAuditTrail'], render: renderOrgAuditTrail },
```

Add to API_MAP (after `orgRuns` entry):
```javascript
orgHistory: '/v1/org/history',
orgAuditTrail: '/v1/org/audit-trail',
```

Add to viewState:
```javascript
'org-audit-trail': { project: 'all', severity: 'all', source: 'all' },
```

### 6. Dashboard Nav — `cli/dashboard/index.html`

Add 2 nav links after the "Org Runs" link:
```html
<a href="#org-history">Org History</a>
<a href="#org-audit-trail">Audit Trail</a>
```

### 7. Integration Tests — `cli/test/org-history-audit.test.js`

| # | Test ID | Description |
|---|---------|-------------|
| T1 | AT-HA-001 | GET /v1/org/history returns run-history records with project attribution |
| T2 | AT-HA-002 | GET /v1/org/history records include retrospective and provenance fields |
| T3 | AT-HA-003 | GET /v1/org/history supports status filter |
| T4 | AT-HA-004 | GET /v1/org/audit-trail returns governance events from decision-ledger |
| T5 | AT-HA-005 | GET /v1/org/audit-trail returns hook block events from hook-audit |
| T6 | AT-HA-006 | GET /v1/org/audit-trail returns lifecycle governance events from events.jsonl |
| T7 | AT-HA-007 | GET /v1/org/audit-trail supports severity filter |
| T8 | AT-HA-008 | Multi-project: history and audit trail aggregate records from all registered projects |

## Notes for QA

- Verify org history returns full-fidelity records (not simplified getRuns shape)
- Verify audit trail merges 3 sources: decision-ledger, hook-audit, events
- Verify severity classification is correct (high: run_blocked/timeout/policy; medium: escalation/gate_failed; low: rest)
- Verify cross-project aggregation works with multiple registered projects
- Verify dashboard nav links render and views load without JS errors
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:97 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP** — ROADMAP.md:97 scoped with planning artifacts; persistent run history and governance audit trail add archival visibility to the hosted runner managed surface
2. **Unchecked roadmap item completed: Persistent run history and governance audit trail** — GET /v1/org/history returns full-fidelity run-history.jsonl records (with retrospective, provenance, gate_results, duration) from all registered projects; GET /v1/org/audit-trail returns unified governance events (decisions + hook blocks + lifecycle governance events) across all projects in chronological order
3. **Evidence source: .planning/ROADMAP.md:97** — ROADMAP.md:97 checked off after QA full suite verification

## API Map

| Route | Method | Response |
|-------|--------|----------|
| `/v1/org/history` | GET | `{ data: RunHistoryRecord[], total: number }` |
| `/v1/org/audit-trail` | GET | `{ data: AuditEvent[], total: number }` |
