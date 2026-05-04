# System Spec — M8: Organization Dashboard with Multi-Project Visibility

**Run:** `run_76ce2c791a84e1cb`
**Baseline:** git:9043afb73 (latest checkpoint)
**Package version:** `agentxchain@2.155.73`

## Purpose

Add organization-level multi-project visibility to the agentxchain.ai managed surface. An operator registers multiple governed projects with the hosted runner, and the dashboard displays aggregated cross-project metrics, a unified run list, and a cross-project decision ledger — all from a single URL.

This is ROADMAP.md:96 — the third M8 deliverable. It composes three existing layers:
1. Hosted runner (`cli/src/lib/api/hosted-runner.js:296`) — HTTP server with 16 control plane API routes
2. State reader (`cli/src/lib/dashboard/state-reader.js:113-166`) — JSON/JSONL file readers for `.agentxchain/` state
3. Dashboard UI (`cli/dashboard/app.js:31-49`) — 17 component views with fetch/render pattern

---

## 1. Architecture Overview

### 1.1 Existing Infrastructure (Referenced)

| Layer | File | Key Exports Used |
|-------|------|-----------------|
| Hosted runner | `cli/src/lib/api/hosted-runner.js` | `createHostedRunner(options)`, `buildRoutes()`, `matchRoute()`, `mapErrorToResponse()` |
| State reader | `cli/src/lib/dashboard/state-reader.js` | `readJsonFile(dir, filename)` at :113, `readJsonlFile(dir, filename)` at :125 |
| Dashboard app | `cli/dashboard/app.js` | `VIEWS` at :31, `API_MAP` at :51, `fetchData()`, `loadView()` |
| Dashboard HTML | `cli/dashboard/index.html` | Nav links at :397-414, CSS theme variables at :8-18 |
| Serve command | `cli/src/commands/serve.js` | `serveCommand(opts)` at :15 |
| CLI entry | `cli/bin/agentxchain.js` | `serve` command registration at :808-814 |
| Config | `cli/src/lib/config.js` | `findProjectRoot()`, `loadProjectContext()` |

### 1.2 Frozen Architecture Specs (Referenced)

| Spec | Key Rules Applied |
|------|------------------|
| `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md` | Cross-project rollups are `.ai` advantages; protocol parity invariant; cloud-only metadata is presentation-tier only |
| `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md` | Org/workspace/project hierarchy (deferred to full tenancy — MVP uses flat registry) |
| `AGENTXCHAIN_AI_OPERATOR_OBSERVABILITY_SPEC.md` | Turn aggregation response shape, observation_summary pattern |
| `AGENTXCHAIN_AI_DASHBOARD_READ_MODEL_SPEC.md` | Server-projected actionability contract (org views are read-only for MVP) |

---

## 2. Deliverables

### 2.1 Project Registry Module — `cli/src/lib/api/project-registry.js`

**New file.** File-backed registry mapping project IDs to root directories.

#### 2.1.1 Module API

```javascript
/**
 * Create a project registry persisted in the primary project's .agentxchain/ directory.
 * @param {string} primaryRoot - primary project root (always registered)
 * @returns {ProjectRegistry}
 */
export function createProjectRegistry(primaryRoot)
```

Returns:
```javascript
{
  register(root, name?): RegistryEntry,  // register a project; validates agentxchain.json exists
  unregister(projectId): boolean,        // remove project; no-op for primary
  list(): RegistryEntry[],               // all registered projects, sorted by name
  get(projectId): RegistryEntry | null,  // lookup by ID
  save(): void,                          // persist to disk
  load(): void,                          // load from disk
}
```

#### 2.1.2 Registry Entry Shape

```javascript
{
  id: string,           // deterministic: first 12 chars of SHA-256 of normalized absolute path
  name: string,         // display name (defaults to directory basename)
  root: string,         // absolute normalized path to project root
  is_primary: boolean,  // true for the primary project
  registered_at: number // Date.now() at registration
}
```

#### 2.1.3 Persistence Format

File: `<primaryRoot>/.agentxchain/org-registry.json`

