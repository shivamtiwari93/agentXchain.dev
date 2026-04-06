# Changelog

## 2.12.0

Governed gates now enforce semantic truth, not just file presence. Scaffold ergonomics and docs accuracy improved across the board.

### Semantic Workflow Gate Enforcement

- Phase-transition gates now require `.planning/PM_SIGNOFF.md` to contain `Approved: YES`. File existence alone no longer satisfies the planning gate.
- Run-completion gates now require `.planning/ship-verdict.md` to carry an affirmative `## Verdict:` value (`YES`, `SHIP`, or `SHIP IT`). Placeholder verdicts fail the gate.
- `template validate` remains scaffold-integrity proof only — it does not pretend to certify gate readiness. Docs and CLI output now explicitly distinguish the two.
- New `cli/src/lib/workflow-gate-semantics.js` module: pure-function semantic evaluators consumed by the gate evaluator.

### Scaffold Ergonomics

- `agentxchain init --governed` now accepts `--dir <path>` for explicit scaffold target directory. Project name is inferred from directory basename. `--dir .` bootstraps in-place inside an existing repo.
- `--dev-command <parts...>` and `--dev-prompt-transport <mode>` allow non-default agent configuration at scaffold time.
- All documentation examples updated to use explicit `--dir` — implicit default-directory patterns removed from docs.

### Docs Accuracy

- Adapter docs narrowed to verified-default `claude --print` contract; overclaiming of equal Codex/Aider support removed.
- Quickstart cold-start E2E proof added: the documented flow is now tested end-to-end.
- Homebrew tap rename audit completed: all stale `homebrew-agentxchain` references fixed across planning docs, scripts, and tests.

### Evidence

- 1921 node --test tests / 432 suites, 0 failures.
- 681 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.11.0

Protocol conformance closure and workflow-kit proof surfaced honestly. This release closes the remaining shipped verifier gaps around `hook_audit` and `dispatch_manifest`, promotes remote verification into a first-class public docs contract, and turns `template validate` into an explicit operator proof for the governed scaffold.

### Conformance Closure

- `hook_audit` verifier coverage now spans the full shipped branch set, including invalid-output handling, multi-hook execution, blocked-failure paths, and tamper detection.
- `dispatch_manifest` now covers the full shipped error taxonomy instead of a partial subset.
- `hook_ok` response semantics are documented and held by code-backed docs guards, so hook success is not left as an implied convention.

### Remote Verification Surface

- New public docs page: `/docs/remote-verification`.
- The HTTP conformance path is now documented from protocol contract through runnable example server and docs/content guard coverage.
- Remote verification is treated as the same fixture-driven verifier model as local stdio, not as a second conformance system.

### Workflow-Kit Proof

- `agentxchain template validate` now proves the governed workflow kit, not just the template registry.
- `--json` exposes a `workflow_kit` block so automation can distinguish scaffold failures from template-surface failures.
- The four required workflow markers are now part of the explicit operator-facing contract: `Approved:`, `## Phases`, `| Req # |`, and `## Verdict:`.
- `README.md`, `cli/README.md`, and `/docs/quickstart` now document `template validate` as a front-door proof step.

### Evidence

- 1884 node --test tests / 423 suites, 0 failures.
- 679 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.10.0

First real-model evidence: AgentXchain now has a live governed proof that dispatches to a real LLM via the api_proxy adapter, validates all protocol artifacts, and demonstrates governed retry on schema non-conformance.

### Live Governed Proof

- New `examples/live-governed-proof/run-live-turn.mjs` — standalone script that scaffolds a governed project, dispatches a review-only turn to a real Anthropic API endpoint, and validates the full artifact trail.
- Gated behind `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` env vars — exits 0 (skip) with no credentials, so CI stays deterministic.
- Uses governed retry (`rejectTurn` → re-dispatch) to handle real model schema violations, demonstrating protocol rejection/retry machinery on live model output.
- Two-phase artifact validation: dispatch/staging validated before acceptance (since `acceptTurn` cleans up those directories), state/history/ledger validated after.
- Contract test enforces boundary rules: imports only from `runner-interface.js` and `api-proxy-adapter.js`, no internal modules, no CLI shell-out.

### Homebrew Mirror Drift Guard

- `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` now track the current release version, enforced by `homebrew-mirror-contract.test.js`.
- Fixed stale mirror that claimed v2.1.1 while the canonical tap served v2.9.0.

### Runner/Live-Proof Contract Corrections

- Fixed `writeDispatchBundle` signature drift in public runner docs and planning specs.
- Documented `acceptTurn()` cleanup behavior: dispatch and staging directories are removed after commit.
- Live-proof spec corrected to reflect two-phase validation (pre-accept dispatch/staging, post-accept state/history/ledger).

### Model Tier Retry Budget Warning

- New `adapters.mdx` section documenting that cheaper models may require governed retries for schema-conformant output, with concrete cost implications per model tier.
- Code-backed guard reads `COST_RATES` from `api-proxy-adapter.js` and enforces that all documented models exist in the pricing table.

### Evidence

