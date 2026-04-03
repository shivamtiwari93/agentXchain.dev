# Changelog

## 2.4.0

MCP runtime adapter, template validation layer, and library template. First governed connector beyond local_cli and api_proxy.

### MCP Runtime Adapter

- New `mcp` runtime type for governed turns over Model Context Protocol stdio transport.
- Single-tool dispatch: agent receives all 13 governed arguments via `agentxchain_turn` tool call, returns a turn result via `structuredContent` or JSON text.
- SDK wrapper unwrapping: nested `@modelcontextprotocol/sdk` `TextContent.text` envelopes are extracted automatically.
- Configurable tool name, command, args, environment, working directory, and timeout (default 20 minutes).
- Provider-agnostic: any MCP-compatible server can serve governed turns regardless of the underlying model.
- Reference implementation: `examples/mcp-echo-agent/` with validator-clean no-op payloads.
- Governed proof: MCP adapter → turn result validation → CLI `step` auto-accept demonstrated end-to-end in the `governed-todo-app` example.

### Template Validation

- New `agentxchain template validate [--json]` command for operator-facing template contract proof.
- Registry validation: every registered template ID must have a manifest, every manifest must be registered.
- Project binding validation: configured template must exist in the registry.
- Planning artifact completeness: validates that all `planning_artifacts[].filename` entries exist on disk.
- Acceptance hint completion: checks `.planning/acceptance-matrix.md` for `- [x]` completion status (warning-level, not blocking).
- `agentxchain validate` also surfaces template contract results.

### Library Template

- New `library` governed template for reusable package projects alongside `generic`, `api-service`, `cli-tool`, and `web-app`.
- Planning artifacts: `public-api.md`, `compatibility-policy.md`, `release-adoption.md`.
- Prompt guidance biases PM/dev/QA toward exported-surface stability, compatibility promises, and consumer install/import proof.

### Docs Hardening (continued)

- Adapter docs updated with MCP runtime contract, tool argument table, config fields, and example linkage.
- Plugin docs contract spec fixed for stale references.
- Template docs now code-backed against template manifests for all 5 template IDs.

### Evidence

- 648 Vitest tests (36 files) + 1364 node --test (310 suites), 0 failures.
- Website production build passes.
- Removed `.DS_Store` and `cli/node_modules/.package-lock.json` from git tracking (both covered by `.gitignore`).

## 2.3.0

Continuous delivery intake lifecycle and docs truthfulness release. Intake is the first continuous-governed-delivery primitive, and every deep-dive docs page is now held to code-backed behavioral verification.

### Continuous Delivery Intake

- Eight-command intake lifecycle shipped: `record`, `triage`, `approve`, `plan`, `start`, `scan`, `resolve`, `status`.
- Filesystem contract: `.agentxchain/intake/{events,intents,observations}/` with structured event sourcing.
- State machine: `detected → triaged → approved → planned → executing → completed/blocked/failed`, plus `suppressed` and `rejected` exits.
- `intake start` bootstraps a new governed run from idle state or resumes a paused run (no pending gates).
- `intake scan` ingests deterministic source snapshots with per-item deduplication and all-rejected aggregate failure.
- `intake resolve` maps execution outcomes (`completed`, `blocked`, `failed`) to governed run fields including `run_blocked_recovery` and `run_failed_at`.
- `.agentxchain/intake/` excluded from repo observation — orchestrator-owned operational state.
- CLI-subprocess E2E acceptance proof covers the full `record → triage → approve → plan → start → accept-turn → resolve` lifecycle.

### Vitest Steady State

- Vitest coexistence runner at steady state: 36 files, 630 tests across 3 expansion slices (pure-unit, docs-content/contract, coordinator).
- `vitest-slice-manifest.js` is the single source of truth for the Vitest include list.
- Repo-local `vitest-node-test-shim.js` resolves `node:test` → `vitest` hook incompatibility.
- Both runners exercise the same files: `test:vitest` (630 tests) + `test:node` (1285 tests).

### OpenAI API Proxy Support

- `api_proxy` adapter now supports `provider: "openai"` for synchronous `review_only` governed turns via OpenAI Chat Completions API.
- Provider-specific request building: developer/user message mapping, `response_format: { type: "json_object" }`, `max_completion_tokens`.
- Provider-specific error classification: `invalid_api_key`, `model_not_found`, rate limits, context overflow.
- Provider-specific usage telemetry: `prompt_tokens` / `completion_tokens` mapped to existing cost object.
- Config validation rejects OpenAI + `preflight_tokenization` (no OpenAI `provider_local` tokenizer in-repo).
- Scope: Chat-Completions-only JSON output. Responses API, tool use, background execution, and write-capable roles remain out of scope.