```json
{
  "version": 1,
  "projects": [
    { "id": "a1b2c3d4e5f6", "name": "my-project", "root": "/path/to/project", "is_primary": true, "registered_at": 1714819200000 }
  ]
}
```

#### 2.1.4 Constraints

1. **Validation:** `register()` checks `existsSync(join(root, 'agentxchain.json'))` — rejects non-governed directories
2. **Idempotent registration:** Re-registering the same root path updates `name` only; `id` and `registered_at` are preserved
3. **Primary immutability:** `unregister()` silently skips entries where `is_primary === true`
4. **Auto-save:** `register()` and `unregister()` call `save()` automatically
5. **Graceful load:** If registry file does not exist or is corrupt, start with primary-only registry
6. **ID stability:** ID is derived from the normalized absolute path, so it is stable across restarts

---

### 2.2 Org State Aggregator Module — `cli/src/lib/api/org-state-aggregator.js`

**New file.** Reads governed state from each registered project and returns aggregated views.

#### 2.2.1 Module API

```javascript
import { readJsonFile, readJsonlFile } from '../dashboard/state-reader.js';
import { join } from 'node:path';

/**
 * Create an org state aggregator.
 * @param {ProjectRegistry} registry - project registry instance
 * @returns {{ getOverview(), getRuns(query?), getDecisions(query?) }}
 */
export function createOrgAggregator(registry)
```

#### 2.2.2 `getOverview()` Response Shape

```javascript
{
  total_projects: number,
  active_runs: number,         // count of projects with state.status === 'active'
  pending_gates: number,       // count of gates with status === 'pending' across all projects
  total_decisions: number,     // sum of decision ledger entries across all projects
  total_cost_usd: number,      // sum of cost_tracker.total_cost_usd across all projects
  projects: [
    {
      id: string,              // registry project ID
      name: string,            // registry project name
      root: string,            // project root path
      state: {
        run_id: string | null,
        status: string | null,   // 'active' | 'blocked' | 'completed' | null
        phase: string | null,    // 'planning' | 'implementation' | 'qa' | null
        active_turns: number,    // count of entries in state.active_turns
        budget_spent_usd: number,
        updated_at: string | null,
      },
      pending_gates: string[],  // names of gates with status 'pending'
      decision_count: number,
    }
  ]
}
```

#### 2.2.3 Data Sources per Project

For each project in `registry.list()`:

| Data | Source File | Reader Function |
|------|------------|-----------------|
| Run state | `<root>/.agentxchain/state.json` | `readJsonFile(axDir, 'state.json')` |
| Gate status | Parsed from `state.gates` | — |
| Decision ledger | `<root>/.agentxchain/decision-ledger.jsonl` | `readJsonlFile(axDir, 'decision-ledger.jsonl')` |
| Run history | `<root>/.agentxchain/run-history.jsonl` | `readJsonlFile(axDir, 'run-history.jsonl')` |
| History | `<root>/.agentxchain/history.jsonl` | `readJsonlFile(axDir, 'history.jsonl')` |
| Cost | Parsed from `state.cost_tracker` | — |

Where `axDir = join(project.root, '.agentxchain')`.

#### 2.2.4 `getRuns(query?)` Response Shape

```javascript
{
  data: [
    {
      project_id: string,
      project_name: string,
      run_id: string,
      status: string,
      phase: string,
      turns_completed: number,      // from history.jsonl length
      cost_usd: number,             // from state.cost_tracker.total_cost_usd
      started_at: string | null,    // from state.created_at or run-history entry
      updated_at: string | null,    // from state.updated_at
    }
  ]
}
```

Query parameters:
- `project`: filter by project ID
- `phase`: filter by phase
- `status`: filter by status
- `limit`: max results (default 50)

Data source: For each project, read `state.json` for the active run and `run-history.jsonl` for historical runs. Merge, sort by `updated_at` descending.

#### 2.2.5 `getDecisions(query?)` Response Shape

```javascript
{
  data: [
    {
      project_id: string,
      project_name: string,
      id: string,             // DEC-NNN from the entry
      phase: string,
      role: string,
      runtime_id: string,
      category: string,
      statement: string,
      rationale: string,
    }
  ]
}
```

