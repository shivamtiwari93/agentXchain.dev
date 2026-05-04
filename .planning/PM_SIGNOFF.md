# PM Signoff — M8: Organization Dashboard with Multi-Project Visibility

Approved: YES

**Run:** `run_76ce2c791a84e1cb`
**Phase:** planning
**Turn:** `turn_fca0622af506240c`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators managing **multiple governed projects** — teams running 2+ projects through the protocol who need cross-project visibility into active runs, pending gates, decision history, and budget consumption from a single dashboard surface.

### Core Pain Point

The hosted runner (`hosted-runner.js`) and dashboard (`cli/dashboard/`) are both single-project scoped:
1. **Hosted runner** (`cli/src/lib/api/hosted-runner.js:296`) — `createHostedRunner({ root, config })` takes a single project root; all 16 routes resolve state from that one project
2. **Dashboard bridge server** (`cli/src/lib/dashboard/bridge-server.js`) — reads from a single `.agentxchain/` directory; all 32 API endpoints serve one project
3. **Dashboard UI** (`cli/dashboard/app.js:31-49`) — 17 views, all implicitly scoped to the connected project

**There is no way to see runs, gates, or decisions across projects.** An operator managing 5 governed projects must open 5 separate dashboard tabs or switch between 5 hosted runner instances. ROADMAP.md:96 closes this gap with an organization-level aggregation layer and cross-project dashboard views.

## Challenge to Previous Turn

### OBJ-PM-001: Planning artifacts describe hosted runner (run_0937d8f23ff72791, ROADMAP.md:95) — this run targets org dashboard (ROADMAP.md:96) (severity: high)

All three planning artifacts were written for the previous run's scope:
- PM_SIGNOFF.md scoped HTTP server + execution worker + job queue + serve command (5 files)
- SYSTEM_SPEC.md described hosted-runner.js, execution-worker.js, job-queue.js, serve.js, hosted-runner.test.js
- ROADMAP.md phases table showed hosted runner implementation phases for `run_0937d8f23ff72791`

This run targets ROADMAP.md:96 — "Organization dashboard with multi-project visibility." All three artifacts rewritten from scratch.

### OBJ-PM-002: ROADMAP.md:94 and :95 still unchecked despite QA ship verdicts (severity: medium)

ROADMAP.md:94 ("Design control plane API for remote run management") was completed in run_8140752664578eb2, QA verified with ship verdict YES (DEC-003: "Ship verdict YES — all 7 SYSTEM_SPEC acceptance criteria independently verified").

ROADMAP.md:95 ("Implement hosted runner that executes protocol against cloud agent APIs") was completed in run_0937d8f23ff72791, QA verified with ship verdict YES (DEC-003: "Ship verdict YES — 8/10 acceptance criteria pass, 2 acceptably deferred, 323 regression tests clean").

Both checkboxes remain `[ ]` in ROADMAP.md. This turn checks them off based on QA-verified evidence.

### Core Workflow (this run)

1. **PM (this turn)** — Scope org dashboard: project registry, state aggregation, org API routes, dashboard views
2. **Dev** — Implement project registry, org state aggregator, org routes on hosted runner, 2 new dashboard components, integration tests
3. **QA** — Verify cross-project visibility end-to-end, full test suite, check off ROADMAP.md:96

### MVP Scope (this run)

**This run scopes ROADMAP.md:96 — "Organization dashboard with multi-project visibility."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, architecture decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with file:line integration points
3. ROADMAP.md: Check off :94 and :95, update phases table for :96

**Dev deliverables:**
1. `cli/src/lib/api/project-registry.js` — File-backed project registry. Maps project IDs to root directories. Persisted in primary project's `.agentxchain/org-registry.json`. Functions: `createProjectRegistry(primaryRoot)` → `{ register, unregister, list, get, save, load }`.
2. `cli/src/lib/api/org-state-aggregator.js` — Multi-project state aggregator. Reads governed state from each registered project using `state-reader.js` patterns (readJsonFile, readJsonlFile). Returns aggregated views: org overview metrics, cross-project run list, cross-project decision ledger.
3. `cli/src/lib/api/hosted-runner.js` — **Modify** to accept optional `registry` parameter and add 6 org-scoped routes: POST/GET/DELETE `/v1/org/projects`, GET `/v1/org/overview`, GET `/v1/org/runs`, GET `/v1/org/decisions`.
4. `cli/dashboard/components/org-overview.js` — Org overview component. Metrics banner (active runs, pending gates, total decisions, budget) + project cards grid showing per-project status, phase, active run summary.
5. `cli/dashboard/components/org-runs.js` — Cross-project run list component. Data table with project name column. Filterable by project/phase/status.
6. `cli/dashboard/app.js` — **Modify** to add 2 org views (org-overview, org-runs) to VIEWS and API_MAP.
7. `cli/dashboard/index.html` — **Modify** to add "Org Overview" and "Org Runs" nav links.
8. `cli/src/commands/serve.js` — **Modify** to accept `--projects <path1,path2,...>` option for auto-registering additional projects at startup.
9. `cli/test/org-dashboard.test.js` — 8 integration tests covering registry CRUD, aggregation, and org routes.