### Docs Truthfulness Hardening

- **CLI reference audits:** Fixed 15 ghost/missing flags across governance commands, added missing `intake` and `multi` command families to the command map, and shipped a meta-guard for command-map completeness.
- **Adapter deep-dive rewrite:** Fixed 12 defects including 3 fabricated sections (TypeScript adapter interface, fabricated multi-provider claims, per-HTTP-status retry schedules). All transport modes, error classes, retry policy, and provider support now verified against implementation. (Note: real OpenAI support was subsequently implemented and documented — see above.)
- **Protocol deep-dive rewrite:** Fixed default phase name (`qa` not `verification`), schema version split, queued-vs-pending gate lifecycle, objection enforcement scope, migration semantics.
- **Multi-repo deep-dive:** New `/docs/multi-repo` page with truthful workspace contract, artifact layout, barrier model, hook phases, and recovery model. Config filename corrected from fabricated `coordinator.yaml` to shipped `agentxchain-multi.json`.
- **Intake deep-dive rewrite:** Fixed paused-state behavioral lie, documented idle bootstrap, added resolve outcome fields (`run_blocked_recovery`, `run_failed_at`), documented all-rejected scan failure rule.
- **Templates deep-dive:** Upgraded from string-presence guard to code-backed contract test against template manifests.
- **Plugin docs:** Removed ghost `--from` flag, ghost `--force` prose claim, added flag tables for all 4 subcommands.
- 10 dedicated docs guard tests plus the command-map completeness meta-guard, all reading implementation source files for bidirectional verification.

### Documentation

- Retired `website/` flat HTML directory. `website-v2/` Docusaurus is the sole docs source.
- Protocol implementor guide with progressive conformance adoption.
- Surface claims in `capabilities.json` enforced by the protocol verifier when present.

### Evidence

- 639 Vitest tests (36 files) + 1295 node --test (299 suites), 0 failures.
- Website production build passes.
- Postflight install smoke test hardened for CI OIDC auth isolation.

## 2.2.0

Protocol conformance release. The governed protocol is now testable by any implementation, not just the reference CLI.

### Protocol Conformance Kit

- `agentxchain verify protocol` validates any implementation against the canonical protocol spec via a portable fixture corpus.
- 53 golden I/O fixtures across 3 tiers: Tier 1 (core constitutional — state machine, turn result validation, gate semantics, decision ledger, history, config schema), Tier 2 (trust hardening — dispatch manifest integrity, hook audit), Tier 3 (multi-repo coordination).
- Adapter bridge model (`stdio-fixture-v1`): implementations provide a single adapter command declared in `capabilities.json`. The validator feeds fixture JSON on stdin, receives result JSON on stdout. Implementation-agnostic by design.
- Conformance report with per-tier and per-surface pass/fail/error breakdown in JSON or text format.
- Exit semantics: `0` = pass, `1` = fixture failure, `2` = execution/config/adapter error.
- Reference adapter included: the CLI self-validates all 53 fixtures as part of CI.

### Conformance CI Enforcement

- CI now runs `agentxchain verify protocol --tier 3` on every PR. Protocol conformance cannot regress silently.

### Documentation

- `verify protocol` documented in CLI reference, quickstart, and README.
- Conformance fixture format, adapter contract, and capabilities schema documented in the conformance corpus README.

### Website

- Migrated docs from hand-written static HTML to Docusaurus with MDX, dark mode, and sidebar navigation.
- Deployed to GCS with two-tier cache strategy: hashed assets (1yr immutable), HTML (5min browser / 1min CDN edge).
- Landing page updated with long-horizon coding, lights-out software factories, and explicit .dev/.ai platform split framing.
- VISION.md updated to match website content.

## 2.1.1

Patch release to fix the npm publication path for the `2.1.x` line.

- Configure the GitHub Actions publish workflow with the npm registry URL required for trusted publishing.
- Make `publish-from-tag` tests hermetic under GitHub Actions so `setup-node` auth environment does not cause false failures during release preflight.

## 2.1.0

Trust-hardening and operator-visibility release on top of the v2 governed coordination base.

### Dispatch Manifest Integrity

- Finalized dispatch bundles now write `MANIFEST.json` with bundle identity plus per-file SHA-256 digest and byte size.
- Adapters verify finalized bundles before execution and fail closed on unexpected files, missing files, digest mismatch, or size mismatch.
- Coordinator dispatch protection now covers finalized directory integrity, not only rollback of modified existing files.

### HTTP Hooks And Plugin Hardening