Query parameters:
- `project`: filter by project ID
- `phase`: filter by phase
- `role`: filter by role
- `limit`: max results (default 100)

Data source: For each project, read `decision-ledger.jsonl`, tag each entry with `project_id` and `project_name`. Merge, sort by timestamp/index descending.

#### 2.2.6 Error Handling

- If a registered project's `.agentxchain/` directory is missing or state.json unreadable, the project appears in the overview with `state: { run_id: null, status: null, ... }` and a flag `"error": "state_unreadable"`
- Aggregation never throws — individual project read failures are isolated

---

### 2.3 Hosted Runner Modifications — `cli/src/lib/api/hosted-runner.js`

**Modify existing file.** Add org routes and static file serving.

#### 2.3.1 New Parameters for `createHostedRunner()`

At line 296, extend the options destructuring:

```javascript
const {
  root,
  config,
  port = 4100,
  host = '127.0.0.1',
  projects = [],       // NEW: additional project root paths
} = options;
```

After queue/worker creation (line 304-305), add:

```javascript
import { createProjectRegistry } from './project-registry.js';
import { createOrgAggregator } from './org-state-aggregator.js';

const registry = createProjectRegistry(root);
for (const projRoot of projects) {
  try { registry.register(projRoot); } catch { /* skip invalid */ }
}
const aggregator = createOrgAggregator(registry);
```

Pass `registry` and `aggregator` to `buildRoutes()`.

#### 2.3.2 New Routes (6 routes)

Add to `buildRoutes()` after the existing 16 routes (after line 215):

| Method | Pattern | Handler | Status |
|--------|---------|---------|--------|
| POST | `/v1/org/projects` | Validate body.root, call `registry.register(body.root, body.name)`, return entry | 201 |
| GET | `/v1/org/projects` | Return `{ data: registry.list() }` | 200 |
| DELETE | `/v1/org/projects/:proj_id` | Call `registry.unregister(params.proj_id)`, return `{ ok: true }` | 200 |
| GET | `/v1/org/overview` | Return `{ data: aggregator.getOverview() }` | 200 |
| GET | `/v1/org/runs` | Return `aggregator.getRuns(query)` | 200 |
| GET | `/v1/org/decisions` | Return `aggregator.getDecisions(query)` | 200 |

Error handling for POST `/v1/org/projects`:
- Missing `body.root` → 422 `{ error: { code: 'validation_error', message: 'root is required' } }`
- Non-governed directory → 422 `{ error: { code: 'validation_error', message: 'no agentxchain.json found at <root>' } }`

#### 2.3.3 Static File Serving for Dashboard

Add a fallback in the request handler (after line 326, the no-route-match block) — before sending 404, check if the request path maps to a file in `cli/dashboard/`:

```javascript
if (method === 'GET' && !pathname.startsWith('/v1/') && pathname !== '/health') {
  const dashFile = resolveDashboardFile(pathname);
  if (dashFile) {
    // Serve static file with correct MIME type
    return;
  }
}
```

MIME types: `.html` → `text/html`, `.js` → `application/javascript`, `.css` → `text/css`, `.json` → `application/json`. Default: `application/octet-stream`.

Root path `/` serves `index.html`.

Dashboard directory: resolved relative to the module's location via `join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dashboard')`.

#### 2.3.4 Updated Return Value

```javascript
return { server, start, stop, worker, queue, registry };
```

---

### 2.4 Dashboard Org Overview Component — `cli/dashboard/components/org-overview.js`

**New file.** Renders organization overview with metrics and project cards.

#### 2.4.1 Module API

```javascript
/**
 * @param {{ orgOverview: object, liveMeta: object }} data
 * @returns {string} HTML string
 */