- 659 Vitest tests (36 files) + 1640 node --test (372 suites), 0 failures.
- Live governed proof verified against real Anthropic API.
- Website production build passes.

## 2.9.0

Runner layer: declared interface, ergonomic improvements, second-runner proof, public docs, and authenticated dashboard gate approvals. The protocol's runner-independence claim is now backed by a real second runner that imports the library boundary with zero CLI shell-out.

### Runner Interface (v0.2)

- New declared runner contract module (`runner-interface.js`) re-exports protocol-normative operations for any governed execution consumer: CLI, CI, hosted, or programmatic.
- Interface includes lifecycle operations (init, assign, accept, reject, approve gates, escalate, reactivate), dispatch/staging support, hooks, notifications, concurrency locks, and config utilities.
- `getTurnStagingResultPath` exported so runners can stage turn results without importing internal modules directly. Added in v0.2 after boundary leak was identified.
- Interface version `0.2` — incremented per the versioning rule when surface-expanding operations are added.
- New docs page: `/docs/runner-interface` with code-backed guard, cross-linked from CLI, quickstart, and protocol docs.

### Assign Turn Ergonomics

- `assignGovernedTurn()` success now returns the assigned `turn` at top level (`{ ok, state, turn }`), eliminating the need for consumers to recover the turn from `state.active_turns`.
- Failed assignments do not fabricate a `turn: null` — absence means failure.
- Real consumer updated: `coordinator-dispatch.js` uses `assignResult.turn` directly.

### CI Runner Proof

- New `examples/ci-runner-proof/run-one-turn.mjs` — standalone second runner that imports only `runner-interface.js` and executes one governed turn (init → assign → stage → accept) with artifact validation.
- Proof validates post-acceptance artifacts: `state.json` (SHA256 + structure), `history.jsonl` (entry count + fields), `decision-ledger.jsonl` (entry count).
- Dedicated GitHub Actions workflow (`ci-runner-proof.yml`) runs the proof on every push to main and on PRs.
- 13-test contract guard enforces: no `child_process` import, no CLI binary references, no `turn-paths.js` direct import, runner-interface.js import present, script exit 0 with valid JSON.

### Dashboard Gate Approvals

- Dashboard is no longer read-only. Operators can now approve pending phase transitions and run completions directly from the dashboard UI.
- `POST /api/actions/approve-gate` with per-process token auth via `X-AgentXchain-Token` (timing-safe comparison).
- `GET /api/session` delivers the local auth token.
- WebSocket remains strictly read-only — mutations are HTTP-only.
- Blocked-state recovery stays CLI-only. Gate approval and recovery are categorically different authority models.

### Evidence

- 659 Vitest tests (36 files) + 1621 node --test (366 suites), 0 failures.
- CI runner proof passes with runner interface v0.2.
- Website production build passes.

## 2.8.0

Governance reporting and protocol surface hardening. Operators can now generate human-readable governance reports from export artifacts, and the protocol reference boundary is formally documented with normative/non-normative separation.

### Governance Report Command

- New `agentxchain report` command produces governance summaries from verified export artifacts.
- Three output formats: `text` (terminal), `json` (automation), `markdown` (PRs, releases, audit records).
- Reports verify the export artifact first and fail closed — invalid artifacts never produce success summaries.
- Governed run reports summarize project identity, run status/phase, blocked state, turn counts, budget utilization, and evidence counts.
- Coordinator workspace reports summarize workspace identity, repo/workstream/barrier counts, repo status histogram, and per-repo export health.
- Report contract version `0.1` with stable `subject.kind` discrimination (`governed_run` / `coordinator_workspace`).
- New docs page: `/docs/governance-report`.

### Protocol Reference Boundary

- Formalized the normative/non-normative boundary for protocol v6.
- `PROTOCOL-v6.md` is the canonical normative reference. CLI command names, dashboard UX, provider adapters, and notifications are explicitly non-normative.
- New docs page: `/docs/protocol-reference` with code-backed guard tests reading source constants.

### Conformance Naming Canonicalization

- Fixed the sole naming mismatch in conformance fixtures: `turn_result` renamed to `turn_result_validation` across all 53 fixtures, 9 surfaces, 3 tiers.
- 71-test guard enforces fixture-to-source naming alignment.

### Export Schema Reference

- New docs page: `/docs/export-schema` documenting the export artifact schema (v0.2), both export kinds, file-entry integrity fields, and nested coordinator contract.
- `verify export --format json` report shape now documented: success/failure fields and command-error shape.
- Code-backed guard builds real exports and verifies docs mention actual output keys.

### Evidence

- 654 Vitest tests (36 files) + 1586 node --test (354 suites), 0 failures.
- Website production build passes.

## 2.7.0

Governed lifecycle integrations. Operators can now receive real-time notifications on governed lifecycle events, raise first-class escalations, and reference a complete operator recovery map — closing the workflow-kit and beginning the integration layer.

### Governed Notification Contract