- Hooks now support `"type": "http"` with JSON POST transport, timeout enforcement, env-backed header interpolation, and allow/warn/block verdict parity with process hooks.
- Plugin `config_schema` is now enforced during install/load rather than treated as passive metadata.
- Plugin upgrades are first-class and atomic: success replaces prior state, failure restores the prior installation and hook config.

### Dashboard Evidence Drill-Down

- Timeline cards now expand into turn detail panels with hook annotations and nearby hook-audit context.
- Decision ledger adds phase/date filtering and objection visibility.
- Hook audit log adds phase, verdict, and hook-name filters.
- Dashboard remains read-only; the release improves audit depth, not mutation authority.

## 2.0.0

This release subsumes all features from the unpublished `0.9.0`, `1.0.0`, and `1.1.0` development milestones.

### Multi-Repo Orchestration

- **Coordinator governance for multi-repo initiatives:** `agentxchain multi init` bootstraps a coordinator from `agentxchain-multi.json`. `multi step` dispatches to repo-scoped workstreams with automatic resync-before-assignment and gate request. `multi status` and `multi status --json` expose coordinator state. `multi approve-gate` unifies phase transition and completion approval. `multi resync` provides manual divergence recovery.
- **Cross-repo context injection:** dispatches include `COORDINATOR_CONTEXT.json` with upstream repo state, acceptance projections, and barrier evaluations so agents in one repo have visibility into progress across the initiative.
- **Context invalidation signals:** `after_acceptance` hook payloads include `context_invalidations` listing which downstream repos have stale cross-repo context after a new acceptance.
- **Coordinator hooks:** `before_assignment`, `after_acceptance`, `before_gate`, and `on_escalation` fire at real CLI lifecycle boundaries with blocking/advisory semantics. Hook scope enforcement covers both coordinator-owned and repo-local orchestrator files with pre-hook snapshot and post-hook tamper rollback.

### Dashboard Multi-Repo Integration

- **7-view local dashboard:** adds coordinator `initiative` and `cross-repo` views alongside the 5 repo-local panels. Gate and blocked views are dual-mode — they render coordinator state when authoritative. Dashboard bridge serves coordinator state under `/api/coordinator/*` with relative-path invalidation keys.

### Plugin System Phase 1

- **Plugin lifecycle:** `agentxchain plugin install <path|npm-package>`, `plugin list`, `plugin remove`. Manifest-driven (`agentxchain-plugin.json`) with phase-scoped hook-name collision protection, path rewriting for installed hooks, and metadata-driven removal that preserves unrelated hook bindings. Failed installs leave no filesystem drift.
- **Built-in plugins:** `@agentxchain/plugin-slack-notify` (advisory webhook notifications on acceptance, gate, and escalation) and `@agentxchain/plugin-json-report` (timestamped lifecycle artifacts under `.agentxchain/reports/`).

### Protocol v6

- **Constitutional document for multi-repo governance:** `PROTOCOL-v6.md` specifies coordinator state files, history events, gate semantics, cross-repo context generation, context invalidation signals, and coordinator hook payload contracts. Published at `/docs/protocol.html` and `/docs/protocol-v6.html`.

### Documentation

- Full static docs site: quickstart, adapters, CLI reference, plugins, protocol (v5 historical + v6 current).
- All 6 docs pages share consistent nav, sidebar, and footer.
- Drift guard tests enforce alignment between specs, published HTML, README links, and planning docs.

## 1.1.0

### New Opt-In Features

These features require explicit configuration. A v1.0.0 config file with no new fields runs identically under v1.1 — no silent behavior changes.

- **Parallel agent turns:** assign up to 4 concurrent governed turns per phase via `max_concurrent_turns` in phase config (default: `1`, preserving v1.0 sequential behavior). Includes turn-scoped dispatch isolation, acceptance serialization with lock/journal, file-level conflict detection at acceptance, and two operator-chosen conflict recovery paths (`reject-turn --reassign` and `accept-turn --resolution human_merge`).
- **Auto-retry with backoff (`api_proxy`):** enable via `retry_policy.enabled = true` on a runtime config block. Adapter-local only — does not create governed turns or mutate governed attempt counters. Bounded exponential backoff with jitter. `api-retry-trace.json` audit artifact on retry. Success-path cost aggregates usage across all attempts.
- **Preemptive tokenization (`api_proxy` + Anthropic):** enable via `preflight_tokenization.enabled = true` with a required `context_window_tokens` value. Local token budgeting and bounded compression before dispatch. Fails locally with `context_overflow` when over budget, avoiding a paid API call. Audit artifacts: `TOKEN_BUDGET.json` and `CONTEXT.effective.md`.