export function render(data)
```

#### 2.4.2 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Org Overview                                                │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Projects │ Active   │ Pending  │ Total    │ Total Cost      │
│    5     │ Runs: 3  │ Gates: 1 │ Dec: 234 │ $12.45          │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ project-alpha        │  │ project-beta         │          │
│  │ Phase: qa           │  │ Phase: implementation│           │
│  │ Status: active      │  │ Status: active       │          │
│  │ Run: run_abc123     │  │ Run: run_def456      │          │
│  │ Turns: 7            │  │ Turns: 3             │          │
│  │ Gates: [pending]    │  │ Gates: []            │          │
│  │ Cost: $4.20         │  │ Cost: $3.15          │          │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                              │
│  ┌─────────────────────┐                                     │
│  │ project-gamma        │                                    │
│  │ No active run       │                                     │
│  │ Last run: completed │                                     │
│  └─────────────────────┘                                     │
└─────────────────────────────────────────────────────────────┘
```

#### 2.4.3 CSS

Reuse existing CSS classes: `.section`, `.data-table`, `.badge`, `.turn-card` (for project cards). New CSS for the metrics banner:

```css
.org-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.org-metric-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  text-align: center;
}
.org-metric-value { font-size: 24px; font-weight: 700; color: var(--text); }
.org-metric-label { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
.org-projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
```

Inject this CSS inline at the top of the render output (same pattern as timeline.js which returns `<style>` + content).

#### 2.4.4 HTML Escaping

Define local `esc()` function matching the pattern from timeline.js:

```javascript
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

---

### 2.5 Dashboard Org Runs Component — `cli/dashboard/components/org-runs.js`

**New file.** Renders cross-project run list as a filterable data table.

#### 2.5.1 Module API

```javascript
/**
 * @param {{ orgRuns: object, liveMeta: object, filter?: object }} data
 * @returns {string} HTML string
 */
export function render(data)
```

#### 2.5.2 Layout

Filter bar with 3 dropdowns: Project (all / specific), Phase (all / planning / implementation / qa), Status (all / active / blocked / completed).

Data table columns:
| Column | Source |
|--------|--------|
| Project | `project_name` |
| Run ID | `run_id` (truncated, monospace) |
| Phase | `phase` (badge) |
| Status | `status` (badge) |
| Turns | `turns_completed` |
| Cost | `cost_usd` (formatted as USD) |
| Started | `started_at` (relative time) |
| Updated | `updated_at` (relative time) |

#### 2.5.3 Filtering

Client-side filtering (same pattern as ledger.js filter bar). Use `viewState['org-runs']` in app.js:

```javascript
viewState['org-runs'] = { project: 'all', phase: 'all', status: 'all' };
```

---

### 2.6 Dashboard App Modifications — `cli/dashboard/app.js`

**Modify existing file.**

#### 2.6.1 New Imports (after line 25)

```javascript
import { render as renderOrgOverview } from './components/org-overview.js';
import { render as renderOrgRuns } from './components/org-runs.js';
```

#### 2.6.2 New VIEWS Entries (insert at top of VIEWS object, after line 31)

```javascript
'org-overview': { fetch: ['orgOverview'], render: renderOrgOverview },
'org-runs': { fetch: ['orgRuns'], render: renderOrgRuns },
```

#### 2.6.3 New API_MAP Entries (after line 51)

```javascript
orgOverview: '/v1/org/overview',
orgRuns: '/v1/org/runs',
```

Note: These paths use `/v1/` prefix (hosted runner routes) rather than `/api/` prefix (bridge-server routes). When the dashboard is served from the hosted runner (port 4100), these paths resolve correctly relative to the same origin.

#### 2.6.4 New viewState Entry

Add to the viewState object:
```javascript
'org-runs': { project: 'all', phase: 'all', status: 'all' },
```

---

### 2.7 Dashboard Nav Modifications — `cli/dashboard/index.html`

**Modify existing file.**

Insert 2 nav links before the "Initiative" link at line 398:

```html
<a href="#org-overview">Org Overview</a>
<a href="#org-runs">Org Runs</a>
```

---

### 2.8 Serve Command Modifications — `cli/src/commands/serve.js`

**Modify existing file.**

#### 2.8.1 New Option

Add `--projects` option to accept comma-separated additional project paths.

After line 37, parse the projects option:
```javascript
const additionalProjects = (opts.projects || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean)
  .map(p => resolve(p));
