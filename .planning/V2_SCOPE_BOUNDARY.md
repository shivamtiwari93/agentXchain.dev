# V2 Scope Boundary — AgentXchain

> Defines the exact feature boundary for v2.0.0, items explicitly deferred to v3, and items cut entirely.
>
> Historical release-boundary note: this file preserves the v2.0.0 scope decision. It is **not** the current authority for live dashboard mutability. The current shipped mutability contract lives in `.planning/DASHBOARD_GATE_ACTIONS_SPEC.md` and `.planning/DASHBOARD_DOCS_CONTRACT_SPEC.md`: the live local dashboard now supports authenticated `approve-gate` HTTP mutations, the WebSocket channel remains read-only, and `replay export` remains the read-only artifact-backed dashboard.

---

## Purpose

v1.0.0 ships single-repo governed sequential delivery with 3 adapters, 8-phase hooks, phase gates, and templates.
v1.1.0 ships parallel turns, api_proxy retry/tokenization, Anthropic error mapping, persistent blocked state.

This document freezes the v2.0.0 boundary: what ships, what does NOT ship, and why.

---

## What Ships In v2.0.0

### V2-F1: Multi-Repo Orchestration (Release)

**Status:** Fully implemented (6 slices, 180+ tests, all passing). Needs integration testing with live adapters and release packaging.

**Scope:**
- `agentxchain multi init` — coordinator bootstrap from `agentxchain-multi.json`
- `agentxchain multi step` — workstream selection, repo-local dispatch, resync-before-assignment, automatic gate request
- `agentxchain multi status` / `multi status --json` — coordinator state snapshot
- `agentxchain multi approve-gate` — unified phase transition and completion approval
- `agentxchain multi resync` — manual divergence recovery
- Cross-repo context injection via `COORDINATOR_CONTEXT.json` in dispatch bundles
- Acceptance projection with barrier evaluation
- Phase and completion gates with human approval
- Coordinator hooks: `before_assignment`, `after_acceptance`, `before_gate`, `on_escalation`
- Hook scope enforcement with tamper rollback
- Coordinator recovery: divergence detection, re-sync from repo-local authority

**What does NOT ship as part of V2-F1:**
- No automatic cross-repo conflict resolution. Each repo is a separate governed run. The coordinator does not merge across repos.
- No `review_only` dispatch mode. Coordinator assigns work; it does not dispatch read-only review turns to non-owning repos.
- No remote coordinator state. State lives on the operator's filesystem, same as repo-local state.
- No automatic rollback across repos. If one repo fails, the coordinator enters blocked state. Operator recovers manually via `multi resync` or `resume`.

### V2-F2: Dashboard Multi-Repo Integration

**Status:** Historical v2.0 baseline is shipped (bridge server, 5 repo-local panels, WebSocket). Coordinator state integration extends it to 7 total views. Later releases expanded the view count and added a narrow authenticated live-dashboard gate-approval path; see the superseding dashboard specs noted above.

**Scope:**
- Dashboard bridge reads coordinator state files alongside repo-local state
- New panel: coordinator initiative overview (phases, repos, barrier status)
- New panel: cross-repo timeline (interleaved turns across repos, color-coded by repo)
- Gate evidence aggregation from coordinator gates (not just repo-local gates)
- Coordinator blocked-state display with escalation context

**What does NOT ship as part of V2-F2:**
- No cloud-hosted dashboard. v2 dashboard remains localhost-only.
- No multi-tenant persistence. State is read from filesystem, not from a database.
- Historical v2.0 boundary only: no write operations from dashboard. This was later superseded by the shipped narrow `approve-gate` action in `.planning/DASHBOARD_GATE_ACTIONS_SPEC.md`. Replay/export remains read-only.

### V2-F3: Coordinator Hook Payloads — Context Invalidation

**Status:** Hook lifecycle is wired and proven. Payloads carry the base contract. Context invalidation signals are the last missing payload dimension.

**Scope:**
- `after_acceptance` hook payloads include a `context_invalidation` field listing cross-repo context keys that were affected by the accepted turn's file changes
- The invalidation signal is informational — it tells downstream hooks/integrations which repos have stale cross-repo context
- Coordinator re-dispatches after acceptance automatically regenerate `COORDINATOR_CONTEXT.json`, so the invalidation signal is for external consumers (notification pipelines, compliance validators), not for the coordinator itself