### Out of Scope

- Cloud persistence layer (state remains filesystem-based via state-reader patterns)
- Full org/workspace/project tenancy hierarchy from AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md (MVP uses flat project registry, not org→workspace→project)
- OAuth/JWT authentication (localhost-only default unchanged)
- Real-time cross-project event streaming (SSE/WebSocket for org-level events — future enhancement)
- Dashboard mutations from org views (mutations remain per-project via existing bridge-server gate approval)
- Production deployment (Docker, systemd, cloud infrastructure)
- Webhook delivery for org-level events
- Changes to existing protocol-bridge.js, runner-interface.js, api-proxy-adapter.js, run-loop.js, or bridge-server.js
- RBAC enforcement (viewer/operator/owner roles from spec — deferred)
- Cross-project search or comparison views (from AGENTXCHAIN_AI_OPERATOR_OBSERVABILITY_SPEC.md)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP | ROADMAP.md:96 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: Organization dashboard with multi-project visibility | Org overview shows aggregated state from multiple registered projects; cross-project run list displays runs across all projects |
| 3 | Evidence source: .planning/ROADMAP.md:96 | ROADMAP.md:96 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| State aggregation slow for many projects | Low | Reads are synchronous and local-filesystem (same as bridge-server); MVP targets <20 projects; aggregator reads only state.json + history.jsonl per project |
| Registry file corruption | Low | Simple JSON file; write via atomic rename pattern; in-memory fallback if file unreadable |
| Stale state in org views | Medium | Dashboard polling interval (60s) applies to org views too; org overview shows per-project `updated_at` timestamp; future enhancement adds cross-project SSE |
| Hosted runner route conflicts | Low | Org routes use `/v1/org/` prefix — no overlap with existing `/v1/projects/` and `/v1/runs/` routes |
| Dashboard component inconsistency | Low | New components follow exact same render pattern as existing 17 components (pure function → HTML string) |

### Design Decision: Flat Project Registry, Not Full Tenancy (DEC-001)

The org dashboard uses a flat project registry (`org-registry.json`) rather than the full org→workspace→project hierarchy from AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md because:
1. **MVP simplicity** — A flat list of project roots is sufficient for cross-project visibility
2. **No cloud dependency** — Full tenancy requires persistent storage, auth, RBAC (cloud-only concerns)
3. **Upgrade path is clear** — Registry projects become workspace→project bindings when cloud tenancy ships
4. **Operator ergonomics** — `agentxchain serve --projects ./proj-a,./proj-b` is immediately useful

### Design Decision: Org Routes on Hosted Runner, Not Bridge Server (DEC-002)

Org-scoped routes are added to hosted-runner.js (port 4100) rather than bridge-server.js (port 3847) because:
1. **Hosted runner is the managed surface API** — ROADMAP.md:93 says "agentxchain.ai Managed Surface"; the hosted runner is that surface
2. **Bridge server is single-project by design** — It reads from one `.agentxchain/` directory and serves one dashboard instance
3. **Dashboard can fetch from hosted runner** — app.js already uses fetch() for data; adding hosted runner origin is a config change
4. **Future alignment** — Cloud-hosted dashboard will hit the hosted runner (now control plane API), not bridge-server

### Design Decision: State Aggregation via Existing state-reader.js (DEC-003)