```

Pass to createHostedRunner:
```javascript
const runner = createHostedRunner({
  root,
  config: ctx.config,
  port,
  host,
  projects: additionalProjects,
});
```

#### 2.8.2 CLI Registration Update — `cli/bin/agentxchain.js`

At line 813, add the new option:
```javascript
.option('--projects <paths>', 'Additional project roots (comma-separated)')
```

---

### 2.9 Integration Tests — `cli/test/org-dashboard.test.js`

**New file.** Tests for project registry, org aggregator, and org routes.

| # | Test ID | Description | Assertion |
|---|---------|-------------|-----------|
| T1 | AT-OD-001 | Register project via POST /v1/org/projects | POST with `{ root: <tempDir> }` returns 201 with entry containing id, name, root |
| T2 | AT-OD-002 | List projects via GET /v1/org/projects | Returns 200 with array containing at least the primary project |
| T3 | AT-OD-003 | Unregister project via DELETE /v1/org/projects/:id | Returns 200, subsequent GET /v1/org/projects excludes the removed project |
| T4 | AT-OD-004 | Org overview returns correct metrics | GET /v1/org/overview returns 200 with `total_projects >= 1`, projects array has entries |
| T5 | AT-OD-005 | Cross-project runs include project attribution | GET /v1/org/runs returns 200, each entry has `project_id` and `project_name` fields |
| T6 | AT-OD-006 | Cross-project decisions include project attribution | GET /v1/org/decisions returns 200, each entry has `project_id` and `project_name` fields |
| T7 | AT-OD-007 | Multi-project aggregation | Register 2 temp projects with different state.json; GET /v1/org/overview shows `total_projects >= 3` (primary + 2); both projects appear in projects array |
| T8 | AT-OD-008 | Unregistered project excluded from aggregation | Register temp project, verify in overview, unregister, verify absent from overview |

#### 2.9.1 Test Setup Pattern

Follow `hosted-runner.test.js` patterns:
- Create temp directories with `mkdtempSync`
- Write minimal `agentxchain.json` and `.agentxchain/state.json` in each temp dir
- Start hosted runner on random available port (use port 0 for auto-assign or a high-range port)
- Make HTTP requests via `node:http` request helpers
- Cleanup temp dirs in `afterAll`

---

## 3. Integration Points

### 3.1 State Reader — `state-reader.js:113-166`

The org aggregator imports `readJsonFile` and `readJsonlFile`:

```javascript
import { readJsonFile, readJsonlFile } from '../dashboard/state-reader.js';
```

These are simple, synchronous file readers:
- `readJsonFile(agentxchainDir, filename)` → parsed JSON or null
- `readJsonlFile(agentxchainDir, filename)` → array of parsed objects

No enrichment (loadProjectState, reconcileStaleTurns) is applied for secondary projects — only the primary project gets full enrichment via the existing hosted runner routes. This is intentional: org views need fast reads, not full state repair.

### 3.2 Hosted Runner — `hosted-runner.js:71-216`

The 6 new org routes are added to the same `buildRoutes()` function, extending the route array. They follow the identical pattern: `{ method, pattern, handler }` objects.

### 3.3 Hosted Runner Server — `hosted-runner.js:308-356`

The static file serving fallback is added to the `createServer()` request handler, before the 404 response. It checks if the path is not a known API prefix (`/v1/`, `/health`) and tries to resolve to a dashboard file.

### 3.4 Dashboard App — `app.js:31-79`

New views and API_MAP entries follow the exact same pattern as existing entries. The `fetchData()` function at app.js uses `fetch()` with relative paths — since the dashboard is now served from the hosted runner, `/v1/org/overview` resolves correctly.

### 3.5 Dashboard Components Pattern

All 17 existing components export a `render(data)` function that returns an HTML string. New components follow the same pattern:
- No JSX, no virtual DOM — pure string concatenation
- `esc()` helper for HTML escaping (defined locally in each component)
- CSS classes from index.html: `.section`, `.badge`, `.data-table`, `.turn-card`, `.filter-bar`, `.filter-control`
- Return value is injected into `#view-container` via `innerHTML`