**Decision on directory-level tamper detection for new files in dispatch dirs:**
- **Deferred to v2.1.** Current tamper detection protects existing files in protected paths via pre-hook snapshot + post-hook comparison. It does NOT detect newly created files in dispatch bundle directories by hooks. This is a real gap — a hook could drop a file into a dispatch dir that the adapter would consume as if it were coordinator-generated. However:
  - The attack surface is limited: hooks run as operator-configured processes, not as untrusted third-party code
  - The mitigation for v2 is documentation: hooks MUST NOT create files in dispatch bundle directories. The coordinator logs a warning if it detects unexpected files in the dispatch dir at dispatch time.
  - v2.1 adds a content-addressed manifest of dispatch bundle files at bundle finalization time, and the adapter rejects any file not in the manifest. See `V2_1_SCOPE_BOUNDARY.md` for the exact contract.

### V2-F4: Plugin System — Organization Integrations (Phase 1)

**Status:** Hook system provides the execution framework. Plugin system adds discovery, configuration, and packaging.

**Scope:**
- Plugin manifest format: `agentxchain-plugin.json` with `name`, `version`, `hooks` (mapping phase → script), `config_schema`
- `agentxchain plugin install <path|npm-package>` — installs a plugin into `.agentxchain/plugins/`
- `agentxchain plugin list` — shows installed plugins and their hook bindings
- `agentxchain plugin remove <name>` — uninstalls a plugin
- Plugins are thin wrappers around the existing hook system. A plugin's hooks are registered as additional entries in the hook configuration at install time. They run in the same lifecycle with the same tamper protections.
- Built-in plugins shipped with v2:
  - `@agentxchain/plugin-slack-notify` — shipped in-repo at `plugins/plugin-slack-notify/`; posts turn summaries, gate approvals, and escalations to a Slack incoming webhook
  - `@agentxchain/plugin-json-report` — shipped in-repo at `plugins/plugin-json-report/`; writes structured JSON lifecycle reports under `.agentxchain/reports/` for CI and operator tooling

**What does NOT ship as part of V2-F4:**
- No plugin marketplace or remote registry. Plugins are installed from local paths or npm packages.
- No plugin isolation beyond filesystem tamper detection. Plugins run as child processes with the same trust model as hooks.
- No Jira/PagerDuty/custom compliance plugins in v2. Those are community/enterprise extensions.

### V2-F5: Protocol Specification v2

**Status:** SPEC-GOVERNED-v5 covers single-repo. Multi-repo needs a protocol-level spec.

**Scope:**
- Protocol spec v6 adds: coordinator config schema, coordinator state machine, cross-repo context format, barrier evaluation rules, coordinator gate semantics
- Versioned independently from the CLI. Protocol spec is the constitutional layer; CLI is an implementation.
- Published as `website-v2/docs/protocol.mdx` (Docusaurus source; the v6 spec content is incorporated into the main protocol docs page)

---

## What Is Deferred To v3.0.0

### V3-D1: Cloud-Hosted Dashboard

**Why deferred:** The local dashboard proves the data model and panel design. Cloud hosting adds authentication, multi-tenancy, persistent storage, and billing — all of which are agentxchain.ai commercial concerns, not agentxchain.dev open-source concerns. Shipping cloud before the local dashboard is battle-tested inverts the quality signal.

### V3-D2: Managed Adapter Fleet

**Why deferred:** Running adapters as managed cloud processes (rather than operator-local child processes) requires container orchestration, secret management, cost metering, and execution isolation. This is Tier 3 infrastructure work. The v2 adapter model (3 local adapters + plugin hooks) is sufficient for single-operator and small-team use.

### V3-D3: Agent-Native Continuous Delivery

**Why deferred:** VISION.md §v3 describes agents monitoring production, proposing fixes, and getting governed review autonomously. This requires production observability integration, automatic issue detection, and a continuous governance loop — all of which depend on the v2 multi-repo and plugin foundations being battle-tested.

### V3-D4: Cross-Repo Conflict Resolution

**Why deferred:** v2 coordinator assigns one repo at a time and barriers prevent conflicting cross-repo state. Actual cross-repo merge conflict resolution (where changes in repo A structurally conflict with changes in repo B) requires a merge strategy the coordinator doesn't have. This is hard, and getting it wrong is worse than not having it.

