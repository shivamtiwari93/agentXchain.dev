# Implementation Notes — M8: Organization Dashboard with Multi-Project Visibility

**Run:** `run_76ce2c791a84e1cb`
**Turn:** `turn_56f91475278921ae`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Delivered the organization dashboard with multi-project visibility for the agentxchain.ai managed surface. An operator registers multiple governed projects with the hosted runner, and the dashboard displays aggregated cross-project metrics, a unified run list, and a cross-project decision ledger — all from a single URL. This is ROADMAP.md:96.

Five new files, five modified files, vitest contract bumped from 669 to 670.

## Changes

**`cli/src/lib/api/project-registry.js`** — New file-backed project registry:
- `createProjectRegistry(primaryRoot)` → `{ register, unregister, list, get, save, load }`
- Project IDs derived from SHA-256 of normalized absolute path (first 12 hex chars)
- Persists to `<primaryRoot>/.agentxchain/org-registry.json`
- Primary project always registered and cannot be unregistered
- `register()` validates `agentxchain.json` existence (governance check)
- Idempotent: re-registering same root updates name only
- Graceful load: corrupt/missing registry file → primary-only registry

**`cli/src/lib/api/org-state-aggregator.js`** — New multi-project state aggregator:
- `createOrgAggregator(registry)` → `{ getOverview, getRuns, getDecisions }`
- `getOverview()`: aggregates total_projects, active_runs, pending_gates, total_decisions, total_cost_usd across all registered projects
- `getRuns(query?)`: cross-project run list from state.json + run-history.jsonl, filterable by project/phase/status
- `getDecisions(query?)`: cross-project decision ledger from decision-ledger.jsonl, filterable by project/phase/role
- Individual project read failures isolated — never throws; failed projects show `error: 'state_unreadable'`
- Imports `readJsonFile`/`readJsonlFile` from `state-reader.js` (no new file readers)

**`cli/dashboard/components/org-overview.js`** — New org overview component:
- Metrics banner: 5 stat cards (projects, active runs, pending gates, decisions, total cost)
- Project cards grid: one card per project showing status/phase/run/turns/cost/pending gates
- Uses existing CSS classes (`.section`, `.badge`, `.turn-card`) plus inline `.org-metrics`/`.org-projects-grid` CSS
- `esc()` HTML escaping following timeline.js pattern

**`cli/dashboard/components/org-runs.js`** — New cross-project run list component:
- Filter bar with 3 dropdowns: project, phase, status (client-side filtering)
- Data table: 8 columns (project, run ID, phase, status, turns, cost, started, updated)
- Relative time formatting for started/updated columns
- Uses existing CSS classes (`.filter-bar`, `.filter-control`, `.data-table`, `.badge`)

**`cli/src/lib/api/hosted-runner.js`** — Modified (6 new routes + static file serving):
- 6 org routes: POST/GET/DELETE `/v1/org/projects`, GET `/v1/org/overview`, GET `/v1/org/runs`, GET `/v1/org/decisions`
- Static file serving for dashboard HTML/JS/CSS (GET / serves index.html, non-`/v1/` non-`/health` paths resolve from `cli/dashboard/`)
- MIME type map: `.html`, `.js`, `.css`, `.json`
- Directory traversal prevention in static file serving
- `createHostedRunner()` accepts optional `projects` array, creates registry + aggregator, returns `registry` in result
- `buildRoutes()` extended to accept `registry` and `aggregator` parameters

**`cli/src/commands/serve.js`** — Modified:
- Parses `--projects` option as comma-separated paths
- Resolves each path and passes as `projects` array to `createHostedRunner()`

**`cli/bin/agentxchain.js`** — Modified (1 line):
- Added `.option('--projects <paths>', 'Additional project roots (comma-separated)')` to serve command

**`cli/dashboard/app.js`** — Modified:
- 2 new imports: `renderOrgOverview`, `renderOrgRuns`
- 2 new VIEWS entries: `org-overview`, `org-runs`
- 2 new API_MAP entries: `orgOverview: '/v1/org/overview'`, `orgRuns: '/v1/org/runs'`
- 1 new viewState entry for `org-runs` filters
- `buildRenderData()` passes filter for `org-runs` view
- `change` event handler updated for org-runs filter controls

**`cli/dashboard/index.html`** — Modified (2 lines):
- 2 new nav links: "Org Overview" and "Org Runs" before "Initiative"

**`cli/test/org-dashboard.test.js`** — New integration tests (8 tests):
- AT-OD-001 through AT-OD-008 covering registry CRUD, aggregation, org routes, multi-project scenarios

**`cli/test/vitest-contract.test.js`** — Modified:
- File count bumped from 669 to 670

## Challenges to PM Spec

1. **PM_SIGNOFF §6 API_MAP uses `/api/org/overview` and `/api/org/runs`** — SYSTEM_SPEC §2.6.3 correctly notes these should use `/v1/` prefix since the dashboard is served from the hosted runner (port 4100), not the bridge server. Used `/v1/org/overview` and `/v1/org/runs`.

2. **PM SYSTEM_SPEC §2.2.5 getDecisions response shape omits `rationale` and `runtime_id`** — these fields exist in the decision-ledger.jsonl entries and are useful for the cross-project view. Included both for completeness (no extra read cost since the data is already parsed).

3. **PM SYSTEM_SPEC §2.3.3 static file serving says "after line 326"** — actual insertion point is after the no-route-match check (line varies with edits). Static serving is correctly placed before the 404 fallback in the `!matched` block.

## Verification

1. **Org dashboard tests**: `npx vitest run test/org-dashboard.test.js` — 8/8 pass (AT-OD-001 through AT-OD-008)
2. **Hosted runner tests**: `npx vitest run test/hosted-runner.test.js` — 11/11 pass (no regressions)
3. **Vitest contract**: `npx vitest run test/vitest-contract.test.js` — 11/11 pass (670 files counted)
4. **Dashboard bridge tests**: `npx vitest run test/dashboard-bridge.test.js` — 87/87 pass (no regressions)
5. **Control plane schema tests**: `npx vitest run test/control-plane-schema.test.js` — 7/7 pass (no regressions)
6. **CLI registration**: `node bin/agentxchain.js serve --help` — shows --projects option

## Architecture Invariants Maintained

1. **Protocol parity**: Org views read the same state.json, history.jsonl, and decision-ledger.jsonl that the protocol engine writes — no new state formats
2. **Zero new dependencies**: All modules use node:fs, node:path, node:crypto, node:http — no npm packages added
3. **Aggregation isolation**: Individual project read failures never break the org overview — failed projects show degraded state with error flag
4. **Primary project immutability**: Primary project cannot be unregistered; it defines the registry persistence location
5. **Existing routes untouched**: All 16 existing hosted runner routes remain identical; org routes use `/v1/org/` prefix with no overlap
6. **Read-only org surface (MVP)**: Org views are observation-only; no cross-project mutations