---

## 4. Files Changed (Expected)

| File | Change Type | LOC | Description |
|------|-------------|-----|-------------|
| `cli/src/lib/api/project-registry.js` | **Create** | ~150 | File-backed project registry with register/unregister/list/get |
| `cli/src/lib/api/org-state-aggregator.js` | **Create** | ~250 | Multi-project state aggregation: overview, runs, decisions |
| `cli/dashboard/components/org-overview.js` | **Create** | ~250 | Org overview: metrics banner + project cards grid |
| `cli/dashboard/components/org-runs.js` | **Create** | ~200 | Cross-project run list: filterable data table |
| `cli/test/org-dashboard.test.js` | **Create** | ~400 | 8 integration tests for registry, aggregator, org routes |
| `cli/src/lib/api/hosted-runner.js` | **Modify** | ~100 | Add 6 org routes, registry/aggregator init, static file serving |
| `cli/src/commands/serve.js` | **Modify** | ~10 | Accept --projects option, pass to createHostedRunner |
| `cli/bin/agentxchain.js` | **Modify** | ~1 | Add --projects option to serve command registration |
| `cli/dashboard/app.js` | **Modify** | ~15 | Add 2 views, 2 API_MAP entries, viewState, imports |
| `cli/dashboard/index.html` | **Modify** | ~2 | Add 2 nav links |

5 new files, 5 modified files. Vitest contract file count increases from 669 to 670.

---

## 5. Key Architecture Invariants

1. **Protocol parity (from frozen spec).** Org views read the same state.json, history.jsonl, and decision-ledger.jsonl that the protocol engine writes. No new state formats.
2. **Zero new dependencies.** All new modules use `node:fs`, `node:path`, `node:crypto` (for SHA-256 ID generation). Static file serving uses `node:fs` + MIME map.
3. **Read-only org surface (MVP).** Org views are observation-only. No cross-project mutations. Gate approvals remain per-project via the existing bridge-server or hosted runner single-project routes.
4. **Aggregation isolation.** A single project's read failure does not break the org overview — failed projects show `status: null` with an error flag.
5. **Primary project immutability.** The primary project cannot be unregistered. It defines the persistence location for the registry file.
6. **Existing routes untouched.** All 16 existing hosted runner routes remain identical. Org routes use the `/v1/org/` prefix with no overlap.

---

## Interface

### Org Dashboard Architecture

```
Browser (http://localhost:4100/)
    │
    ├─ GET /                          ← Static: cli/dashboard/index.html
    ├─ GET /app.js                    ← Static: cli/dashboard/app.js
    ├─ GET /components/org-overview.js ← Static: cli/dashboard/components/org-overview.js
    │
    ├─ GET /v1/org/overview           ← NEW: aggregated org metrics
    ├─ GET /v1/org/runs               ← NEW: cross-project run list
    ├─ GET /v1/org/decisions          ← NEW: cross-project decisions
    ├─ POST /v1/org/projects          ← NEW: register project
    ├─ GET /v1/org/projects           ← NEW: list projects
    ├─ DELETE /v1/org/projects/:id    ← NEW: unregister project
    │
    ├─ GET /v1/runs/:id               ← Existing: single-project run state
    ├─ POST /v1/projects/:id/runs     ← Existing: create run
    └─ ... (14 more existing routes)
    │
    ▼
┌──────────────────────────────────────────────────┐
│  Hosted Runner HTTP Server                        │  cli/src/lib/api/hosted-runner.js
│  (node:http, 22 routes + static files)            │  Port 4100
├──────────────────────────────────────────────────┤
│  Project Registry                                 │  NEW: cli/src/lib/api/project-registry.js
│  (file-backed, primary + secondary projects)      │  Persists to .agentxchain/org-registry.json
├──────────────────────────────────────────────────┤
│  Org State Aggregator                             │  NEW: cli/src/lib/api/org-state-aggregator.js
│  (reads state.json/history.jsonl per project)     │  Uses state-reader.js readJsonFile/readJsonlFile
├──────────────────────────────────────────────────┤
│  Protocol Bridge (existing 15 functions)          │  cli/src/lib/api/protocol-bridge.js
│  Job Queue + Execution Worker (existing)          │  job-queue.js + execution-worker.js
└──────────────────────────────────────────────────┘
    │
    ▼ (for each registered project)
┌──────────────────────────────────────────────────┐
│  .agentxchain/state.json                         │  Governed run state
│  .agentxchain/history.jsonl                      │  Turn history
│  .agentxchain/decision-ledger.jsonl              │  Decision ledger
│  .agentxchain/run-history.jsonl                  │  Historical runs
└──────────────────────────────────────────────────┘
```