The org aggregator reads multi-project state by reusing `readJsonFile` and `readJsonlFile` from `state-reader.js` rather than creating new file-reading logic because:
1. **DRY** — state-reader.js already handles JSON/JSONL parsing, error recovery, and path resolution
2. **Consistency** — Same data format the dashboard expects; no transform needed
3. **Enrichment** — For the primary project, full `readResource` enrichment (loadProjectState, reconcileStaleTurns) applies; for secondary projects, lightweight reads via readJsonFile are sufficient
4. **Testability** — Mock at the filesystem level (create `.agentxchain/state.json` in temp dirs), same as hosted-runner.test.js

## Notes for Dev

**Your charter is 4 new files + 4 modifications + 1 test file.**

### 1. Project Registry — `cli/src/lib/api/project-registry.js`

```javascript
export function createProjectRegistry(primaryRoot) {
  // Persistence: <primaryRoot>/.agentxchain/org-registry.json
  // Primary project always registered (id derived from basename + hash)
  // Returns: { register(root, name?), unregister(projectId), list(), get(projectId), save(), load() }
}
```

Registry entry shape:
```javascript
{
  id: string,           // deterministic: hash of normalized absolute path
  name: string,         // display name (defaults to directory basename)
  root: string,         // absolute path to project root
  registered_at: number // Date.now()
}
```