### V3-D5: Directory-Level Tamper Detection (Content-Addressed Dispatch Manifests)

**Why deferred from v2.0 to v2.1:** See V2-F3 discussion. Warning-based detection in v2.0, manifest-based enforcement in v2.1.

---

## What Is Cut Entirely (No Version Planned)

### ~~CUT-1: OpenAI / Google Provider Adapters~~ (SUPERSEDED)

**Status:** OpenAI provider support shipped post-v2 (`DEC-APIPROXY-OPENAI-001`+). The api_proxy adapter now supports both Anthropic and OpenAI provider families. Google providers remain unplanned. `base_url` override is available for both providers (`DEC-APIPROXY-BASE-URL-001`–`004`). The original cut decision `DEC-V2-SCOPE-006` is partially superseded for OpenAI.

### CUT-2: Visual Workflow Builder / GUI Config Editor

**Why cut:** The governance model is config-as-code. A visual builder would need to round-trip perfectly with the JSON config, handle every edge case the schema supports, and not introduce state that the CLI can't read. The ROI is negative for the current user base (CLI-native developers and platform engineers).

### CUT-3: Public Template Marketplace

**Why cut:** The template system supports local and npm-installed templates. A hosted marketplace adds discovery, curation, moderation, and hosting costs. The template set is small enough that documentation is sufficient.

### CUT-4: Real-Time Agent Streaming in Dashboard

**Why cut:** The dashboard shows completed turns and state snapshots. Streaming partial agent output into the dashboard would require a persistent connection to running adapter processes, partial result parsing, and a fundamentally different data model. The audit-trail approach (see completed work, not in-progress noise) is architecturally intentional.

### CUT-5: Coordinator-Driven Automatic Rollback Across Repos

**Why cut:** If repo A's acceptance invalidates repo B's state, the coordinator enters blocked state. Automatic cross-repo rollback (reverting repo A's accepted turn) would require git operations on behalf of the operator, which violates the principle that the orchestrator governs but does not execute destructive actions on the codebase.

---

## Release Sequence

| Version | Contents | Prerequisite |
|---------|----------|-------------|
| v1.0.0 | Single-repo governed sequential + 3 adapters + hooks + templates | Clean tree, test baseline, npm publish |
| v1.1.0 | Parallel turns, api_proxy retry/tokenization, blocked state | v1.0.0 published, checklist complete |
| v2.0.0 | Multi-repo coordinator + dashboard integration + plugin system phase 1 + protocol spec v6 + context invalidation payloads | v1.1.0 stable, multi-repo integration tests with live adapters |
| v2.1.0 | Dispatch manifest integrity, hook/plugin hardening, dashboard evidence drill-down | v2.0.0 feedback cycle |
| v3.0.0 | Cloud dashboard, managed adapters, continuous delivery loop | v2.x stable, agentxchain.ai infrastructure |

---

## Decisions

- `DEC-V2-SCOPE-001`: v2.0.0 boundary is multi-repo release + dashboard integration + plugin system phase 1 + protocol spec v6 + context invalidation payloads.
- `DEC-V2-SCOPE-002`: Cloud-hosted dashboard is v3. Local dashboard is the v2 surface.
- `DEC-V2-SCOPE-003`: Directory-level new-file tamper detection is v2.1 (content-addressed manifests). v2.0 ships warning-based detection.
- `DEC-V2-SCOPE-004`: Context invalidation payloads in `after_acceptance` hooks are v2 scope. They are informational signals for external consumers, not coordinator-internal state.
- `DEC-V2-SCOPE-005`: Plugin system ships as thin wrapper over hooks. No marketplace, no isolation beyond filesystem tamper detection.
- `DEC-V2-SCOPE-006`: ~~OpenAI/~~Google provider adapters, visual workflow builder, public template marketplace, real-time streaming dashboard, and automatic cross-repo rollback are cut from all versions. OpenAI provider adapter shipped post-v2 (see CUT-1 supersession above). Community contributions welcome for remaining provider adapters.
- `DEC-V2-SCOPE-007`: Protocol spec v6 is published alongside v2.0.0 as the constitutional document for multi-repo governance.