- New top-level governed config surface: `notifications.webhooks`. Notifications are orchestrator-emitted lifecycle events, not hook side effects.
- Webhook transport delivers JSON payloads on governed transitions: `run_blocked`, `operator_escalation_raised`, `escalation_resolved`, `phase_transition_pending`, `run_completion_pending`, `run_completed`.
- Delivery is best-effort and never blocks governed execution.
- All delivery attempts are recorded in `.agentxchain/notification-audit.jsonl` — included in `agentxchain export` and verified by `agentxchain verify export`.
- New docs page: `/docs/notifications`.

### Operator Escalation Surface

- New `agentxchain escalate` command for operator-raised escalations with structured metadata.
- Escalation persists `blocked_on = escalation:operator:*` with `typed_reason = operator_escalation`, distinct from retry-exhaustion blocks.
- `resume` now truthfully recovers blocked governed runs: retained blocked turns are re-dispatched, run-level blocks are reactivated.
- Escalation raise and resolution are recorded in `.agentxchain/decision-ledger.jsonl` as `operator_escalated` and `escalation_resolved` decisions.

### Recovery Surface Closure

- Formal recovery analysis confirmed all 9 `typed_reason` values have explicit recovery paths through existing commands (`step`, `resume`, `approve-transition`, `approve-completion`, `escalate`).
- A dedicated `agentxchain recover` command was explicitly rejected: no unrecoverable states exist, and a catch-all command would duplicate logic that drifts.
- New docs page: `/docs/recovery` with the complete operator recovery map, backed by code-guard tests reading `blocked-state.js` and `governed-state.js`.

### Evidence

- 654 Vitest tests (36 files) + 1480 node --test (340 suites), 0 failures.
- Website production build passes.

## 2.6.0

Auditable export artifacts. Governed runs and coordinator workspaces can now be exported as self-verifiable JSON artifacts with embedded content, integrity hashes, and an independent verification command.

### Governed Run Export

- New `agentxchain export` command produces a deterministic JSON snapshot of all governed audit artifacts: config, state, history, decision ledger, hook audit/annotations, dispatch artifacts, staging artifacts, acceptance transaction journals, and intake artifacts.
- Each file entry includes `content_base64`, `bytes`, and `sha256` so the artifact is independently re-derivable without access to the original repo.
- Export schema version `0.2`. Output to stdout by default or to a file via `--output <path>`.
- Legacy (non-governed) projects and unsupported formats fail closed.

### Coordinator Workspace Export

- `agentxchain export` from an `agentxchain-multi.json` root produces `export_kind: "agentxchain_coordinator_export"` with recursively embedded child repo governed exports.
- Detection order: governed project first, coordinator workspace second.
- Child repo export failures do not fail the coordinator export — each child entry has `ok: boolean` with error details when false.
- Pre-init coordinator workspaces (no `.agentxchain/multirepo/`) export successfully with null summary fields.
- Coordinator-level files: config, state, barriers, history, decision ledger, barrier ledger.

### Export Verification

- New `agentxchain verify export <file>` command validates export artifact integrity.
- Verifies JSON structure, schema version, file entry completeness, `content_base64` → `sha256` re-derivation, and `bytes` consistency.
- Coordinator verification recurses into child repo exports.
- Exit codes: `0` pass, `1` integrity/structure fail, `2` input/command error.

### Evidence

- 652 Vitest tests (36 files) + 1437 node --test (327 suites), 0 failures.
- Website production build passes.

## 2.5.0

Remote MCP transport. Governed agents can now run over network via streamable HTTP, completing the MCP connector story for both local and remote deployment.

### Remote MCP Transport (streamable HTTP)

- New `streamable_http` transport for the `mcp` runtime type. Governed MCP agents can now run over HTTP in addition to local stdio.
- Transport selection via `transport` config field (defaults to `stdio`). Remote mode requires an absolute `http` or `https` `url`.
- Optional static `headers` map for remote requests (API keys, auth tokens, custom metadata).
- Config validation enforces mode-specific fields: stdio rejects `url`/`headers`, remote rejects `command`/`args`/`cwd`.
- `step` command prints the real transport target (stdio command vs HTTP URL) instead of hard-coding stdio.
- Documented `Accept: application/json, text/event-stream` requirement for streamable HTTP servers.

### Remote MCP Example

- New `examples/mcp-http-echo-agent/` reference server: stateless streamable HTTP MCP server implementing the same 13-argument `agentxchain_turn` tool contract as the stdio variant.
- Configurable port (`--port` flag or `PORT` env), `/mcp` endpoint, 404/405 for invalid paths/methods.
- Contract test proves: tool name parity, argument parity, `structuredContent` return, live MCP initialize response, docs coverage.
- Governed dispatch proof uses the real shipped HTTP example server as a subprocess, not an inline mock.

### Docs

- Adapter deep-dive updated with `streamable_http` config, transport comparison table (stdio vs HTTP examples), remote headers, and SSE non-support.
- Governed-todo-app README documents both stdio and remote MCP wiring paths with complete config examples.

### Evidence

- 652 Vitest tests (36 files) + 1394 node --test (317 suites), 0 failures.
- Website production build passes.

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