### Request Flow (Org Overview)

```
1. Browser → GET /v1/org/overview
2. Hosted Runner → route match → aggregator.getOverview()
3. Aggregator → registry.list() → [proj_A, proj_B, proj_C]
4. For each project:
   a. readJsonFile(join(proj.root, '.agentxchain'), 'state.json')
   b. readJsonlFile(join(proj.root, '.agentxchain'), 'decision-ledger.jsonl')
   c. Extract: run_id, status, phase, gates, cost, decision_count
5. Aggregate: sum active_runs, pending_gates, total_decisions, total_cost
6. Return { data: { total_projects: 3, active_runs: 2, ... , projects: [...] } }
7. Browser → renderOrgOverview(data) → metrics banner + project cards
```

---

## Dev Charter

### Scope

**5 new files + 5 modifications: project registry + org aggregator + 2 dashboard components + test file + hosted runner + serve command + CLI registration + app.js + index.html.**

1. `cli/src/lib/api/project-registry.js` — File-backed project registry (register/unregister/list/get)
2. `cli/src/lib/api/org-state-aggregator.js` — Multi-project state aggregation (overview/runs/decisions)
3. `cli/dashboard/components/org-overview.js` — Org overview dashboard component (metrics + project cards)
4. `cli/dashboard/components/org-runs.js` — Cross-project run list dashboard component (filterable table)
5. `cli/test/org-dashboard.test.js` — 8 integration tests
6. `cli/src/lib/api/hosted-runner.js` — Add 6 org routes + static file serving + registry/aggregator init
7. `cli/src/commands/serve.js` — Accept --projects option
8. `cli/bin/agentxchain.js` — Add --projects option to serve command
9. `cli/dashboard/app.js` — Add 2 views + 2 API_MAP entries + viewState + imports
10. `cli/dashboard/index.html` — Add 2 nav links

### Out of Scope

- Cloud persistence (filesystem state-provider reads are used as-is)
- Full org/workspace/project tenancy hierarchy
- Authentication/authorization (localhost-only)
- Real-time cross-project event streaming
- Dashboard mutations from org views
- Changes to protocol-bridge.js, run-loop.js, api-proxy-adapter.js, runner-interface.js, bridge-server.js, state-reader.js

### Verification

Dev must confirm:
1. `agentxchain serve --port 4100 --projects /path/to/proj2` starts server and registers both projects
2. GET /v1/org/projects returns both projects
3. POST /v1/org/projects with a valid project root returns 201
4. GET /v1/org/overview returns aggregated metrics including both projects
5. GET /v1/org/runs returns runs from both projects with project attribution
6. GET /v1/org/decisions returns decisions from both projects
7. GET / serves the dashboard index.html from the hosted runner
8. All 8 org-dashboard integration tests pass
9. Vitest contract passes with the new test file (670 files)
10. No existing tests broken

## Acceptance Tests

- [ ] AT-OD-001: Register project via POST returns 201
- [ ] AT-OD-002: List projects via GET returns registered projects
- [ ] AT-OD-003: Unregister project via DELETE returns 200
- [ ] AT-OD-004: Org overview returns correct aggregated metrics
- [ ] AT-OD-005: Cross-project runs include project attribution
- [ ] AT-OD-006: Cross-project decisions include project attribution
- [ ] AT-OD-007: Multi-project aggregation shows all registered projects
- [ ] AT-OD-008: Unregistered project excluded from aggregation