### Automatic Precision Improvements

These are active by default and improve error classification and state visibility without changing operator-required actions.

- **Anthropic provider-specific error mapping:** provider-native error type extraction runs before the HTTP-status fallback. New error classes: `invalid_request`, `provider_overloaded`. Daily/spend 429s classified as `rate_limited` but non-retryable. `provider_error_type` and `provider_error_code` preserved in `api-error.json`. Unknown structured provider errors fall back to HTTP classification while preserving provider fields.
- **Persistent blocked state:** `blocked` is a first-class `state.json` status alongside `idle`, `active`, `paused`, `completed`, `failed`. Required `blocked_reason` descriptor on entry. Enters `blocked` on accepted `needs_human`, retry exhaustion, or surfaced dispatch failure. `paused` survives only for explicit human approval gates (phase transitions, run completion). Legacy `paused + human:*` / `paused + escalation:*` states migrate in-place to `blocked` on read. Recovery via `step --resume`.

### Schema And State Changes

- `schema_version` bumped from `"1.0"` to `"1.1"`.
- v1.1 reads and migrates `"1.0"` state files in place (backward compatible). v1.0 does NOT read `"1.1"` state files.
- Migration: `current_turn` → `active_turns` map, legacy paused states → `blocked`, version stamp updated.
- v1.1 rejects unknown `schema_version` values with a clear error (forward compatibility guard).

### CLI Surface Changes

- `step --resume --turn <id>` for targeted resume when multiple turns are active.
- `accept-turn --turn <id>` and `reject-turn --turn <id>` for targeted acceptance/rejection.
- `reject-turn --turn <id> --reassign` for conflict-caused re-dispatch with structured conflict context.
- `accept-turn --turn <id> --resolution human_merge` for operator-merged conflict resolution.
- `status` and `status --json` render multiple active turns, conflict state, and blocked banners.
- Ambiguous commands (e.g. `step --resume` with multiple active turns and no `--turn`) fail with guidance.

### Dispatch And Staging

- All dispatch bundles now use turn-scoped paths: `.agentxchain/dispatch/turns/<turn_id>/` and `.agentxchain/staging/<turn_id>/turn-result.json`, even in sequential mode.
- `dispatch/index.json` is the operator-visible manifest for active dispatch bundles.

## 1.0.0

- Finalized the governed v4 protocol as the canonical CLI surface: orchestrator-owned `.agentxchain/state.json`, structured turn results, append-only `history.jsonl` and `decision-ledger.jsonl`, gate-driven phase progression, and explicit completion approval.
- Shipped the full governed turn lifecycle across the CLI: `init --governed`, `migrate`, `status`, `resume`, `step`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, and `validate --mode turn`.
- Froze the dispatch contract around turn-scoped bundle paths with retry-aware redispatch, rejected-attempt preservation, and warning-bearing degraded context handling.
- Added the governed validation pipeline as a release contract: structural schema checks, assignment identity checks, observed artifact validation, verification normalization, and protocol-compliance enforcement.
- Completed the v1 adapter surface: `manual` polling, `local_cli` subprocess dispatch, and `api_proxy` synchronous review-only execution.
- Added typed `api_proxy` recovery classification for missing credentials, auth failure, rate limits, model resolution errors, context overflow, network/timeout failures, response parsing failures, and turn-result extraction failures, with `api-error.json` audit artifacts.
- Proved the governed lifecycle through automated end-to-end coverage for the happy path and reject/retry path, alongside CLI-level guards for malformed config rejection and concurrent turn prevention.
- Added strict release preflight mode for the post-bump cut gate, with script-level coverage for dirty-tree, version, and failure-propagation behavior.
- Expanded the planning/spec package to 13 governed v1 artifacts covering CLI, types, state machine, dispatch bundle, operator recovery, adapter contracts, e2e flows, API error recovery, and release gating.

## 0.9.0

- Introduced governed protocol mode with orchestrator-owned `state.json`, phase routing, and gate enforcement.
- Added the full governed turn lifecycle: assign, dispatch, validate, accept, reject, retry, and escalation.
- Added three governed adapter classes: `manual`, `local_cli`, and `api_proxy`.
- Added recovery descriptors across operator surfaces so blocked states expose `typed_reason`, `owner`, `recovery_action`, and `turn_retained`.
- Added phase transition approvals and run-completion approval flows with explicit human sign-off.
- Added the operator recovery contract and blocked-state coverage for validation failures, human pauses, dispatch failures, and retry exhaustion.
- Expanded automated CLI coverage for governed flows, including 115+ tests and focused recovery-surface tests.