Constraints:
- `register()` validates that `<root>/agentxchain.json` exists (i.e., it's a governed project)
- `register()` is idempotent (re-registering same root updates name, not ID)
- `unregister()` the primary project is a no-op (primary is always registered)
- `list()` returns sorted by name
- File format: `{ version: 1, projects: [...] }`

### 2. Org State Aggregator — `cli/src/lib/api/org-state-aggregator.js`

```javascript
import { readJsonFile, readJsonlFile } from '../dashboard/state-reader.js';

export function createOrgAggregator(registry) {
  // Returns: { getOverview(), getRuns(query?), getDecisions(query?) }
}
```

**`getOverview()`** returns:
```javascript
{
  total_projects: number,
  active_runs: number,
  pending_gates: number,
  total_decisions: number,
  total_cost_usd: number,
  projects: [
    {
      id: string,
      name: string,
      root: string,
      state: {
        run_id: string | null,
        status: string | null,
        phase: string | null,
        active_turns: number,
        budget_spent_usd: number,
        updated_at: string | null,
      },
      pending_gates: string[],    // gate names pending approval
    }
  ]
}
```

**`getRuns(query?)`** returns:
```javascript
{
  data: [
    {
      project_id: string,
      project_name: string,
      run_id: string,
      status: string,
      phase: string,
      turns_completed: number,
      cost_usd: number,
      started_at: string,
      updated_at: string,
    }
  ]
}
```

**`getDecisions(query?)`** returns:
```javascript
{
  data: [
    {
      project_id: string,
      project_name: string,
      id: string,           // DEC-NNN
      phase: string,
      role: string,
      category: string,
      statement: string,
    }
  ]
}
```

Data sources per project:
- State: `readJsonFile(join(root, '.agentxchain'), 'state.json')`
- History: `readJsonlFile(join(root, '.agentxchain'), 'history.jsonl')`
- Decisions: `readJsonlFile(join(root, '.agentxchain'), 'decision-ledger.jsonl')`
- Run history: read `run-history.jsonl` if exists, else derive from state
- Gates: parsed from state.json `gates` field

### 3. Hosted Runner Modifications — `cli/src/lib/api/hosted-runner.js`

Add 6 routes to `buildRoutes()` (after line 216, before the closing `]`):

| Method | Path Pattern | Handler | HTTP Status |
|--------|-------------|---------|-------------|
| POST | `/v1/org/projects` | `registry.register(body.root, body.name)` | 201 |
| GET | `/v1/org/projects` | `registry.list()` | 200 |
| DELETE | `/v1/org/projects/:proj_id` | `registry.unregister(params.proj_id)` | 200 |
| GET | `/v1/org/overview` | `aggregator.getOverview()` | 200 |
| GET | `/v1/org/runs` | `aggregator.getRuns(query)` | 200 |
| GET | `/v1/org/decisions` | `aggregator.getDecisions(query)` | 200 |

Modify `createHostedRunner(options)` at line 296:
- Accept optional `projects` array (additional project roots)
- Create `registry = createProjectRegistry(root)` and register primary project
- Register each additional project from `options.projects`
- Create `aggregator = createOrgAggregator(registry)`
- Pass `registry` and `aggregator` to `buildRoutes()`
- Expose `registry` in returned object: `{ server, start, stop, worker, queue, registry }`

### 4. Dashboard Org Overview — `cli/dashboard/components/org-overview.js`

```javascript
export function render(data) {
  // data = { orgOverview, liveMeta }
  // Returns HTML string
  // Layout:
  //   1. Metrics banner: 4 stat cards (active runs, pending gates, decisions, cost)
  //   2. Project cards grid: one card per project showing status/phase/run summary
  //   3. Each project card shows: name, run_id, phase badge, status badge, pending gates list
}
```

Follow exact patterns from existing components:
- `esc()` for HTML escaping (same helper used in timeline.js)
- `.badge` CSS class for status/phase badges
- `.data-table` or card grid layout
- `.section` wrapper divs

### 5. Dashboard Org Runs — `cli/dashboard/components/org-runs.js`

```javascript
export function render(data) {
  // data = { orgRuns, liveMeta, filter }
  // Returns HTML string
  // Layout:
  //   1. Filter bar: project select, phase select, status select
  //   2. Data table: columns = Project, Run ID, Phase, Status, Turns, Cost, Started, Updated
}
```

### 6. Dashboard App Updates — `cli/dashboard/app.js`

Add to VIEWS (after line 31):
```javascript
'org-overview': { fetch: ['orgOverview'], render: renderOrgOverview },
'org-runs': { fetch: ['orgRuns'], render: renderOrgRuns },
```

Add to API_MAP (after line 51):
```javascript
orgOverview: '/api/org/overview',
orgRuns: '/api/org/runs',
```

Note: The `/api/org/*` endpoints are proxied from the hosted runner. The dashboard app.js must detect whether it's connected to a bridge-server or a hosted runner and use the correct base URL. Simplest approach: if `window.location.port === '4100'` (hosted runner port), use paths directly; else prefix with hosted runner origin. Alternatively, bridge-server can proxy org routes to the hosted runner — **but the simpler MVP approach is to serve the dashboard static files from the hosted runner too**, alongside the API routes. Add a static file handler to hosted-runner.js that serves `cli/dashboard/` files for non-`/v1/` and non-`/health` paths.

**Revised approach:** Add static file serving to hosted-runner.js for the dashboard HTML/JS/CSS. This means the dashboard can be accessed directly from `http://localhost:4100/` (the hosted runner), which already has the org API routes. No proxy needed.

### 7. Dashboard Nav — `cli/dashboard/index.html`

Add 2 nav links before the "Initiative" link (line 398):
```html
<a href="#org-overview">Org Overview</a>
<a href="#org-runs">Org Runs</a>
```

### 8. Serve Command — `cli/src/commands/serve.js`

Add `--projects` option:
```
agentxchain serve [--port 4100] [--host 127.0.0.1] [--project <path>] [--projects <path1,path2,...>]
```

Parse `--projects` as comma-separated paths, resolve each, pass as `projects` array to `createHostedRunner()`.

### 9. Integration Tests — `cli/test/org-dashboard.test.js`

| # | Test ID | Description |
|---|---------|-------------|
| T1 | AT-OD-001 | POST /v1/org/projects registers a project and returns 201 |
| T2 | AT-OD-002 | GET /v1/org/projects lists registered projects including primary |
| T3 | AT-OD-003 | DELETE /v1/org/projects/:id unregisters a project and returns 200 |
| T4 | AT-OD-004 | GET /v1/org/overview returns aggregated metrics with correct project count |
| T5 | AT-OD-005 | GET /v1/org/runs returns cross-project run list with project attribution |
| T6 | AT-OD-006 | GET /v1/org/decisions returns cross-project decision ledger |
| T7 | AT-OD-007 | Org overview reflects state from multiple registered projects (register 2 projects with different state.json, verify both appear in overview) |
| T8 | AT-OD-008 | Unregistered project disappears from org overview and run list |

## Notes for QA

- Verify org routes return correct data for multi-project scenarios
- Verify dashboard org views render project cards and run table
- Verify `--projects` flag auto-registers projects at startup
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:96 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP** — ROADMAP.md:96 scoped with planning artifacts; org dashboard adds multi-project visibility to the hosted runner surface
2. **Unchecked roadmap item completed: Organization dashboard with multi-project visibility** — Org overview shows aggregated metrics and project cards from multiple registered projects; cross-project run list displays runs from all projects with project attribution; project registry supports dynamic registration via API
3. **Evidence source: .planning/ROADMAP.md:96** — ROADMAP.md:96 checked off after QA full suite verification
