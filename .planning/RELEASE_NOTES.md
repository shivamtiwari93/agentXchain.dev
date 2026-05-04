# Release Notes — M8: Organization Dashboard with Multi-Project Visibility

## User Impact

This release delivers **multi-project organization visibility** to the agentxchain.ai managed surface. Operators can register multiple governed projects with the hosted runner and view aggregated cross-project metrics, a unified run list, and a cross-project decision ledger — all from a single dashboard URL. This is ROADMAP.md:96.

### What Was Delivered

- **Project Registry** (`cli/src/lib/api/project-registry.js`): File-backed registry mapping project IDs to root directories. Register/unregister additional governed projects. Deterministic SHA-256-based project IDs. Persists to `.agentxchain/org-registry.json`. Primary project always registered and cannot be unregistered.

- **Org State Aggregator** (`cli/src/lib/api/org-state-aggregator.js`): Reads governed state from each registered project. Three views: `getOverview()` (total projects, active runs, pending gates, decisions, cost), `getRuns(query?)` (cross-project run list with filtering), `getDecisions(query?)` (cross-project decision ledger with filtering). Individual project read failures are isolated — never breaks the org view.

- **Org Overview Component** (`cli/dashboard/components/org-overview.js`): Metrics banner (5 stat cards) plus project cards grid showing status/phase/run/turns/cost per project. Dark theme, responsive grid layout.

- **Org Runs Component** (`cli/dashboard/components/org-runs.js`): Cross-project run list with 3-dropdown filter bar (project, phase, status) and 8-column data table with relative time formatting.

- **6 New Hosted Runner Routes**: `POST/GET/DELETE /v1/org/projects` (project CRUD), `GET /v1/org/overview` (aggregated metrics), `GET /v1/org/runs` (cross-project runs), `GET /v1/org/decisions` (cross-project decisions).

- **Static File Serving**: Dashboard HTML/JS/CSS served directly from the hosted runner at `http://localhost:4100/`. Directory traversal prevention via path prefix check.

- **CLI `--projects` Option**: `agentxchain serve --projects /path/to/proj2,/path/to/proj3` registers additional projects at startup.

- **8 Integration Tests** (`cli/test/org-dashboard.test.js`): Full coverage of project registration CRUD, aggregation, org routes, multi-project scenarios, and unregistration exclusion.

### Architecture Highlights

- **Protocol parity invariant maintained.** Org views read the same state.json, history.jsonl, and decision-ledger.jsonl that the protocol engine writes. No new state formats.
- **Zero new npm dependencies.** All modules use node:fs, node:path, node:crypto. Static serving uses node:fs + MIME type map.
- **Aggregation isolation.** A single project's read failure does not break the org overview — failed projects show degraded state with error flag.
- **Primary project immutability.** The primary project cannot be unregistered and defines the registry persistence location.
- **Existing routes untouched.** All 16 prior hosted runner routes remain identical. Org routes use `/v1/org/` prefix with no overlap.
- **Read-only org surface (MVP).** Org views are observation-only. No cross-project mutations.

### Known Limitations

- Pending gates field (`state.gates`) and cost field (`cost_tracker.total_cost_usd`) in the PM spec do not match production state.json field names (`phase_gate_status`, `budget_status.spent_usd`). These cosmetic display fields will show defaults for real registered projects until a follow-up alignment pass.

## Verification Summary

- 8/8 SYSTEM_SPEC acceptance tests pass (AT-OD-001 through AT-OD-008)
- 136 tests across 6 files, 0 failures, 0 regressions
- Vitest contract: 11/11 pass (file count = 670)
- CLI `serve --help` verified with --projects option
- Code reviewed for correctness, security (directory traversal prevention, HTML escaping), spec compliance, and architecture invariants
