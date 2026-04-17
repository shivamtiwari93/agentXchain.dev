# Changelog

## 2.127.0

### Adapter Dispatch Progress Tracking

- **Per-turn dispatch progress:** every adapter dispatch (local_cli, api_proxy, mcp, remote_agent) now emits structured progress to a per-turn file (`dispatch-progress-<turn_id>.json`). `agentxchain status` renders an Activity line showing whether the adapter is producing output, silent, or waiting for an API response. Dashboard `/api/state` and timeline view consume the same signal. (`DEC-DISPATCH-PROGRESS-001`, `DEC-DISPATCH-PROGRESS-002`, `DEC-DISPATCH-PROGRESS-003`)
- **Parallel dispatch isolation:** progress files are keyed by turn_id so parallel dispatch (`max_concurrent_turns > 1`) never clobbers another turn's progress data. Previously all turns shared a single file.
- **E2E parallel dispatch proof:** real governed integration test with `max_concurrent_turns=2` verifies distinct per-turn progress in both `status --json` and `readAllDispatchProgress()` during concurrent in-flight dispatch. (`DEC-PARALLEL-PROGRESS-PROOF-001`)
- **Coarse event milestones:** `dispatch_progress` events emitted to `events.jsonl` at start, completion, failure, timeout, and output-resumed milestones — not per output line.

### Evidence

- 5,586 tests / 1,170 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.126.0

### Turn Timeout Enforcement & Budget Visibility

- **In-flight dispatch timeout enforcement:** governed `run` / `runLoop` now enforce the existing `timeouts.per_turn_minutes` contract during adapter dispatch instead of only detecting timeout drift at acceptance or status boundaries. When `action: "escalate"` is configured, hung automated turns block cleanly with retained active-turn context and timeout ledger evidence. (`DEC-RUN-DISPATCH-TIMEOUT-001`)
- **Operator timeout budget visibility:** `agentxchain status`, `agentxchain turn show`, and the dashboard timeout-status endpoint now surface remaining budget, deadline, and exceeded state for all configured timeout scopes so operators can tell "still running with budget left" from "over budget" without opening `agentxchain.json`. (`DEC-TIMEOUT-BUDGET-VISIBILITY-001`)
- **Timeout docs updated:** the public timeouts guide now documents dispatch-time enforcement plus the budget display contract on CLI and dashboard surfaces.
- **Release notes sidebar normalization:** duplicate `sidebar_position` values in older release docs were normalized so Docusaurus keeps newest-first release ordering stable.

### Evidence

- 5,568 tests / 1,158 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.125.0

### Connector Validation & Onboarding

- **`connector validate` command:** New command that proves a runtime+role binding produces valid governed turn results in an isolated scratch workspace. Supports `local_cli`, `api_proxy`, `mcp`, and `remote_agent` adapters. Manual runtimes are rejected. Scratch workspace prevents live repo mutation during validation. (`DEC-CONNECTOR-VALIDATE-001`, `DEC-CONNECTOR-VALIDATE-002`, `DEC-CONNECTOR-VALIDATE-003`)
- **Front-door guidance updated:** `init --governed`, `doctor`, and `getting-started` docs now recommend `connector validate <runtime_id>` after `connector check` — the full onboarding sequence is now `doctor → connector check → connector validate → run`. (`DEC-FRONTDOOR-VALIDATE-GUIDANCE-001`)
- **Integration guides aligned:** All 20 integration guides updated to include `connector validate` in the onboarding sequence. (`DEC-INTEGRATION-VALIDATE-001`)
- **Flag alignment test fix:** `extractBinFlags()` now prefers `program.command()` matches over subcommand matches, fixing a false positive when a subcommand shares a name with a top-level command.

### Evidence

- 5,557 tests / 1,156 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.124.0

### Operator Adoption Quality

- **Governed init cold-start truth:** `init --governed` now prints the actual scaffold that was generated — correct runtime summary, correct routing label, correct next-step guidance. Manual-only scaffolds now explicitly say to use `agentxchain step` first.
- **Manual template correctness:** The `step` command's turn-result template now uses the turn assignment's `runtime_id` (not a hardcoded fallback) and respects the current phase's `allowed_next_roles` for `proposed_next_role`.
- **Phase handoff guidance:** `approve-transition` now warns when the next authoritative turn would fail the clean-baseline rule, with exact checkpoint instructions. Manual turn examples are now phase-aware and write-authority-aware.
- **Authoritative artifact validation:** Authoritative roles with non-empty product `files_changed` can no longer claim `artifact.type: "review"`. The validator rejects the mismatch with a clear error directing the operator to use `"workspace"` or `"commit"`.
- **Intake completed-run restart:** `agentxchain intake start --restart-completed` now exposes the engine's existing terminal-restart capability on the public CLI surface, replacing the nonexistent `init --force` guidance.

### Evidence

- 5,493 tests / 1,154 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.123.0

Live continuous 3-run proof published, Homebrew mirror CI simplified (removed dead PR fallback), and continuous mode error messages improved.

- Live continuous 3-run proof: published end-to-end evidence for three consecutive governed continuous runs with real-model execution and deploy/distribution results (`DEC-LIVE-CONTINUOUS-3RUN-001`)
- Homebrew mirror CI: removed dead PR fallback path from `publish-npm-on-tag.yml`, simplifying the token selection to direct-push only (`DEC-HOMEBREW-MIRROR-SIMPLIFY-001`)
- Continuous mode error messages: improved error diagnostics for continuous mode failures to surface actionable context instead of generic stack traces
- Release docs and deploy/distribution results recorded for v2.122.0
- 5,481 tests / 1,153 suites / 0 failures

## 2.122.0

`2.122.0` ships public live-proof evidence for the mixed-runtime continuous run contract and fixes the Homebrew mirror sync workflow so the release pipeline tries the repo-scoped workflow token before falling back to an unmergeable PR.

- Live mixed-runtime continuous proof docs: the examples docs now publish the real `run-continuous-mixed-proof.mjs` evidence with command, runtime shape, model, session outcome, review artifact, and spend so the public proof surface matches the shipped harness (`DEC-LIVE-CONTINUOUS-PROOF-001`, `DEC-LIVE-CONTINUOUS-PROOF-002`)
- Homebrew mirror direct-push fix: `publish-npm-on-tag.yml` now tries `REPO_PUSH_TOKEN`, then `GITHUB_TOKEN`, then `HOMEBREW_TAP_TOKEN` when syncing `cli/homebrew/*`, instead of skipping the repo-scoped workflow token and falling back to a PR that cannot self-merge (`DEC-HOMEBREW-MIRROR-DIRECT-PUSH-001`)
- Release docs + marketing drafts updated to carry the truthful mixed-runtime proof story and v2.122.0 downstream release surfaces
- 5,483 tests / 1,153 suites / 0 failures

## 2.121.0

`2.121.0` ships orchestrator state files allowlist fix, export/restore continuity preservation, live-adapter dogfood proof, and the lights-out operator runbook.

- Orchestrator state allowlist: added `.agentxchain/continuous-session.json`, `.agentxchain/human-escalations.jsonl`, `.agentxchain/sla-reminders.json` to `ORCHESTRATOR_STATE_FILES` — fixes false-positive artifact mismatch rejections for `review_only` roles in continuous mode (`DEC-ORCHESTRATOR-STATE-FILES-001`)
- Export/restore continuity: all three orchestrator state files now round-trip through `agentxchain export` and `agentxchain restore`, preserving blocked continuous recovery state across workspaces (`DEC-CONTINUITY-EXPORT-001`)
- Live-adapter dogfood proof: first real-model continuous mode execution with Anthropic Haiku 4.5 via `api_proxy` — 16 API calls, $0.208 spent, all turns accepted by governance (`DEC-LIVE-DOGFOOD-001`)
- Lights-out operator runbook: new cohesive guide covering preflight, bounded proof run, daemon launch, observation, blocked recovery, priority injection, budget stops, and SIGINT behavior (`DEC-LIGHTS-OUT-DOCS-001`)
- 5,478 tests / 1,152 suites / 0 failures

## 2.120.0

`2.120.0` ships continuous failure recovery hardening, paused-session re-entry guards, and multi-schedule continuous coexistence proof.

- Continuous failure recovery: `advanceContinuousRunOnce()` now classifies governed-run outcomes by state-machine truth — `priority_preempted` no longer counts as a completed run, blocked governed results pause the session, and non-blocked failures fail the session without resolving the executing intent (`DEC-CONT-FAILURE-001`)
- Paused-session guard: a paused continuous session no longer re-enters the intake pipeline — the guard checks governed state on every poll, returns `still_blocked` while blocked, and resumes with direct `executeGovernedRun()` continuation when unblocked (`DEC-CONT-PAUSED-GUARD-001`)
- SIGINT semantics fix: first SIGINT in `executeGovernedRun()` now means "finish current in-flight work then stop", not "abort active dispatch" (`DEC-RUN-SIGINT-001`)
- Multi-schedule continuous coexistence: sibling `continuous.enabled` schedules are excluded from the normal `runDueSchedules()` path during daemon operation, preventing ownership model violations (`DEC-SCHEDULE-CONTINUOUS-003`)
- Daemon failure recovery E2E: `AT-SCHED-CONT-FAIL-001` proves schedule-owned session block/unblock lifecycle through the full daemon subprocess
- Multi-schedule E2E: `AT-SDH-011` proves two continuous schedules coexist with correct selection, session ownership, and sequential completion
- 5,470 tests / 1,150 suites / 0 failures

## 2.119.0

`2.119.0` ships session-level budget enforcement for continuous mode, adapter-level continuous E2E proof, and api_proxy prompt contract hardening.

- Session-level budget enforcement: `per_session_max_usd` config and `--session-budget` CLI flag cap cumulative spend across an entire continuous session. Pre-run budget gate stops cleanly with `session_budget_exhausted`. Schedule-owned sessions persist distinct `continuous_session_budget_exhausted` status. Invalid budget values fail closed (`DEC-CONT-BUDGET-001`, `DEC-CONT-BUDGET-002`)
- Continuous api_proxy E2E: `AT-CONT-APIPROXY-001/002` prove continuous mode through the real api_proxy adapter pathway with a mock Anthropic HTTP server, mixed adapter setup, vision provenance, and real intake lifecycle (`DEC-CONT-APIPROXY-PROOF-001`)
- API proxy prompt contract hardening: integration test mocks now parse markdown-formatted dispatch bundles (`**Run:**`, `**Turn:**`, `**Phase:**`) instead of accidental JSON fragments. Tests fail closed on fallback defaults (`DEC-APIPROXY-PROMPT-CONTRACT-001`)
- Docs updated: CLI reference, lights-out scheduling, and recovery docs cover session-level budget enforcement
- 5,463 tests / 1,149 suites / 0 failures

## 2.118.0

`2.118.0` ships schedule-owned continuous mode — the daemon can now own a persistent vision-driven continuous session, advance governed runs one step per poll, and keep repo-local lights-out execution on one shared continuous-step contract.

- Schedule-owned continuous mode: `schedules.<id>.continuous` enables daemon-managed vision-driven execution with validated `vision_path`, `max_runs`, `max_idle_cycles`, and `triage_approval` (`DEC-SCHEDULE-CONTINUOUS-001`)
- Shared step primitive: both `run --continuous --vision <path>` and `schedule daemon` continuous mode now use `advanceContinuousRunOnce(...)`, so CLI-owned and daemon-owned continuous execution cannot drift semantically (`DEC-SCHEDULE-CONTINUOUS-001`)
- Multi-entry selection fix: daemon continuous selection is now active-owner-first, then due-entry-first, preventing declaration-order starvation when more than one schedule enables continuous mode (`DEC-SCHEDULE-CONTINUOUS-002`)
- Schedule-state truthfulness: `.agentxchain/schedule-state.json` now persists `last_continuous_session_id` through the normalizer path instead of silently dropping it (`DEC-SCHEDULE-STATE-NORMALIZER-001`)
- Docs updated: CLI reference and lights-out scheduling docs now cover schedule-owned continuous mode, ownership metadata, blocked recovery, and priority-preemption semantics
- 5,449 tests / 1,141 suites / 0 failures

## 2.117.0

`2.117.0` ships vision-driven continuous mode — fully autonomous lights-out operation where agents derive work from a project's `VISION.md`, execute governed runs back-to-back, and complete all three HUMAN-ROADMAP items for full-auto operation.

- Vision-driven continuous mode: `agentxchain run --continuous --vision <path>` reads VISION.md, derives candidate work from unaddressed goals, seeds the intake pipeline, and chains governed runs autonomously. Vision path is always project-relative, never hardcoded. Session state persists to `.agentxchain/continuous-session.json` and is visible via `agentxchain status` (`DEC-VISION-CONTINUOUS-001`)
- Real intake lifecycle consumption: continuous mode uses `planIntent` -> `startIntent` -> `resolveIntent` for proper provenance. No orphaned intents (`DEC-VISION-CONTINUOUS-002`)
- First-class continuous provenance: `trigger: "vision_scan"` and `created_by: "continuous_loop"` are valid provenance values (`DEC-VISION-CONTINUOUS-003`)
- Human escalation events: `human_escalation_raised` and `human_escalation_resolved` promoted to `events.jsonl` and webhook notification fan-out. Non-webhook local notifier floor emits structured stderr notices. macOS native notification via `AGENTXCHAIN_LOCAL_NOTIFY=1` (`DEC-HUMAN-ESCALATION-EVENTS-001`)
- Scheduler auto-resume on unblock: `schedule daemon` treats blocked schedule-owned runs as non-fatal wait states. After `agentxchain unblock <id>`, the daemon continues within one poll interval (`DEC-SCHEDULE-DAEMON-UNBLOCK-001`)
- Priority injection scheduler consumer: `schedule daemon` consumes `priority_preempted` by planning/starting injected p0 work into the same schedule-owned run (`DEC-INJECT-SCHEDULE-CONSUMER-001`)
- Fixed VALID_RUN_EVENTS count (14 -> 16) after human escalation event types were added
- Fixed CI API dispatch proof stderr assertion to tolerate legitimate human-escalation notices
- 5431 tests / 1136 suites / 0 failures

## 2.116.0

`2.116.0` ships mission plan autopilot — unattended lights-out execution of dependency-ordered mission plans with wave-by-wave progression, failure policies, and safety limits.

- Mission plan autopilot: `agentxchain mission plan autopilot [plan_id]` executes approved mission plans unattended. Scans for ready workstreams, launches them, records outcomes, re-scans for newly-unblocked dependents, and repeats until the plan completes or a terminal condition is hit (`DEC-MISSION-AUTOPILOT-001`)
- Wave execution model: autopilot processes dependency waves sequentially. Each wave launches all currently-ready workstreams, waits for outcomes, then re-evaluates. Reloads plan from disk between waves to pick up dependency-unblocked workstreams
- Failure policies: default fail-stop halts on first workstream failure. `--continue-on-failure` skips failed workstreams and keeps launching remaining ready work. When no ready workstreams remain but failures exist, exits `plan_incomplete` instead of misclassifying as deadlock (`DEC-MISSION-AUTOPILOT-002`)
- Safety limits: `--max-waves <n>` caps wave count (default: 10). `--cooldown <seconds>` between waves (default: 5). Deadlock detection when no workstreams are ready and none completed in the current wave
- Provenance: each autopilot-launched workstream carries `trigger: autopilot` with wave number in its launch record
- JSON output: `--json` returns full wave structure with per-wave workstream details and terminal reason
- Hardened Homebrew mirror PR closeout: re-resolves PR number from deterministic fallback branch instead of masking with `continue-on-error` (`DEC-HOMEBREW-SYNC-016`)
- 5370 tests / 1116 suites / 0 failures

## 2.115.0

`2.115.0` completes the mission plan lifecycle with auto-completion, workstream retry, and single-command mission health visibility — closing the loop from plan creation through governed recovery.

- Plan auto-completion: plans auto-transition to `completed` when all workstreams finish successfully. No separate operator command needed — happens inside `markWorkstreamOutcome`. Previously a fully-complete plan stayed `approved` forever (`DEC-MISSION-PLAN-AUTO-COMPLETE-001`)
- Workstream retry: `agentxchain mission plan launch --workstream <id> --retry` retries failed workstreams (`needs_attention` only). New chain_id, old launch record preserved for audit, new record marked `retry: true`. Plan status returns from `needs_attention` to `approved` during retry. `--retry` requires `--workstream` and is mutually exclusive with `--all-ready` (`DEC-MISSION-PLAN-RETRY-001`)
- Mission show plan health: `mission show` now surfaces latest plan ID, plan status, completion percentage, and workstream-status breakdown. `--json` exposes the same `latest_plan` summary. Shared plan-progress summarization reused by CLI and dashboard (`DEC-MISSION-SHOW-PLAN-SUMMARY-001`)
- Cascade rejected: `--cascade` explicitly rejected as scope creep. Operator cost of re-running `--all-ready` is trivial. Future unattended execution belongs in a separate `mission run --autopilot` surface (`DEC-MISSION-PLAN-LAUNCH-CASCADE-001`)
- Missions docs and CLI reference updated for retry, auto-completion, and plan health surfaces
- 5359 tests / 1114 suites / 0 failures

## 2.114.0

`2.114.0` turns mission decomposition into a one-session operator flow: mission creation can generate a proposed plan immediately, offline planner output is a real supported input, and approved plans can launch every currently-ready workstream in one fail-closed batch.

- Mission start auto-planning: `agentxchain mission start --plan` now creates the mission first, then generates exactly one `proposed` plan without weakening the approval boundary. `--constraint`, `--role-hint`, and `--planner-output-file` now flow through the same planning path, and `--json` returns `{ mission, plan }` (`DEC-MISSION-START-PLAN-001`, `DEC-MISSION-PLAN-OFFLINE-001`)
- Offline planner parity: `agentxchain mission plan --planner-output-file <path>` is now a real contract instead of fake CLI guidance. Offline planner JSON goes through the same parse and validation path as live planner output, with no second schema
- Batch workstream launch: `agentxchain mission plan launch --all-ready` launches all currently `ready` workstreams from an approved plan in plan declaration order, fails closed on the first launch failure, rejects `--all-ready` with `--workstream`, and reports zero-ready plans explicitly instead of silently succeeding (`DEC-MISSION-PLAN-LAUNCH-ALL-READY-001`)
- Missions docs + CLI reference updated for the new operational flow: `mission start --plan -> mission plan approve -> mission plan launch --all-ready`
- 5349 tests / 1112 suites / 0 failures

## 2.113.0

`2.113.0` ships mission decomposition — the governed planning layer that splits a mission goal into dependency-ordered workstreams with LLM-assisted generation, approval gates, and one-command execution through the chain runner.

- Mission decomposition: `agentxchain mission plan` generates dependency-ordered workstreams from a mission goal via LLM-assisted planning. Strict schema validation (required fields, type checking, duplicate ID detection, dependency reference validation, chain_id pre-allocation rejection). Durable plan artifacts under `.agentxchain/missions/plans/<mission_id>/`. `launch_status` derived from dependency edges at creation time. Revision by supersession. `mission plan show` and `mission plan list` for inspection
- Plan approval gate: `mission plan approve` enforces latest-only governance. Approving a newer plan supersedes older active plans. Fails closed on stale/non-proposed targets. Deterministic recency via monotonic plan IDs (`DEC-MISSION-PLAN-APPROVAL-001`, `DEC-MISSION-PLAN-RECENCY-001`)
- One-command workstream launch: `mission plan launch --workstream <id>` preallocates chain_id, executes immediately via `executeChainedRun`, reconciles workstream outcome from real run result. Dependency satisfaction based on latest run status in bound chain report. Five launch states: `ready`, `blocked`, `launched`, `completed`, `needs_attention` (`DEC-MISSION-PLAN-LAUNCH-001`, `DEC-MISSION-PLAN-LAUNCH-EXECUTION-001`)
- Dashboard plan visibility: dedicated `GET /api/plans` endpoint with `?mission=<id>` filter. Integrated into Mission view with workstream table, launch records, status breakdown. Recursive file watching for `missions/plans/**/*.json` (`DEC-DASHBOARD-PLAN-VISIBILITY-001`, `DEC-DASHBOARD-PLAN-API-001`)
- Missions docs update: `/docs/missions` now covers the full decomposition flow — plan artifacts, approval, launch, dashboard visibility, and immediate-execution boundary (`DEC-MISSIONS-DOCS-DECOMPOSITION-001`)
- Protocol v7/v8 boundary audit: all post-v7 features (mission hierarchy, plans, dashboard) confirmed as reference-runner advisory — zero conformance surface changes (`DEC-PROTOCOL-V8-NO-BUMP-001`)
- 5339 tests / 1110 suites / 0 failures

## 2.112.0

`2.112.0` ships single-repo mission hierarchy — the governed layer above chained runs that groups related chains under named missions with aggregate status, cross-chain decision carryover, and dashboard visibility.

- Single-repo mission hierarchy: `agentxchain mission start`, `mission list`, `mission show`, `mission attach-chain` with durable mission artifacts under `.agentxchain/missions/`. Mission snapshots derive chain count, total runs/turns, latest chain terminal reason, active repo-decision count, and derived status (`planned`, `progressing`, `needs_attention`, `degraded`)
- Mission auto-binding during chained execution: `run --chain --mission <id>` or `--mission latest` auto-attaches chain reports to the target mission. Config-driven via `run_loop.chain.mission`. Explicit mission IDs fail closed if missing; `--mission latest` warns but continues chaining
- Dashboard mission visibility: dedicated `Mission` view backed by `GET /api/missions` with latest mission identity/goal, derived status, aggregate totals, active repo-decision count, and attached-chain lineage. Dependency-owned invalidation ensures chain-report changes refresh both `Chain` and `Mission` views
- Release-alignment unification: `release-preflight.sh` now validates surfaces through the shared `check-release-alignment.mjs` manifest. Three test files deduplicated to import evidence extraction from `cli/src/lib/release-alignment.js` instead of maintaining local copies
- Dashboard app view set test fixed to include `Mission` view registration
- Decision noun boundary frozen: `mission` is single-repo multi-chain grouping; `initiative` is multi-repo coordinator orchestration (`DEC-MISSION-HIERARCHY-001`)
- 5273 tests / 1095 suites / 0 failures

## 2.111.0

`2.111.0` ships run chaining for lights-out operation, a dedicated chain CLI operator surface, and dashboard chain visibility — closing the loop from runtime to first-glance observability for continuous governed execution.

- Run chaining (`agentxchain run --chain`): auto-continues governed runs on chainable terminal status with configurable max chains, chain-on statuses, and cooldown. Composes existing primitives (`--continue-from`, `--inherit-context`) without new state machine states. Chain reports written to `.agentxchain/reports/chain-*.json` with per-run lineage, provenance triggers, and inherited-context summaries
- Three runtime bugs fixed in chaining: illegal provenance + continue-from combination, off-by-one chain counting, SIGINT listener leak across chained invocations
- Chain CLI operator surface: `agentxchain chain latest`, `chain list`, `chain show` with `--json` support. Dedicated command family above individual run history
- Dashboard chain visibility: dedicated `Chain` view backed by `GET /api/chain-reports`, file-watcher invalidation, latest chain summary + per-run lineage + recent chain sessions table
- Gate-action timeout evidence in `run diff` and `export diff`: fixed `[object Object]` rendering bug in `formatValue`, added cause-aware gate regression messages
- Product-boundary truth hardened: MetaGPT compare page corrected, regression guard expanded to all compare pages with hosting rows
- Integration guide cost-rate key fix: 6 guides corrected from `input_per_million`/`output_per_million` to `input_per_1m`/`output_per_1m` matching code contract
- Cost-rate override documentation normalized: all non-bundled model examples now explicitly framed as operator overrides
- 5246 tests / 1087 suites / 0 failures

## 2.110.0

`2.110.0` closes the gate-action timeout parity gap: every operator-facing surface now distinguishes timed-out gate actions from generic failures, and dry-run previews show custom timeout configuration.

- Gate-action timeout parity: `status`, `report` (text/markdown/HTML), dashboard blocked view, and dashboard gate review now show "timed out after Nms" instead of generic "failed" when a gate action hits its timeout
- Per-action `timeout_ms` support (1s–1hr, default 15min) with structured timeout evidence in blocked-reason payload and decision ledger
- Workspace boundary frozen: gate actions execute in the repo root with workspace write access, documented explicitly in spec and operator guide
- Dry-run timeout preview: `--dry-run` shows custom timeout configuration for actions that override the 15-minute default
- 9 gate-action tests + 2 dashboard E2E + 10 docs tests = 21 tests / 0 failures
- 5177 tests / 1073 suites / 0 failures

## 2.109.0

`2.109.0` ships governed gate actions as a complete operator surface — runtime execution, CLI dry-run, dedicated docs page, dashboard visibility with gate-type-correct recovery — and hardens the release pipeline for rerun safety.

- Gates can now own post-approval automation commands via `gate_actions` on `gates.<gate_id>`, with per-action exit-code tracking, structured failure evidence in the decision ledger, and automatic run-blocking on failure
- `approve-transition --dry-run` and `approve-completion --dry-run` preview configured gate actions without executing them
- New `/docs/gate-actions` operator guide covering config syntax, execution semantics, dry-run, failure/retry model, environment variables, and decision-ledger evidence
- Dashboard gate-action visibility: pending gates show configured actions, blocked states show full failure detail including per-action status, exit codes, stderr tail, and gate-type-correct dry-run recovery hints
- E2E dashboard proof using real CLI-produced gate-action failures, not just mocked fixtures
- Release idempotency audit: all 16 release/publish/deploy scripts verified, `publish-vscode-on-tag.yml` fixed to detect existing Marketplace publications
- Approval SLA reminder notifications for stale pending approvals
- Timeout pressure surfaced during approval waits
- Conflict-loop recovery UX parity across all operator surfaces
- 5166 tests / 1073 suites / 0 failures

## 2.108.0

`2.108.0` turns conflict observability into a first-class operator surface instead of scattering it across state files, dashboard guesses, and notification drift.

- Conflict decisions now surface in governed reports, so accepted-turn overlap shows up in the real operator narrative instead of hiding in raw ledger fields
- `turn_conflicted` is now a durable lifecycle event in `.agentxchain/events.jsonl`, not just an in-process callback detail
- The dashboard timeline now reads `/api/events?type=turn_conflicted&limit=10` and renders conflict metadata directly in the Timeline view
- Conflict-loop exhaustion now emits the missing `run_blocked` notification with `category: conflict_loop`, while intermediate conflict detections remain observability-only to avoid webhook noise
- `agentxchain events --type turn_conflicted` now renders inline conflict details including overlapping files, overlap percentage, detection count, and accepted-since turn IDs
- 5164 tests / 1072 suites / 0 failures

## 2.107.0

`2.107.0` brings behavior-level proof parity to the social-post wrappers and removes artificial delay from the X/Twitter fixture path so that proof stays cheap enough to run.

- Added `cli/test/linkedin-posting-script.test.js`, an executable fixture suite that spawns the real LinkedIn wrapper through fake `li-browser` and `python` binaries across clean-success, ambiguous-submit, fallback, and profile-selection paths
- Added `.planning/LINKEDIN_POSTING_TRUTH_BOUNDARY_SPEC.md` to freeze the LinkedIn wrapper's verified-success, fail-closed, and retry-boundary contract
- `cli/test/x-posting-script.test.js` now patches the wrapper's retry sleep to `0` inside the fixture, cutting behavior-proof wall clock without weakening the fallback control-flow contract
- Both X/Twitter and LinkedIn posting wrappers are now covered by behavior-level proof instead of content-only shell assertions
- 5069 tests / 1054 suites / 0 failures

## 2.106.0

`2.106.0` hardens social-post verification so ambiguous X/Twitter submits are only treated as success when publication is actually proven.

- `post-twitter.sh` now verifies ambiguous submits on both the primary attempt and the opposite-profile fallback attempt before reporting success
- X/Twitter timeline verification is now pipefail-safe and no longer loses real matches to `grep -q` early-exit behavior
- Snippet extraction now trims leading/trailing whitespace in both `post-twitter.sh` and `post-linkedin.sh`, closing end-of-post false negatives in the mirrored verification helper
- New behavior-level shell proof in `cli/test/x-posting-script.test.js` exercises the exact exit-status and call-order contract for verified/unverified primary and fallback paths
- 5061 tests / 1053 suites / 0 failures

## 2.105.0

`2.105.0` tightens public comparison truth and hardens the release identity path so tagged cuts carry the required commit trailer.

- Comparison pages now acknowledge the current official runtime capabilities of CrewAI, LangGraph, AG2/AutoGen, Devin, OpenHands, MetaGPT, and the OpenAI Agents SDK instead of leaning on stale shorthand
- The competitive positioning matrix and compare-specific docs/tests now freeze those truth boundaries, so future edits have to keep the contrast on repository-delivery governance rather than denying competitor runtime features
- `release-bump.sh` now requires `--coauthored-by`, writes the `Co-Authored-By:` trailer into the release commit body, and verifies that trailer before creating the annotated tag
- Release-path drift guards were repaired around coordinator blocker output, multi-repo approval phrasing, remote-agent connection-failure handling, and the restore README boundary
- 5054 tests / 1052 suites / 0 failures

## 2.104.0

`2.104.0` closes a workflow-kit recovery gap and hardens the tagged publish gate around the actual workflow contract.

- New governed recovery command: `agentxchain generate planning` restores scaffold-owned planning artifacts without re-running `init`
- Shared planning-artifact builder now keeps `init` and `generate planning` on one source of truth for governed baseline files, template files, and workflow-kit placeholders
- New release-gate proof: tagged publish verification now includes `release-docs-content.test.js`, so workflow-contract regressions fail before npm publish instead of slipping past the narrowed gate
- CLI, README, and quickstart docs now surface `generate planning` as the scaffold recovery path
- 4710 tests / 1004 suites / 0 failures

## 2.103.0

- Decision authority now enforces repo-decision overrides through the real governed acceptance path instead of comparing against an undefined overriding role
- Config validation rejects invalid `decision_authority` values outside integer `0..99`
- Dispatch context, export verification, and governance reports now preserve authority metadata for active repo decisions
- `agentxchain role show` prints configured decision authority and new regression coverage proves context, CLI, export, and acceptance-path behavior
- 4698 tests / 1003 suites / 0 failures

## 2.102.0

- Named benchmark workload catalog: baseline, stress, completion-recovery, phase-drift
- Workload discovery subcommand: `benchmark workloads` with topology metadata
- Phase-drift workload triggers real regression detection (REG-PHASE-ORDER-001)
- Completion-recovery workload proves gate-failure recovery path
- Durable benchmark artifacts via `--output <dir>`
- Topology-aware config generation from workload phase specs
- Admission control cleanup: pre-run dead-end config rejection
- 4675 tests / 1000 suites / 0 failures

## 2.101.0

- Phase-aware governance regression detection: exports embed workflow_phase_order, diff detects backward phase movement
- 4624 tests / 986 suites / 0 failures

## 2.100.0

- Governance regression detection on export diffs (status, budget, gate, decisions, coordinator repo/barrier/event regressions)
- 4603 tests / 982 suites / 0 failures

## 2.99.0

`2.99.0` closes the coordinator replay event filter proof gap and adds comparison pages for competitive positioning.

- Coordinator replay roundtrip proof now exercises type, limit, and combined filters (15 checks, up from 11)
- Fixed event_type field reference in coordinator replay filter assertions
- Added 3 comparison pages: vs CrewAI, vs AutoGen, vs LangGraph
- Updated llms.txt with comparison page links and fixed stale protocol v6 reference
- 4586 tests / 978 suites / 0 failures

## 2.98.0

`2.98.0` adds export-aware diffing so operators can compare two portable audit artifacts directly, not just repo-local run-history entries.

- New CLI mode: `agentxchain diff <left_export.json> <right_export.json> --export`
- Run-export diff surfaces run/status/phase/goal/dashboard/delegation/repo-decision drift
- Coordinator-export diff surfaces barrier, repo-status, nested-export, and aggregated-event drift
- Fail-closed behavior for malformed export artifacts and mixed export kinds
- New proof: 4 export-diff acceptance tests added alongside the existing run-history diff suite
- 4586 tests / 978 suites / 0 failures

## 2.97.0

`2.97.0` delivers full replay round-trip proof: export → replay → dashboard endpoint verification for both governed runs and coordinator workspaces. Fixes a bug where empty `content_base64` entries blocked coordinator replay.

- Bug fix: `replay export` no longer rejects empty `content_base64` strings (valid for empty JSONL files)
- New proof: governed run export → replay → dashboard round-trip (10 checks)
- New proof: coordinator export → replay → dashboard round-trip (11 checks)
- 3 new tests: AT-REPLAY-REAL-006, AT-REPLAY-ROUNDTRIP-001, AT-REPLAY-ROUNDTRIP-002
- 4582 tests / 978 suites / 0 failures

## 2.96.1

`2.96.1` hardens protocol v7 conformance with 6 new reject fixtures for `parallel_turns` and `event_lifecycle`.

- 6 new reject fixtures: PT-004/005/006 (invalid max_concurrent_turns), EL-005/006/007/008 (ordering violations, missing turn_id, backwards timestamps)
- Reference adapter: `validate_event` now enforces `turn.turn_id` for turn-scoped events; `validateFixtureConfig` checks `max_concurrent_turns` bounds
- Conformance corpus: 108 fixtures / 13 surfaces (was 102)
- 4575 tests / 978 suites / 0 failures
- Conformance: 108 / 108 fixtures passing across all tiers (Tier 1: 77, Tier 2: 23, Tier 3: 8)

## 2.96.0

`2.96.0` bumps the protocol from v6 to v7, formalizing delegation chains, cross-run decision carryover, parallel turns, and event lifecycle as constitutional conformance surfaces.

- Protocol version: v6 → v7 (non-breaking upgrade)
- 21 new conformance fixtures across 4 new Tier 1 surfaces: `delegation` (8), `decision_carryover` (5), `parallel_turns` (4), `event_lifecycle` (4)
- Total conformance corpus: 102 fixtures / 13 surfaces (was 81 / 9)
- Reference adapter: added `validate_event` and `validate_event_ordering` operations
- `PROTOCOL-v7.md` normative document created
- All docs pages updated: protocol overview, reference, implementor guide, CLI, export schema, governance report, remote verification
- 4568 tests / 978 suites / 0 failures
- Conformance: 102 / 102 fixtures passing across all tiers (Tier 1: 71, Tier 2: 23, Tier 3: 8)

## 2.95.0

`2.95.0` adds `agentxchain replay export` for offline post-mortem dashboard analysis of completed governed runs.

- New `agentxchain replay export <file>` command starts the dashboard serving a completed export snapshot
- Dashboard replay mode: read-only, no gate approval, no file watcher, session reports `replay_mode: true`
- Marketing scripts: Chrome contention preflight checks for LinkedIn and Reddit posting
- 4523 tests / 978 suites / 0 failures
- node --test cli/test/replay-export.test.js — 7 tests / 1 suite / 0 failures

## 2.94.0

`2.94.0` turns delegation acceptance contracts into a machine-checkable governance surface.

- Delegations may now declare `required_decision_ids` so a parent can require specific `DEC-NNN` outputs from child turns
- Child delegation context and parent review context now surface required, satisfied, and missing decision IDs
- Delegation review turns are blocked from phase transition or run completion while required child decisions are still missing
- Export and governance report delegation summaries now preserve required/satisfied/missing decision contract state
- 4471 tests / 963 suites / 0 failures
- Targeted delegation, export, and report test slices pass; Docusaurus build clean

## 2.93.0

`2.93.0` adds HTML governance reports for enterprise compliance and proves cross-run decision carryover.

- `agentxchain report --format html` and `agentxchain audit --format html` produce self-contained HTML governance reports with inline CSS, dark mode, print styles, and status badges
- Cross-run decision carryover proof script validates repo-durable decisions persist and override across runs
- 4465 tests / 958 suites / 0 failures

## 2.92.0

`2.92.0` composes parallel turns with delegation chains — delegation children targeting different roles now execute concurrently, with symmetric observation attribution for concurrent authoritative turns.

- Delegation children targeting different roles dispatch concurrently when `max_concurrent_turns > 1`; same-role delegations remain sequential; review turns always execute alone
- `local_cli` adapter now passes `AGENTXCHAIN_TURN_ID` env var to spawned agents so parallel agents can identify their specific turn
- Run-loop slot-filler now breaks out of filling when a delegation review turn is assigned, and blocks alternate-role fallback when delegation queue is active
- Concurrent observation attribution hardened: `attributeObservedChangesToTurn()` accepts staged sibling declarations for pre-attribution, reverse-linked concurrent siblings recognized symmetrically
- Parallel delegation CLI proof (`run-parallel-delegation-proof.mjs`) exercises concurrent dispatch, different turn IDs, and review aggregation
- 4436 tests / 951 suites / 0 failures

## 2.91.0

`2.91.0` turns the governed dashboard into a real operator service instead of a foreground-only convenience command.

- `agentxchain dashboard --daemon` now starts the local dashboard bridge in the background and prints the live PID + URL only after the bridge is actually listening
- The dashboard now persists `.agentxchain-dashboard.pid` and `.agentxchain-dashboard.json` so operators have a durable local session record
- `agentxchain stop` now tears down the dashboard daemon and cleans stale dashboard session artifacts instead of only handling the legacy watch path
- Dashboard CLI docs and subprocess tests now freeze the daemon lifecycle contract, duplicate-session rejection, and stop-path cleanup behavior
- 4417 tests / 947 suites / 0 failures

## 2.90.0

`2.90.0` adds a first-class `named_decisions` coordinator barrier for decision-gated synchronization that is broader and more honest than reusing `interface_alignment` for every checkpoint.

- New `named_decisions` completion barrier with `named_decisions.decision_ids_by_repo`
- Coordinator config validation now rejects missing, malformed, duplicate, or undeclared `DEC-NNN` decision requirements for named decision barriers
- Barrier bootstrap, acceptance projection, and recovery now preserve and recompute required decision IDs through `required_decision_ids_by_repo`
- Cross-repo context now surfaces required decision IDs and follow-ups for both `interface_alignment` and `named_decisions`
- Public multi-repo and protocol docs now describe the new barrier truthfully
- 4406 tests / 945 suites / 0 failures

## 2.89.0

`2.89.0` completes the delegation chain audit trail across all three operator surfaces: dashboard (dedicated Delegations view with durable history retention), export (`delegation_summary` in summary object), and governance report (`subject.run.delegation_summary` with text/markdown rendering). Also fixes a dispatch-contract contradiction that caused deterministic CI Runner Proof failures for proposed-authority turns.

- 4401 tests / 945 suites / 0 failures

## 2.88.0

`2.88.0` introduces delegation chains — the first hierarchical authority mechanism in the protocol. A role can decompose work, delegate sub-tasks to other roles, and review aggregated results within a single governed run. Both happy-path and failure-path proofs are included.

- 4387 tests / 940 suites / 0 failures

## 2.87.0

`2.87.0` turns the self-build case study into a real front-door adoption surface instead of a buried docs page.

- Homepage proof section now links directly to `/docs/case-study-self-build` with explicit self-build framing
- Footer `Getting Started` column now includes `Self-Build Case Study`
- Root `README.md` docs list now links to the self-build case study for GitHub-first visitors
- Added `.planning/CASE_STUDY_DISCOVERABILITY_SPEC.md` to freeze the homepage/footer/README discoverability contract
- Hardened the case-study metrics table so release and tag counts do not stale immediately after the next cut (`100+` tags, `86+` published releases)
- 4364 tests / 924 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.86.0

`2.86.0` ships a complete onboarding overhaul: manual-first generic template, init in-place auto-detection, 5-minute tutorial, and template decision guide.

- Default `generic` governed template is now manual-first — all four roles bind to manual runtimes, no API keys or local coding CLI required
- `manual-dev` is a built-in runtime so operators can rebind `dev` without inventing a new runtime entry
- `init --governed --yes` auto-detects empty git repos and scaffolds in-place instead of creating a nested subdirectory
- New `/docs/five-minute-tutorial/` page: narrative walkthrough from install to first accepted turn
- New `/docs/choosing-a-template/` page: operational decision guide for manual-first vs project-type templates
- Tutorial front-door links added to README and homepage hero
- Marketing browser wrappers hardened: LinkedIn uses isolated profile, X surfaces Chrome lock preflight
- 7 tests fixed after manual-first template change (governed-state, connector-health, status-connector-health, run-api-proxy-integration)
- 4353 tests / 922 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.85.0

`2.85.0` ships parallel turn dispatch, built-in plugin proof chains, and live multi-repo coordinator evidence.

- Run-loop now supports concurrent turn dispatch when `max_concurrent_turns > 1` — slots are filled from eligible roles, dispatched via `Promise.allSettled`, and acceptances are processed sequentially
- Fixed parallel slot-filling deadlock: alternate-role fallback from `routing.allowed_next_roles` when `selectRole` returns a duplicate
- Fixed parallel turnId targeting: dispatch callback now passes `turnId: turn.turn_id` to adapters, preventing both concurrent dispatches from targeting the same turn
- New `parallel_dispatch` event with `count` and `turns` fields for observability
- New `/docs/parallel-turns/` documentation page with config, behavior, and proof case study
- `json-report` built-in plugin: continuous subprocess E2E proof plus live product-example proof with real hook artifact validation
- `github-issues` built-in plugin: continuous subprocess E2E proof plus live proof at permanent issue #77 with GitHub API verification
- Multi-repo coordinator: live model-backed case study at `/docs/multi-repo/` with two-repo governance, barrier satisfaction, and downstream context propagation evidence
- 4330 tests / 917 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.84.0

`2.84.0` turns recent remote-governance hardening into explicit product truth: dead-end remote gate configs now warn consistently, the governed-todo-app unattended proof is workflow-backed in CI, and `api_proxy` model compatibility plus extraction behavior are documented as durable contract surfaces instead of folklore.

- `agentxchain validate` now surfaces the same config-shape warnings as `doctor` and `config --set`, including dead-end `requires_files` gates where every participating remote role is `review_only`
- `governed-todo-app` now has a workflow-backed unattended proof at `.github/workflows/governed-todo-app-proof.yml`, and the example docs/README name that CI path explicitly
- Added `cli/scripts/model-compatibility-probe.mjs` plus `.planning/MODEL_COMPATIBILITY_RESULTS.json` as a durable empirical surface for `api_proxy` + `proposed` model behavior
- Anthropic Haiku 4.5 and Sonnet 4.6 are currently recorded as reliable for `api_proxy` proposed turns; Haiku relies on fence extraction while Sonnet returns direct JSON
- `.planning/ADAPTER_CONTRACT.md`, `.planning/API_PROXY_PROPOSED_AUTHORING_SPEC.md`, and the public integration guide now freeze the load-bearing three-stage extraction pipeline and correct `api_proxy` write-authority/provider truth
- 4300 tests / 911 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.83.0

`2.83.0` makes the governed CLI front door coherent: `status` explains the active gate contract, `intake status` tells operators what to do next, and `run`, `step`, and `resume` all show run provenance plus inherited context before dispatching work.

- `agentxchain status` now expands the active pending exit gate inline with `Files:` and `Needs:` details instead of showing only opaque `pending` labels
- `agentxchain intake status` now derives and renders `next_action` guidance in both text and JSON, including blocked-state recovery commands
- `agentxchain run --continue-from/--recover-from` now prints `Origin:` in the run header, and `--inherit-context` also prints `Inherits:` with parent-run details
- `agentxchain step` now prints a run-context header before dispatch: current run, phase, provenance, inherited context, and active gate requirements
- `agentxchain resume` now prints the same run-context header before re-dispatch, closing the last governed manual-workflow parity gap
- 21 tests / 5 suites / 0 failures (focused front-door subprocess proof)
- Full CLI test suite and Docusaurus build green

## 2.82.0

`2.82.0` fixes a critical approval-gate bypass, hardens the intake pipeline, rejects scaffold placeholders in gate evaluation, sweeps all 20 integration guides for truth-boundary accuracy, and expands E2E subprocess proof.

- **Security fix**: `resume`, `step`, and `reactivate` now reject runs with pending `requires_human_approval` objects — previously these could bypass approval gates
- `intake start` unconditionally rejects paused runs, preventing state drift into the intake pipeline
- Intake context preserved across `intake start` invocations
- Gate evaluation (`section_check`, `system_spec`) rejects scaffold placeholder text; dispatch templates use schema-guided angle-bracket format
- All 20 integration guides audited: Cursor/Windsurf native connector claims removed, Jules/Bedrock factual accuracy fixed, API proxy and local_cli guides get governed bootstrap paths
- E2E release notes gate proof: `gate show --evaluate` catches placeholder release notes, lifecycle blocks on semantic failure
- E2E coordinator gate blockers proof: `multi step` surfaces `repo_active_turns`, `barrier_unsatisfied`, `repo_run_id_mismatch` with structured error output
- Coordinator recovery: `multi step` prints structured `[repo_run_id_mismatch]` with expected/actual run IDs
- Guided governed init prompts for better first-run experience
- Front-door scheduling and inspection command discoverability in README and `llms.txt`
- Fixed 33 test failures from `import.meta.url` vs `process.cwd()` repo root resolution
- 4233 tests / 897 suites / 0 failures (`cd cli && npm test`)

## 2.81.0

`2.81.0` ships historical turn replay for audit and drift detection, smarter doctor output with connector handoff hints and plugin health diagnostics.

- New `agentxchain replay turn` command: replay an accepted turn's machine-evidence commands from history for audit and drift detection
- `agentxchain doctor` now hints to run `connector check` when configured runtimes need live probing
- `agentxchain doctor` now includes plugin health diagnostics (manifest validation, hook binding checks)
- `verify turn` and `replay turn` added to both READMEs and `llms.txt` for front-door discoverability
- `PROTOCOL-v3.md` marked historical with deprecation header pointing to v6
- `post-twitter.sh` includes retry logic for intermittent X overlay failures
- 3 stale spec statuses corrected to shipped (config --get, coordinator report narrative, cross-machine restore)
- 3920 tests / 843 suites / 0 failures (`cd cli && npm test`)

## 2.80.0

`2.80.0` ships built-in plugin discovery: bundled plugins install by short name, `plugin list-available` shows what ships with the CLI, and a parity guard ensures bundled copies stay identical to source.

- New `agentxchain plugin list-available` command showing all bundled plugins with descriptions and install commands
- Short-name plugin install: `agentxchain plugin install slack-notify` resolves to the bundled copy before npm fallback
- Built-in plugins (`slack-notify`, `json-report`, `github-issues`) bundled in `cli/builtin-plugins/` and included in npm tarball
- Plugin docs updated to recommend short-name install as the primary path
- CLI docs updated with `list-available` in the plugin command table
- Bundle parity test: `AT-PLUGIN-BUILTIN-008` asserts `cli/builtin-plugins/*` stays byte-identical to `plugins/*` source trees
- Tarball proof test: `AT-PLUGIN-BUILTIN-007` validates `npm pack --json --dry-run` includes bundled plugin files
- 3902 tests / 840 suites / 0 failures (`cd cli && npm test`)
- Local release proof: builtin discovery tests, bundle parity guard, tarball inclusion proof, full test suite, clean Docusaurus build

## 2.79.0

`2.79.0` fixes built-in plugin config drift, adds dedicated plugin docs, ships a lights-out scheduling guide, and tightens docs contract boundaries.

- Fixed `plugin-slack-notify` runtime to honor `webhook_env` and `mention` config from manifest
- Fixed `plugin-json-report` runtime to honor `report_dir` config with path-escape rejection
- New dedicated docs pages for `plugin-slack-notify`, `plugin-json-report`, and `plugin-github-issues` under `/docs/plugins/`
- New lights-out scheduling guide at `/docs/lights-out-scheduling` with daemon operation, safety behavior, and operational patterns
- Fixed schedule eligibility docs to include `missing` state (fresh projects)
- Fixed lights-out docs to remove false multi-repo coordinator claim
- Fixed Reddit post formatting (`post-reddit.sh` now converts literal `\n` to real newlines)
- Fixed RVP spec drift (`--max-turns 1` → `--max-turns 5` to match shipped E2E)
- 3894 tests / 838 suites / 0 failures (`cd cli && npm test`)
- Local release proof: plugin config parity tests, schedule/lights-out regression guards, full test suite, clean Docusaurus build

## 2.78.0

`2.78.0` adds the first cross-run comparison command, ships the OpenClaw integration surface, and cleans up docs information architecture that was needlessly confusing.

- New `agentxchain diff <left_run_id> <right_run_id>` command for comparing recorded governed runs from `.agentxchain/run-history.jsonl`
- `diff` supports unique run-id prefixes, fails closed on ambiguous references, and compares scalar fields, numeric deltas, phases, roles, and gate status changes
- New OpenClaw integration guide at `/docs/integrations/openclaw` with honest `local_cli` truth and explicit `remote_agent` boundary
- New `plugins/openclaw-agentxchain/` package exposing `agentxchain_step`, `agentxchain_accept_turn`, and `agentxchain_approve_transition`
- Docs sidebar renamed `Integration` → `Connectors` and `Integrations` → `Platform Guides`
- 3878 tests / 835 suites / 0 failures (`cd cli && npm test`)
- Local release proof included the new diff command tests, OpenClaw plugin tests, full `cd cli && npm test`, and a clean `cd website-v2 && npm run build`

## 2.77.0

`2.77.0` ships three new operator-facing capabilities: live connector health probes (`agentxchain connector check`), per-run cost summary in `audit`/`report`, and multi-axis protocol version surface in `doctor`/`validate`. Also includes the `agentxchain audit` command, Homebrew sync hardening, IDE report simplification, and visual/content polish across all public surfaces.

- New `agentxchain connector check` command with live probes for all runtime types (local_cli, api_proxy, remote_agent, MCP stdio/streamable_http)
- Per-run cost summary in `agentxchain audit` and `agentxchain report`: total USD, tokens, per-role and per-phase breakdowns
- `doctor` and `validate` now expose protocol version (v6), config generation (v4), and config schema (1.0) separately
- New `agentxchain audit` command as first-class live governance audit surface
- VS Code extension `loadGovernedReport()` replaced double-hop (`export` + `report`) with single `audit --format json` call
- Homebrew mirror `--admin` merge fallback gated to self-approval deadlock only; non-matching failures fail closed
- All public install surfaces now show both npm and Homebrew install paths
- Visual design sweep: 20+ inline styles extracted to CSS classes with mobile responsiveness
- 3863 tests / 830 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.76.0

`2.76.0` closes two quality debts: incomplete CLI command test coverage and manual Homebrew mirror PR follow-through. Every CLI command now has a dedicated subprocess test suite, and CI now owns the full Homebrew mirror PR lifecycle.

- All 40 testable CLI commands now have dedicated subprocess test suites — 10 new suites added across `stop`, `events`, `supervise`, `branch`, `rebind`, `watch`, `generate`, `start`, `update`, and `kickoff`
- The `publish-npm-on-tag.yml` workflow now records the Homebrew mirror PR number, submits an approval review, enables squash auto-merge with branch deletion, and polls for `MERGED` — failing closed if the PR never merges
- Fixed `getPreviousVersionTag()` in the GitHub Release body renderer: positional lookup replaces `.find(tag !== current)` which returned the wrong tag
- Backfilled governed release bodies for v2.30.0 through v2.75.0 with public docs URL, npm URL, summary paragraph, evidence line, and correct compare link
- 3822 tests / 819 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.75.0

`2.75.0` closes the remaining coordinator hook-evidence lie inside the dashboard Timeline turn-detail panel. The bridge already exposed coordinator hook audit and annotation endpoints, but Timeline only fetched repo-local evidence and silently hid coordinator hook activity in coordinator workspaces. The release also aligns Timeline section titles to the existing Hooks view instead of introducing another avoidable naming fork.

- The dashboard `Timeline` view now fetches `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations` and renders that evidence in turn-detail panels for coordinator workspaces
- Mixed workspaces now render separate `Repo Hook Audit Log` / `Coordinator Hook Audit Log` and `Repo Hook Annotations` / `Coordinator Hook Annotations` sections, matching the established Hooks view vocabulary instead of inventing a second label set
- Repo-only workspaces remain backward compatible: Timeline still renders a single unprefixed `Hook Audit Log` / `Hook Annotations` section when no coordinator evidence exists
- Public CLI docs now state that Timeline turn detail surfaces coordinator hook audit and annotations alongside repo-local hook data
- 3754 tests / 808 suites / 0 failures (`cd cli && npm test`)
- Focused dashboard proof passed: `node --test cli/test/timeline-coordinator-hooks.test.js cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`
- `cd website-v2 && npm run build` clean

## 2.74.0

`2.74.0` fixes an embarrassing dashboard truth gap: the Timeline view carried turn history and active-turn state, but dropped the timing fields that were already present in its own data sources. A view named `Timeline` showed no elapsed time, no accepted-at timestamp, and no per-turn duration.

- The dashboard `Timeline` view now renders live elapsed time for active turns from `started_at`, instead of hiding in-flight timing completely
- Completed turn cards now surface `duration_ms` and `accepted_at` inline in the turn header, so operators can inspect timing history without dropping into raw JSON
- Legacy history entries remain backward compatible: missing or invalid timing fields are omitted cleanly instead of crashing or rendering placeholders
- Public CLI docs now state that Timeline includes live elapsed time, per-turn duration, and acceptance timestamp, and regression tests freeze that contract
- 3747 tests / 807 suites / 0 failures (`cd cli && npm test`)
- 83 dashboard-focused tests / 18 suites / 0 failures (`node --test cli/test/timeline-turn-timing.test.js cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.73.0

`2.73.0` closes the same coordinator dashboard lie in the shared `Hooks` view that previously existed in `Decisions`. The bridge already exposed coordinator hook audit and annotation ledgers, but the SPA only fetched repo-local hook data and falsely rendered an empty hooks surface for coordinator workspaces.

- The shared dashboard `Hooks` view now fetches both repo-local and coordinator hook sources, rendering truthful coordinator audit and annotation sections instead of collapsing to repo-local-only emptiness
- Mixed workspaces now keep one shared filter bar while rendering separate `Repo Hook Audit Log` / `Coordinator Hook Audit Log` and annotation sections, so operators can inspect both layers without navigation sprawl
- Public CLI docs now document `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations` and explicitly state that the shared Hooks view surfaces coordinator hook activity
- Added dashboard rendering and docs-contract regression coverage for coordinator hook visibility instead of trusting the existing bridge mapping by implication
- 3730 tests / 802 suites / 0 failures (`cd cli && npm test`)
- 66 dashboard-focused tests / 13 suites / 0 failures (`node --test cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.72.0

`2.72.0` fixes a dashboard truth gap in coordinator workspaces. The bridge already exposed the coordinator decision ledger, but the shared `Decisions` view only fetched the repo-local ledger and falsely rendered an empty state for coordinator runs.

- The shared dashboard `Decisions` view now fetches both repo-local and coordinator ledgers and renders the truthful surface instead of collapsing to repo-local-only emptiness
- Coordinator workspaces now render `Coordinator Decision Ledger`, and mixed surfaces render separate repo-local and coordinator sections under one filter bar
- Public CLI docs now document `GET /api/coordinator/ledger` and explicitly state that the shared Decisions view surfaces coordinator decisions
- Added bridge, dashboard view, coordinator E2E, and docs-contract regression coverage for the coordinator ledger surface
- 3725 tests / 802 suites / 0 failures (`cd cli && npm test`)
- 120 dashboard-focused tests / 25 suites / 0 failures (`node --test cli/test/dashboard-views.test.js cli/test/dashboard-bridge.test.js cli/test/e2e-dashboard.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.71.0

`2.71.0` closes the coordinator status observability gap: `multi status` now renders blocked reason, elapsed time, phase gate pass/pending, completion state, and color-coded status instead of forcing operators into raw state files.

- `getCoordinatorStatus()` returns `blocked_reason`, `created_at`, `updated_at`, and `phase_gate_status` — fields that already existed in state but were silently omitted from the status query
- `multi status` text output is now observability-complete: color-coded status, elapsed time for active runs, blocked reason, phase gate rendering, completion marker, and pending gate `from → to` direction
- Public CLI docs and docs regression coverage updated to freeze the enriched coordinator status contract
- 3721 tests / 802 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.70.0

`2.70.0` closes the coordinator-side hole Claude missed: governance exceptions were extracted for child repos, but coordinator reports still dropped coordinator-level escalations and conflicts even though the extractor existed.

- Coordinator reports now surface `governance_events` from `.agentxchain/multirepo/decision-ledger.jsonl` in JSON, text, and markdown instead of silently omitting those exceptions
- The report extraction path is now shared across single-repo and coordinator ledgers, so type-specific governance detail stays aligned across both surfaces
- The public CLI reference now states that coordinator reports include coordinator-level governance events, and the docs guard freezes that claim
- Added coordinator narrative proof for JSON, text, and markdown governance-event rendering instead of pretending child-repo coverage was enough
- 3714 tests / 800 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.69.0

`2.69.0` closes a larger observability hole than the last release: governed phase transitions and gate failures are now visible in the event stream instead of disappearing into `state.json` and ledger files.

- `phase_entered` events now emit for all three transition paths: direct automatic gate passes, policy auto-approved transitions, and explicit human approvals
- New `gate_failed` lifecycle events record `gate_id`, blocked transition, and failure reasons so operators can diagnose a rejected phase change from `agentxchain events` instead of raw-file archaeology
- The `events` command now renders inline phase movement as `from → to (trigger)` and shows `gate_failed` reason detail; public CLI docs now freeze that contract instead of silently omitting the new event surface
- 3706 tests / 798 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.68.0

`2.68.0` makes rejection events operator-usable instead of raw-file archaeology. `turn_rejected` now carries the real rejection reason and failed stage in the event stream, and the human-readable `agentxchain events` surface is finally pinned by regression proof instead of wishful reading.

- `turn_rejected` lifecycle events now carry `reason` and `failed_stage`, plus `validation_errors` when they actually exist, so `.agentxchain/events.jsonl` is a usable audit trail rather than a stub
- `agentxchain events` text output now renders rejection detail inline as `reason (failed_stage)`, and that operator-facing output is frozen by CLI regression coverage instead of being left untested
- The rejection-event spec and CLI docs now point operators at the truthful surface: scan `events` for fast triage, use `events --json` when they need the full structured payload
- 3699 tests / 796 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.67.0

`2.67.0` completes the operator surface for per-turn timing. Active-turn inspection now shows when a governed turn started and how long it has been running, while governance reports carry accepted-turn duration instead of wasting that data in history files.

- `agentxchain turn show` now prints `Started` and `Elapsed` for active turns when timing metadata exists, and `turn show --json` exposes `started_at` plus live `elapsed_ms`
- Governance reports now carry per-turn `started_at` and `duration_ms` in JSON output, and Turn Timeline rows render `accepted_at (duration)` in text and markdown when duration exists
- The turn-timing spec and turn inspection spec are aligned to the real operator surfaces: per-turn timing is surfaced through `status`, `turn show`, `report`, and `events --json`, not the unrelated cross-run `history --json` command
- 3695 tests / 795 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.66.1

`2.66.1` repairs the failed `v2.66.0` publish path, completes the remaining preflight compression gap, and restores the live X/Twitter website surface.

- Release social posting is now frozen to the real three-channel contract: `post-release.sh` delegates to X/Twitter, LinkedIn, and Reddit, and tests no longer block tagged publish on stale two-channel assumptions
- `last_turn_verification` is now explicitly compressible in the bounded preflight tokenization order, dropped after `workflow_artifacts` and before `gate_required_files`, closing the remaining non-sticky/untargeted context gap
- The website community surface now links the live `@agentxchaindev` account again across navbar, footer, homepage cards, and `llms.txt`
- The `v2.66.0` release page now states the truth: the tag exists, but npm/Homebrew publication did not complete from that tag
- 3691 tests / 794 suites / 0 failures (`cd cli && npm test`)

## 2.66.0

`2.66.0` closes the preflight compression model gap for `workflow_artifacts` and adds cumulative decision ledger dispatch to governed agent context.

- Cumulative agent-authored decisions from `decision-ledger.jsonl` are now dispatched in CONTEXT.md as a "Decision History" markdown table, so agents see the full governed decision trail — not just the last turn's decisions
- Decision history filters to agent-authored entries only (those with `id` field), caps at 50 most recent, and handles missing/empty/malformed ledger gracefully
- `workflow_artifacts` is now explicitly compressible in the preflight compression model — dropped after `decision_history` and before `gate_required_files` under token pressure
- Previously, `workflow_artifacts` had `required: false` but was not in COMPRESSION_STEPS, making it behave as sticky despite being marked compressible
- `project_goal` and `inherited_run_context` are preserved as sticky sections that survive full preflight compression
- Decision history is compressible context, dropped in the bounded compression order after `phase_gate_status` and before `workflow_artifacts`
- 56 tests / 14 suites / 0 failures (combined context-compressor, context-section-parser, token-budget, decision-history, and workflow-kit runtime context suite)

## 2.65.0

`2.65.0` promotes reproducible verification from a manual inspection step to a declarative acceptance policy. Machine-evidence replay is now enforceable at the governed acceptance boundary.

- New built-in policy rule `require_reproducible_verification` blocks turn acceptance when declared `verification.machine_evidence` commands fail to reproduce their declared exit codes
- Shared `verification-replay.js` helper ensures `verify turn` and acceptance-time enforcement use identical replay logic with no surface drift
- Policy actions `block`, `warn`, and `escalate` supported with standard scope filtering (phase, role)
- Accepted turns include a compact `verification_replay` summary for audit trails
- `accept-turn` and `step` CLI output displays replay status when reproducibility enforcement is active
- 115 tests / 29 suites / 0 failures (combined policy-evaluator, runtime-integration, verify-turn, and docs guard suite)
- Targeted proof covers policy evaluation (3 tests), runtime integration (3 E2E tests), verify-turn regression (8 tests), docs contract guards, and a clean Docusaurus production build

## 2.64.0

`2.64.0` completes the governed inspection surface and adds pre-acceptance evidence replay. Every governed concept now has a dedicated read-only CLI command.

- `agentxchain phase list` and `phase show [phase]` inspect governed workflow routing with phase order, entry roles, exit gates, workflow-kit artifacts, and next-role constraints
- `agentxchain gate list` and `gate show <gate_id>` inspect governed gate contracts with `--evaluate` for live readiness snapshots using runtime gate semantics (merged workflow-kit artifacts, semantic validators, explicit ownership participation)
- `agentxchain verify turn [turn_id]` replays staged turn `verification.machine_evidence` commands and compares actual exit codes to declared exit codes, reporting match/mismatch/not_reproducible without mutating state
- `phase show` now distinguishes explicit `owned_by` (enforced) from `entry_role`-inferred ownership (display hint only) with `ownership_enforced` boolean in JSON
- 59 tests / 13 suites / 0 failures (combined inspection + verify-turn suite)
- Targeted proof covers phase inspection (8 tests), gate inspection (9 tests including semantic evaluation), verify-turn (8 tests), docs contract guards, and a clean Docusaurus production build

## 2.63.0

`2.63.0` ships two new operator inspection surfaces — `agentxchain role` and `agentxchain turn` — plus Homebrew release-path hardening.

- `agentxchain role list` and `role show <role_id>` provide dedicated read-only inspection of governed role definitions with `--json` support and color-coded authority levels
- `agentxchain turn show [turn_id]` inspects active governed turn dispatch bundles with `--artifact` and `--json` support
- `release-bump.sh` carries the Homebrew SHA deterministically from `HEAD:cli/homebrew/agentxchain.rb` and warns about Phase 1 stale-SHA state
- 64 tests / 18 suites / 0 failures (combined role + turn + release-identity suite)
- Targeted proof covers role inspection (7 tests including legacy v3 rejection), turn inspection (6 E2E subprocess tests), docs coverage (10 tests), and a clean Docusaurus production build

## 2.61.0

`2.61.0` closes the remaining pricing and governed-config truth gaps that were still leaking operators into weaker paths. Budget and `cost_rates` edits now fail closed through governed config validation, public docs route scalar pricing fixes through `agentxchain config --set`, and the connector tutorial now follows the same `--goal` + `doctor` bootstrap contract as the rest of the product.

- Governed config validation now rejects malformed `budget` values and malformed `budget.cost_rates` entries instead of accepting invalid pricing metadata
- Budget recovery docs now route operators through `agentxchain config --set budget.per_run_max_usd <usd>` instead of hand-editing `agentxchain.json`
- Public pricing docs now show single-model `budget.cost_rates.<model>.<field>` overrides through `agentxchain config --set`, while leaving bulk multi-model tables in JSON where the CLI path would be materially worse
- `/docs/build-your-own-connector` now scaffolds with `agentxchain init --governed --goal ...`, runs `agentxchain doctor`, and shows `config --set` for scalar follow-up runtime edits
- Added regression guards for pricing-path docs alignment and the connector tutorial bootstrap/config path
- 3599 tests / 778 suites / 0 failures
- Targeted proof covers governed budget validation, budget-recovery E2E, pricing docs guards, connector tutorial guards, and a clean Docusaurus production build

## 2.60.0

`2.60.0` fixes a governed operator repair path that was still broken after scaffold. Governed repos can now use `agentxchain config` instead of falling back to manual JSON editing, and the natural `agentxchain config --set <key> <value...>` form finally works for v4 config. The omitted-goal recovery path now points at a real command instead of a hand-edited file.

- `agentxchain config` now supports governed repos through version-aware config loading instead of rejecting v4 projects as legacy-only
- `agentxchain config --set <key> <value...>` now accepts the natural CLI form, while the older quoted single-argument form remains backward compatible
- Invalid governed config edits now fail closed against the governed schema instead of mutating `agentxchain.json` optimistically
- `init --governed`, `README.md`, `cli/README.md`, `quickstart.mdx`, `getting-started.mdx`, and `/docs/cli` now route omitted-goal recovery through `agentxchain config --set project.goal ...`
- Added `.planning/GOVERNED_CONFIG_COMMAND_SPEC.md` and `cli/test/config-governed.test.js` to freeze the governed config-mutation contract
- 3585 tests / 777 suites / 0 failures
- Targeted proof covers governed config subprocess mutations, front-door/docs guards, governed CLI support, and a clean Docusaurus production build

## 2.59.0

`2.59.0` fixes the governed-ready front door. The demo handoff now routes operators through `init --governed --goal`, `doctor`, and `run`, and the rest of the public onboarding path stops teaching a weaker bare-init flow. README, npm README, homepage, quickstart, and getting-started now align on the same truth: set mission context at scaffold time, verify readiness before the first turn, and do not re-run `init --governed` in place just to add a goal later.

- `agentxchain demo` now ends with a governed-ready CLI handoff: scaffold with `--goal`, run `doctor`, then start the first governed turn
- `README.md`, `cli/README.md`, the homepage terminal sample, `quickstart.mdx`, and `getting-started.mdx` now route real-repo onboarding through `agentxchain init --governed --goal ...` plus `agentxchain doctor`
- `getting-started.mdx` no longer teaches a misleading second `init --governed --goal --dir . -y` rerun after scaffold; operators are told to edit `project.goal` directly if they skipped it
- Added `.planning/FRONTDOOR_GOVERNED_READY_PATH_SPEC.md` and `cli/test/frontdoor-governed-ready-path.test.js` to freeze the public onboarding contract
- 3578 tests / 775 suites / 0 failures
- Targeted proof covers demo/front-door discoverability, governed-ready path docs guards, and a clean Docusaurus production build

## 2.58.0

`2.58.0` finishes the run-retrospective visibility slice. Operators can now see retrospective headlines across every human-readable history surface instead of needing `--json` or inherited context to discover that a terminal handoff exists. This release also hardens the current-release guard so release evidence compares the real aggregate test-count line semantically, not by brittle bullet position.

- `agentxchain history` now shows a `Headline` column with the terminal retrospective headline
- Dashboard run history now surfaces the same `Headline` value so continuity is visible in both CLI and browser views
- `history --lineage` now appends the truncated headline for each ancestor entry, closing the last human-readable continuity gap
- Public CLI docs and `RUN_HISTORY_SPEC.md` now freeze headline visibility across table, lineage, and dashboard surfaces
- `current-release-surface.test.js` now compares aggregate evidence lines semantically by highest concrete `N tests ... 0 failures` count
- 3572 tests / 773 suites / 0 failures
- Targeted proof covers CLI history table/lineage rendering, dashboard headline visibility, release-surface evidence matching, and Docusaurus production build

## 2.57.0

`2.57.0` makes run-to-run continuity concrete. Terminal governed runs now record a deterministic `retrospective` in `run-history.jsonl` (headline, terminal reason, next operator action, follow-on hint), and child runs created with `--inherit-context` receive the parent's retrospective directly in `CONTEXT.md`. Also surfaces `project.goal` across all front-door onboarding paths and fixes accepted-turn inheritance to match real governed history entries.

- Terminal governed runs now record an additive `retrospective` object in `run-history.jsonl`
- `--inherit-context` carries `parent_retrospective` into child run's `inherited_context` and renders it in `CONTEXT.md`
- Fixed accepted-turn inheritance bug: `buildRecentAcceptedTurnSnapshot()` now correctly matches `status: "completed"` entries
- `init --governed` now prints a conditional `--goal` tip when no project goal is set
- `README.md`, `quickstart.mdx`, and `getting-started.mdx` now mention `--goal` and `project.goal`
- 3570 tests / 773 suites / 0 failures
- Targeted proof covers run-history retrospectives, inherited-context rendering, project-goal discoverability guards, and Docusaurus production build

## 2.56.0

`2.56.0` gives governed runs an explicit project-level mission. `project.goal` can now be set at scaffold time, preserved in config normalization, rendered into every dispatched turn's `CONTEXT.md`, and surfaced across `status`, `report`, `export`, and the demo config so agents know what the repo is trying to accomplish before they start arguing about implementation details.

- Added `agentxchain init --governed --goal "<text>"` to persist an optional `project.goal` string
- Dispatch bundles now render `## Project Goal` after current state so every governed turn sees the project mission
- `status --json` exposes additive `project_goal`, while governance reports preserve the same value at `subject.project.goal`
- Public CLI and governance-report docs now describe the shipped goal surface truthfully instead of fabricating a `project_goal` report field
- 13 tests / 6 suites / 0 failures
- Targeted proof now covers status text, report JSON/text, docs contract alignment, and Docusaurus production build

## 2.55.0

`2.55.0` makes run-context inheritance visible before operators construct a child run. `agentxchain history` now shows a `Ctx` signal in the default table, `history --json` exposes a computed `inheritable` boolean, lineage output marks inheritable ancestors with `[ctx]`, and the dashboard run-history view surfaces the same inheritance-snapshot availability.

- Operators can see at a glance which historical runs have usable inheritance snapshots versus metadata-only lineage
- Public CLI docs now explain the `Ctx` column, `inheritable` JSON field, and lineage `[ctx]` marker
- Proof coverage now includes dashboard rendering and lineage output instead of pretending the JSON/table tests were enough
- 70 tests / 16 suites / 0 failures
- Docusaurus production build passed

## 2.54.0

`2.54.0` fixes a real long-horizon continuity bug in governed run inheritance. `--inherit-context` now reads a bounded snapshot recorded on the selected parent run's `run-history.jsonl` entry instead of whatever happens to be in the repo's current `history.jsonl` and `decision-ledger.jsonl`. That means inheriting from an older parent run no longer leaks later repo activity into the child run's first-turn context.

- Added bounded `inheritance_snapshot` recording to `run-history.jsonl`
- Child runs degrade to metadata-only inheritance when targeting older parent entries without snapshots
- Added subprocess proof that newer repo history does not contaminate inheritance from the selected parent
- 50 tests / 11 suites / 0 failures
- Full CLI test suite and Docusaurus production build passed

## 2.53.0

`2.53.0` fixes governed-readiness discoverability so the first-run operator journey is finally honest. `agentxchain doctor` now appears in the scaffold handoff, quickstart, and getting-started flow between scaffold validation and the first governed turn, which means runtime/env failures are surfaced before operators hit them mid-run.

- 3527 tests / 758 suites / 0 failures

## 2.52.0

`2.52.0` adds a governed readiness doctor for v4 projects and removes a real legacy usability trap. `agentxchain doctor` now answers governed run readiness with config, runtime, state, schedule, and workflow-kit checks on governed repos, while the legacy v3 macOS Accessibility probe is timeout-bounded instead of hanging indefinitely behind `osascript`.

- 3525 tests / 758 suites / 0 failures

## 2.51.0

`2.51.0` hardens release identity creation so AgentXchain no longer mints a release tag before the local release state is actually proven. `release-bump.sh` now runs inline preflight between the release commit and tag creation, using the real release target for `npm test`, `npm pack --dry-run`, and the Docusaurus production build. If any of those fail, the commit may exist, but the tag does not.

- 3517 tests / 756 suites / 0 failures

## 2.50.0

`2.50.0` hardens the operator handoff around lights-out scheduling and release infrastructure. Repo-local schedule daemons now expose a truthful health surface, Homebrew sync now survives harmless push races by verifying the canonical tap after rejection, and `init --governed` prints the real bootstrap sequence (`template validate`, git checkpoint, first turn) instead of under-guiding cold-start operators.

- 3509 tests / 755 suites / 0 failures

## 2.49.0

`2.49.0` ships repo-local governed run scheduling with interval-based triggers, safe skip semantics (active/blocked runs are never overwritten), schedule provenance (`trigger: schedule`), local daemon loop, and a refactored shared `executeGovernedRun()` surface. Schedule state is orchestrator-owned and export/restore-aware.

- 3497 tests / 747 suites / 0 failures

## 2.48.0

`2.48.0` ships repo-local run event streaming with 11 lifecycle event types, a `agentxchain events` CLI command with `--follow` real-time streaming, docs truth corrections (`history --status` filter), and E2E proof hardening for event lifecycle and provenance terminal-bootstrap.

- 3478 tests / 743 suites / 0 failures

## 2.47.0

`2.47.0` ships run provenance observability, terminal-state bootstrap fixes for continuation and recovery runs, and CLI help text corrections. Provenance metadata (`trigger`, `parent_run_id`, `trigger_reason`) is now rendered in `status`, `report`, `export`, and `history`.

- 3462 tests / 741 suites / 0 failures

## 2.46.2

`2.46.2` combines the timeout dashboard truth patch with a release-truth repair. Repo-local and coordinator timeout views now surface per-turn live pressure with turn identity, the repo-local timeout endpoint has direct server-module proof instead of render-only coverage, the publish workflow separates tagged-state verification from npm publication, and the CI-only git-identity test defect that broke `v2.46.1` is fixed.

### Timeout dashboard truth fix

- Repo-local `Timeouts` and coordinator `Coordinator Timeouts` views now evaluate active turns individually instead of silently dropping turn-scope timeout pressure.
- Turn-scope live rows now carry `turn_id` and `role_id`, so operators can identify the actual over-budget turn instead of seeing anonymous pressure.
- Phase/run timeout evaluation remains unchanged and is still evaluated once per request.

### Proof hardening

- Added direct `readTimeoutStatus()` contract tests for configured/unconfigured state, active-turn pressure, blocked-state behavior, and missing state handling.
- Extended coordinator timeout tests to prove turn-scope live pressure propagates into repo snapshots and rendered cards.
- Fixed `parallel-attribution-observability.test.js` to configure local git identity inside temp repos instead of depending on a developer's global git config.
- `publish-from-tag.sh` now supports explicit `--skip-preflight` for CI callers that already re-verified the tagged state, while direct/operator usage remains fail-closed by default.
- The publish workflow now exposes a dedicated `Re-verify tagged release before publish` step so operators can distinguish tag verification from actual npm publication.

### Evidence

- 3432 tests / 735 suites / 0 failures
- `node --test cli/test/dashboard-timeout-status.test.js` → 18 tests / 3 suites / 0 failures
- `node --test cli/test/dashboard-coordinator-timeout-status.test.js` → 8 tests / 3 suites / 0 failures
- `node --test cli/test/dashboard-bridge.test.js` → 46 tests / 11 suites / 0 failures
- `node --test cli/test/parallel-attribution-observability.test.js cli/test/publish-from-tag.test.js cli/test/release-docs-content.test.js` → 31 tests / 4 suites / 0 failures
- `cd cli && npm test` → 3432 tests / 735 suites / 0 failures
- `cd website-v2 && npm run build` → clean

## 2.46.0

`2.46.0` ships the declarative policy engine for governed turn acceptance with five built-in rules, three actions (warn/block/escalate), phase/role scoping, runtime-aware escalation recovery, cost enforcement fix (`cost.usd` primary), and policy-specific CLI operator guidance.

### Declarative policy engine

- Five built-in rules: `require_status`, `max_consecutive_same_role`, `require_challenge`, `max_cost_per_turn`, `min_artifacts`.
- Three actions: `warn` (log and accept), `block` (reject turn), `escalate` (persist blocked state with structured recovery).
- Optional `phases` and `roles` scoping per rule.
- Template integration: `enterprise-app` template includes a default policy configuration.

### Policy escalation recovery hardening

- Policy escalation now writes structured `blocked_reason` via `buildBlockedReason()` with `category: 'policy_escalation'` — consistent with all other blocked-state writers.
- Recovery is runtime-aware: retained `manual` turns → `agentxchain resume`; retained non-manual turns → `agentxchain step --resume`.
- `accept-turn` renders policy-specific operator guidance with violating policy IDs, rule names, and recovery commands.
- Run history records policy-blocked transitions. Blocked notifications fire on policy escalation.

### Cost enforcement fix

- `max_cost_per_turn` reads `turnResult.cost.usd` first, falls back to legacy `turnResult.cost.total_usd`.

### Policy docs surface

- Dedicated `/docs/policies` page with sidebar, llms.txt, and sitemap coverage.

### VS Code Marketplace readiness

- Dedicated marketplace readiness test guard (publisher, package.json, .vscodeignore, README).

### Evidence

- 3308 tests / 698 suites / 0 failures

## 2.45.0

`2.45.0` adds Ollama as a first-class `api_proxy` provider for local models, ships the build-your-own-connector tutorial, audits the runner tutorial against the real runtime, and hardens docs-contract tests with live-import verification.

### Ollama as first-class api_proxy provider

- Ollama is the fourth `api_proxy` provider alongside Anthropic, OpenAI, and Google.
- Auth-optional: `auth_env` is not required. `AUTH_OPTIONAL_PROVIDERS` mechanism supports future auth-optional providers.
- Provider-specific request builder (`buildOllamaRequest`) uses `max_tokens` (not OpenAI's `max_completion_tokens`).
- Default endpoint: `http://localhost:11434/v1/chat/completions` — works out of the box with `ollama serve`.
- No bundled cost rates for local models. Operators supply rates via `budget.cost_rates`.
- Error classification mirrors OpenAI provider error map.

### Build-your-own-connector tutorial

- New step-by-step tutorial at `/docs/build-your-own-connector` covering request envelope, response contract, validation traps, and auth configuration.
- Tutorial config validated against real `loadNormalizedConfig()`, not string-presence checks (`DEC-BYOC-004`).

### Build-your-own-runner docs audit

- Unguarded `null` returns in `loadContext()`/`loadState()` fixed with explicit error messages.
- `acceptTurn` failure shape corrected: added `state?` and `hookResults?` for hook-blocked paths.
- New Step 8 with inline `runLoop` usage example showing callback contract and result handling.

### Hardened docs-contract tests

- Adapter docs guards import live constants (`PROVIDER_ENDPOINTS`, `BUNDLED_COST_RATES`, `VALID_API_PROXY_PROVIDERS`) instead of regex-scraping nested source literals (`DEC-GUARD-REGEX-002`).
- Runner docs guards verify function exports against real module imports.

### Evidence

- Strict release preflight: 4098 tests / 0 failures
- Docusaurus production build clean

## 2.44.0

`2.44.0` ships cross-run history, terminal recording at all blocked paths, run-level terminal-state alignment, and multi-phase write-owning CI proof.

### Cross-run history surface

- New `agentxchain history` CLI command lists past governed runs with status, timing, and role summaries.
- New dashboard Run History panel (10th view) renders history in the browser with filtering and drill-down.
- `run-history.js` library records terminal outcomes to `.agentxchain/run-history.jsonl` and exposes `listRunHistory()` / `recordRunHistory()`.
- Library template exports `run-history.js` for programmatic consumers.

### Terminal recording at all blocked paths

- Every code path that transitions a run to `blocked` now records the outcome in `run-history.jsonl`.
- Dashboard state-reader and bridge-server expose history data to the observation layer.
- `repo-observer.js` baseline includes `run-history.jsonl`.

### Run-level terminal-state alignment

- Governed run-level `failed` is now formally reserved/unreached. Current governed writers emit only `completed` or `blocked`.
- `recordRunHistory()` rejects unsupported terminal statuses instead of silently legitimizing reserved states.
- `continuity-status.js` returns `reserved_terminal_state` for run-level `failed`.
- `restart.js` fails closed with a truthful reserved-status message.
- `intake resolve` fails closed on governed run-level `failed` with `DEC-RUN-STATUS-001` reference.
- Coordinator completing without satisfying a workstream maps to intent `blocked` (recoverable) instead of intent `failed` (terminal).
- `VALID_TRANSITIONS['executing']` narrowed to `['blocked', 'completed']`.
- Planning specs, intake docs, and state-machine specs aligned to the shipped truth.
- Regression guards added to `continuous-delivery-intake-content.test.js`.

### Multi-phase write-owning CI proof (Tier 6)

- New `examples/ci-runner-proof/run-multi-phase-write.mjs` proves a 3-phase governed run where the implementation agent writes real files.
- Contract test `ci-multi-phase-write-proof-contract.test.js` guards the proof boundary.

### Evidence

- **4029 tests / 700 suites / 0 failures** (3175 node + 854 Vitest)
- Docusaurus production build clean

## 2.43.0

`2.43.0` hardens the lights-out CI proof slice from `2.42.0`. The core validator now repairs one more truthful `review_only` lifecycle case, the CI proof fixtures state the task and phase boundaries explicitly, retries absorb transient cheap-model failures, and the proof scripts keep `--json` output parseable across retries.

### Non-terminal lifecycle normalization

- `review_only` turns with affirmative, non-blocker `needs_human` reasoning on non-terminal phases now normalize to the next phase transition.
- Blocker-style reasons still fail closed instead of being pushed forward.
- The normalization remains narrow to lifecycle mechanics; semantic objection/category coercion stays out of product code.

### CI proof reliability

- The CI proof mandates now embed the concrete hello-world server task directly.
- The planner mandate now names the actual next phase (`review`) instead of the non-existent `implementation` phase.
- Both proof scripts retry up to 3 attempts to absorb transient cheap-model hallucinations without treating a sound governed contract as flaky infrastructure.

### Stable machine-readable retry output

- `run-with-api-dispatch.mjs --json` now emits one final JSON document with `attempts_used` and `attempt_history` instead of multiple top-level blobs.
- `run-via-cli-auto-approve.mjs --json` now follows the same contract.
- Contract tests now prove the missing-auth failure path still returns parseable JSON after retries are exhausted.

### Evidence

- **3117 tests / 652 suites / 0 failures** after version-surface alignment
- Proof contract tests green including retry-path JSON parsing
- Docusaurus production build clean

## 2.42.0

`2.42.0` ships real lights-out CI proof — governed execution driven by a live model in GitHub Actions, not synthetic dispatch. Review-only lifecycle normalization promoted to the core validator, and release discovery surfaces are now governed.

### Real API-governed CI proof

- `api-dispatch-proof` job runs `runLoop` + `dispatchApiProxy` with `claude-haiku-4-5-20251001` on every push to `main`.
- Proves real model dispatch, governed lifecycle, and non-zero API cost in CI without human terminal.
- Cost-controlled: $2.00 budget cap, 6-turn max, ~$0.01-0.02 per run.
- Prior synthetic proof scripts still run — no regression.

### Review-only lifecycle normalization (core)

- Deterministic lifecycle/routing normalization for `review_only` turns promoted from proof-local to `turn-result-validator.js`.
- Phase transition inference, run completion inference, routing correction for completed review-only turns.
- Explicit `run_completion_request: false` is never overridden.

### Release discovery enforcement

- `llms.txt` and `sitemap.xml` added to `ALLOWED_RELEASE_PATHS` in `release-bump.sh`.
- Pre-bump validation fails closed unless both surfaces list the current release route.
- `current-release-surface.test.js` guards discoverability invariant.

### Evidence

- **3104 tests / 650 suites / 0 failures**
- CI Runner Proof workflow green including `api-dispatch-proof` job
- Docusaurus production build clean

## 2.41.0

`2.41.0` ships the governed IDE operator surface for VS Code. Eight governed commands — status, phase/completion approvals, step, run, report, restart, and dashboard launch — all backed by CLI subprocess calls with no direct `.agentxchain/` file writes. State-change notifications drive push alerts for pending gates, blocked states, and turn completions.

### Governed IDE commands

- `agentxchain status` renders governed run state from CLI JSON including continuity and workflow-kit artifact visibility.
- `approve-transition` and `approve-completion` use modal confirmation dialogs before invoking CLI subprocesses.
- `step` and `run` launch in integrated terminals for operator-visible adapter output.
- `report` renders the full governed report from `agentxchain export` piped through `agentxchain report --format json`.
- `restart` uses modal confirmation before invoking session recovery from checkpoint.
- `openDashboard` launches `agentxchain dashboard` in an integrated terminal.

### State-change notifications

- File-watcher driven push notifications for pending phase transitions, pending run completions, blocked states, and turn completions.
- Deduplication prevents repeated notifications for the same gate or blocked state.
- Turn-completion notifications are suppressed during IDE-launched `agentxchain run` to avoid spam.

### Architectural boundary

- All governed mutations go through `execCliCommand()` — no extension code writes to `.agentxchain/`.
- Legacy commands (`claim`, `release`, `generate`) fail closed on governed projects.
- Mutation-boundary guard tests enforce the subprocess-only contract across all eight commands.

### Evidence

- **3083 tests / 648 suites / 0 failures**
- **88 IDE-specific tests / 26 suites / 0 failures**
- Extension compiles and packages as VSIX (65.5 KB, 76 files)

## 2.40.0

`2.40.0` ships the operator-evidence slice that closes the enterprise workflow-kit observation loop: connector health is visible, current-phase artifact ownership is visible in `status` and the dashboard, enterprise-app gate evidence is proven end-to-end, and the Homebrew release path is hardened around the real three-phase lifecycle.

### Connector and artifact evidence

- `agentxchain status` now shows current-phase workflow-kit artifacts with owner role, ownership resolution, required/optional state, and exists/missing status.
- `status --json` now exposes `workflow_kit_artifacts` for automation consumers.
- Dashboard workflow-kit artifact reads now work for governed V4 configs instead of silently failing on enterprise-app projects.
- Status and dashboard artifact ownership surfaces now share one derivation helper so ownership resolution, existence checks, and sorting do not drift.
- Timeline and status surfaces now expose connector health evidence for governed runs.

### Enterprise workflow-kit proof

- Full five-phase `enterprise-app` runtime proof now covers planning, architecture, implementation, security_review, and qa with built-in phase templates plus explicit ownership overrides.
- Dashboard artifact E2E now proves all five enterprise phases render correct ownership and resolution badges.
- Dashboard gate E2E now proves the planning gate and final completion gate render truthful evidence from the real governed run path.
- Gate evidence aggregation now falls back to declared `files_changed` when observer-derived `files_changed` is empty, fixing the non-git and pre-baseline artifact case.

### Release-path hardening

- Homebrew follow-through now documents and enforces the three-phase lifecycle: pre-publish, post-publish pre-sync, and post-sync truth.
- `verify:post-publish` is the executable contract for moving the repo mirror from stale SHA state to registry-backed truth.

### Evidence

- **3836 tests / 620 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.39.0

`2.39.0` ships workflow-kit phase templates: a governed library of reusable phase definitions that expand inside `workflow_kit.phases`, CLI discovery via `template list --phase-templates`, and front-door documentation across READMEs and getting-started.

### Workflow-kit phase templates

- 5 built-in phase templates: `planning-default`, `implementation-default`, `qa-default`, `architecture-review`, `security-review`.
- Each template defines artifacts with semantic types, required/optional flags, and section requirements.
- `workflow_kit.phases.<phase>.template` references expand deterministically: template artifacts first, explicit `artifacts` appended after.
- Validation fails closed on unknown template IDs without throwing.

### CLI discovery surface

- `agentxchain template list --phase-templates` prints all built-in phase templates with artifact contracts.
- `agentxchain template list --phase-templates --json` outputs structured JSON for automation.
- Base `template list` now hints about `--phase-templates`.

### Front-door documentation

- `README.md`, `cli/README.md`, `getting-started.mdx`, `cli.mdx`, and `templates.mdx` all document phase-template discovery.

### Evidence

- 3800 tests / 647 suites / 0 failures (848 Vitest + 2952 Node)
- Docusaurus production build succeeded

## 2.38.0

`2.38.0` ships the full continuity package: richer governance checkpoints, correct restart behavior around pending gates, checkpoint-drift detection, and truthful operator-action guidance across CLI, dashboard, and API surfaces.

### Continuity checkpointing contract

- Structured governance checkpoints at 6 boundary points: turn assignment, turn acceptance, phase approval, run completion, blocked state, restart reconnect.
- Each checkpoint captures `run_id`, `phase`, `turn`, `role`, `baseline_ref`, and monotonic `checkpoint_epoch`.
- Enables cross-process session recovery with full governance-state context.

### Restart preserves pending gates

- `restart` no longer bypasses pending phase transitions or pending run completions.
- Surfaces the exact approval command instead of reactivating past an unapproved gate.

### Checkpoint-drift detection

- Continuity surfaces compare checkpoint `baseline_ref` against live workspace state.
- Drift warnings surfaced in CLI status, `--json`, `/api/continuity`, and dashboard.
- Stale checkpoints from other runs skip drift evaluation.

### Truthful continuity action guidance

- `recommended_command`, `recommended_reason`, `recommended_detail` replace boolean-only guidance.
- `restart_recommended` is now `true` only when the exact next action is `agentxchain restart`.
- Fixes misleading guidance for runs needing `approve --phase` or `approve --complete`.

### Evidence

- **2937 tests / 610 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.37.0

`2.37.0` adds Google Gemini as the third governed `api_proxy` provider, hardens Gemini-specific failure handling, fixes the Homebrew mirror PR automation path, and ships a first-class examples docs library.

### Google Gemini as governed api_proxy provider

- Google Gemini is now a supported `api_proxy` provider alongside OpenAI and Anthropic.
- Uses the Gemini `generateContent` endpoint with URL query-param API-key auth.
- Config validation accepts `provider: "google"` for `api_proxy` blocks.
- Three-provider governed proof: OpenAI PM → Google architect → Anthropic QA with real phase transitions and semantic gate evaluation.

### Gemini-specific failure handling

- `promptFeedback.blockReason` now surfaces as a provider-specific extraction-failure message.
- Non-`STOP` `finishReason` values surface when Gemini returns no parts, empty text, or `MAX_TOKENS` truncation.
- Blocked/truncated Gemini responses no longer collapse into generic parse noise.

### Homebrew mirror PR automation

- Publish workflow now creates the Homebrew mirror PR itself with `pull-requests: write`.
- PR creation fails closed — orphan branches are no longer accepted fallback patterns.

### Examples docs library

- 14 example pages under `/docs/examples/` covering all shipped examples.
- `Examples` is a first-class docs sidebar category.
- `llms.txt` and `sitemap.xml` updated for new routes.

### Evidence

- **2915 tests / 609 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.36.0

`2.36.0` ships the missing operator-visible dashboard continuity panel and closes the release-surface drift that kept the repo-mirrored Homebrew files out of release identity.

### Dashboard continuity is now operator-visible

- Timeline view now renders continuity state directly instead of leaving `/api/continuity` as hidden bridge plumbing.
- `/api/continuity` now serves the same computed continuity shape as `agentxchain status --json`, via the shared `continuity-status.js` helper.
- Dashboard invalidation now refreshes continuity when `SESSION_RECOVERY.md` changes, so restart guidance stays truthful after recovery work.

### Release identity now includes the mirrored Homebrew surfaces

- `release-bump.sh` now treats both `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` as governed release surfaces.
- Pre-bump validation fails closed unless the Homebrew mirror formula and maintainer README already point at the target version.
- Post-release current-surface coverage now enforces that the mirrored formula and README track the current npm tarball.

### Evidence

- **2894 tests / 608 suites / 0 failures**
- `cd cli && npm test`
- `node --test test/release-identity-hardening.test.js test/current-release-surface.test.js test/homebrew-mirror-contract.test.js`
- `cd website-v2 && npm run build`

## 2.35.0

`2.35.0` makes cross-session continuity observable across every operator surface.

### Continuity observability across status, reports, and dashboard

- `agentxchain status` now shows checkpoint session id, reason, timing, last turn/role/phase, stale-checkpoint warnings, and restart guidance.
- `status --json` exposes additive `continuity` metadata for automation consumers.
- Governed reports include a `Continuity` section in text and markdown formats with checkpoint metadata and stale-checkpoint detection.
- `.agentxchain/session.json` added to `RUN_EXPORT_INCLUDED_ROOTS` so checkpoint data flows through the export pipeline.
- Coordinator reports surface per-repo continuity with child-level stale detection.
- Dashboard bridge serves `/api/continuity` from `session.json` with WebSocket invalidation.

### CI and release infrastructure modernization

- GitHub Actions standardized on `checkout@v6`, `setup-node@v6`, Google Actions `@v3`.
- Pre-bump version-surface alignment guard validates all 7 governed surfaces before creating release identity.
- Orphaned release-note pages for unpublished versions deleted.

### Evidence

- **2885 tests / 607 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.34.2

`2.34.2` is the public cross-session continuity release.

### Release surfaces now agree on the shipped package

- Corrected the remaining release-governed drift caught by strict preflight:
  - `.agentxchain-conformance/capabilities.json`
  - homepage hero badge
  - protocol implementor guide example config
  - launch evidence header
  - linked Docusaurus release notes surface
- This is the first version in the restart/extension-security slice that is actually aligned enough to publish.

### Restart and extension hardening remain the actual product delta

- `restart` checkpoint serialization now preserves real phase and turn identity.
- Dedicated subprocess proof covers abandoned active-turn reconnect and checkpoint updates through the public CLI.
- VS Code extension dependency advisories are closed via patched `undici` and `brace-expansion`.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.34.1

`2.34.1` is the releasable cross-session continuity release.

### `restart` checkpoints now preserve the real phase and turn identity

- Fixed `cli/src/lib/session-checkpoint.js` to serialize checkpoint state from the actual governed runtime shape:
  - `last_phase` now falls back to `state.phase`
  - `last_turn_id` recognizes both `id` and `turn_id`
  - `last_role` recognizes both `role` and `assigned_role`
- This closes a real continuity bug where `approve-transition` could leave `session.json.last_phase = null`, which is unacceptable on a recovery feature.

### `restart` now has the missing subprocess proof

- Added dedicated CLI subprocess coverage for:
  - reconnecting to an abandoned active turn in a fresh process
  - proving that `accept-turn` and `approve-transition` both update `session.json`
- The new proof immediately caught the checkpoint serializer defect above, which is exactly why this coverage needed to exist.

### The restart contract is now honest about stale checkpoints

- The spec now matches the shipped behavior for `session.json` / `state.json` run-id drift:
  - `state.json` remains source of truth
  - stale checkpoint mismatch warns
  - restart proceeds instead of rejecting a recoverable run

### VS Code extension advisories are closed

- Updated the vendored extension dependency set to patched transitive versions:
  - `undici@6.24.0`
  - `brace-expansion@1.1.13`
- `cd cli/vscode-extension && npm audit --json` now reports **0 vulnerabilities**.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.33.1

`2.33.1` is the cross-machine continuity restore release.

### Governed runs can now move across checkouts without changing `run_id`

- Added `agentxchain restore --input <path>`.
- Operators can now:
  - export governed state from machine A
  - restore it into another checkout of the same repo on machine B
  - continue the same governed run with `agentxchain resume`
- This is intentionally narrow and truthful. It is not a general sync engine and it does not claim arbitrary source migration.

### Run exports now declare whether they are safely restorable

- Run export schema advanced to `0.3`.
- Export artifacts now include `workspace.git` metadata:
  - `is_repo`
  - `head_sha`
  - `dirty_paths`
  - `restore_supported`
  - `restore_blockers`
- Restore fails closed when the source export depended on dirty files outside the governed continuity roots, when the target checkout is dirty, or when the target `HEAD` does not match the exported commit.

### Continuity exports include the governed state required for honest restore

- Run exports now include the continuity surfaces that matter for multi-machine governed work:
  - `TALK.md`
  - `.planning/`
  - `.agentxchain/reviews/`
  - `.agentxchain/proposed/`
  - `.agentxchain/reports/`
- This keeps the restore slice honest: decisions, reviews, proposals, reports, and operator planning context survive the machine hop with the run state.

### Restore now handles empty exported files correctly

- Fixed a real contract bug during the release turn:
  - export verification already allowed empty `content_base64`
  - restore incorrectly rejected it
- Added round-trip coverage proving empty governed files survive export -> restore.

### Evidence

- **2848 tests / 599 suites / 0 failures**
- `node --test cli/test/restore-cli.test.js`
- `node --test cli/test/docs-restore-content.test.js cli/test/docs-cli-command-map-content.test.js cli/test/export-cli.test.js cli/test/verify-export-cli.test.js cli/test/coordinator-export-cli.test.js cli/test/export-schema-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.32.0

`2.32.0` is the governed product examples release.

### Public docs now expose the five end-to-end governed product examples

- Added a dedicated Docusaurus docs page at `/docs/examples` covering all five shipped products:
  - Habit Board
  - Trail Meals Mobile
  - Async Standup Bot
  - Decision Log Linter
  - Schema Guard
- Each example now has public operator-facing documentation for:
  - category
  - team shape
  - workflow phases
  - key workflow-kit artifacts
  - exact local run commands
- This closes a real discoverability defect. The examples were already in-repo, but not surfaced as a coherent public proof portfolio.

### Front-door discovery now links the examples portfolio from multiple surfaces

- Added `Examples` to the docs sidebar.
- Added `Examples` to the website footer.
- Added a homepage `Examples` section linking directly to `/docs/examples`.
- Added code-backed discoverability coverage so this surface is not unguarded docs drift.

### Governed provenance for examples is now part of the public contract

- The examples page now states the actual provenance boundary explicitly:
  - git history is the build trail
  - example-local `TALK.md` files are the governed collaboration trail
  - workflow-kit artifacts are the governed artifact trail
  - `agentxchain template validate --json` is the config/workflow proof
- This preserves the truthful boundary from `.planning/PRODUCT_EXAMPLES_GOVERNED_PROOF.md` instead of pretending copied orchestrator state proves anything.

### Evidence

- **2837 tests / 596 suites / 0 failures**
- `node --test cli/test/docs-examples-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.31.0

`2.31.0` is the workflow-kit operator observability release.

### `agentxchain report` now exposes workflow-kit artifact status directly

- Governed run reports now include `subject.run.workflow_kit_artifacts` in JSON output.
- Each artifact row carries:
  - `path`
  - `required`
  - `semantics`
  - `owned_by`
  - `owner_resolution`
  - `exists`
- This closes the operator-observability gap left by `2.30.0`: workflow-kit truth is no longer visible only to the active agent prompt/context surfaces.

### Text and markdown reports now render a first-class Workflow Artifacts section

- `agentxchain report --format text` now prints a `Workflow Artifacts (<phase> phase)` section when the current phase declares workflow-kit artifacts.
- `agentxchain report --format markdown` now renders a `## Workflow Artifacts` section with a stable table for tickets, PRs, and audit trails.
- The section is omitted when `workflow_kit` is absent or when the current phase declares zero artifacts.

### Export scope now includes `.planning/` because governed artifacts must be observable

- Governed export artifacts now include `.planning/` in the allowed roots.
- This is not optional polish. Workflow-kit gates explicitly reference governed artifact files under `.planning/`, so report-time existence checks must be able to observe them from the export artifact itself.
- Report existence is still checked against exported file keys, not the live filesystem, preserving the verified-export contract.

### Docs now state the JSON `null` vs `[]` distinction explicitly

- `subject.run.workflow_kit_artifacts = null` means `workflow_kit` is absent from config.
- `subject.run.workflow_kit_artifacts = []` means `workflow_kit` exists but the current phase declares zero artifacts.
- Text/markdown output omits the section in both cases, but the JSON distinction remains part of the operator contract.

### Evidence

- **2789 tests / 590 suites / 0 failures**
- `node --test cli/test/workflow-kit-report.test.js`
- `node --test cli/test/governance-report-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.30.0

`2.30.0` is the workflow-kit runtime accountability release.

### Workflow-kit is now visible at dispatch time, not only at gate failure

- `CONTEXT.md` now renders a phase-wide `Workflow Artifacts` section showing the current phase artifact contract before the agent starts work.
- The section shows artifact path, required vs optional, semantics, owner, and on-disk existence status.
- `review_only` roles also get artifact previews in `CONTEXT.md`, reusing the existing gate-file preview contract instead of inventing a second preview surface.

### `PROMPT.md` now names the current role's workflow responsibilities explicitly

- `PROMPT.md` now renders a role-scoped `Workflow-Kit Responsibilities` section instead of making the agent infer ownership from the full phase table.
- Ownership resolution is now explicit and stable:
  - `owned_by` wins when present
  - otherwise responsibility falls back to the current phase `entry_role`
- The prompt only lists the current role's accountable artifacts; it does not duplicate the full phase contract.

### Review-only ownership is attestation, not fake authorship

- `review_only` roles no longer receive misleading "produce this file" guidance for workflow-kit artifacts they cannot write.
- Prompt guidance now differentiates:
  - `authoritative` / `proposed`: produce
  - `review_only`: review and attest
- Config validation now warns when a `review_only` role owns a required artifact and no writing role exists in the phase routing.
- Public adapter docs now state this boundary explicitly so runtime behavior, docs, and gate semantics agree.

### Evidence

- **2780 tests / 588 suites / 0 failures**
- Docusaurus production build passes

## 2.29.0

`2.29.0` is the remote-agent proof and automation-correctness release.

### `remote_agent`: shipped as a real governed connector surface

- Added the `remote_agent` adapter: synchronous HTTP POST dispatch for governed turns with config validation, secret-header redaction, and runtime integration through the public CLI.
- Added runnable bridge example under `examples/remote-agent-bridge/` with:
  - `server.js` for deterministic proof
  - `run-proof.mjs` for end-to-end CLI lifecycle proof
  - `model-backed-server.js` for real Anthropic-backed proof
  - `run-repeated-proof.mjs` for repeated reliability measurement

### Real-model proof: transport concession made explicit

- Proved that Claude Haiku can satisfy the governed turn-result contract through the `remote_agent` bridge for both `proposed` and `review_only` paths.
- Proved repeatability across 5 independent governed lifecycles: **5/5 PASS (100%)**, no retries, 10/10 logged outer-fence strips, no field-level repair.
- Tightened the proof boundary wording across spec/example/docs:
  - fence-free raw JSON remains the preferred transport shape
  - the actual invariant is **no field-level repair**
  - logged removal of one outer markdown-fence pair is allowed when the enclosed JSON is otherwise valid

### Automation truth: `step` validation failures now exit non-zero

- Fixed the `step` command to return exit code `1` when a staged turn result fails validation and is retained.
- This closes a real automation defect for scripts and CI that previously could misread a retained validation failure as success.

### Evidence

- **2752 node tests / 582 suites / 0 failures**
- Docusaurus production build passes

## 2.28.0

`2.28.0` is the security and integration release.

### Security: zero npm audit vulnerabilities

- **website-v2**: Upgraded Docusaurus 3.9.2 → 3.10.0, added `@docusaurus/faster`, and applied npm `overrides` for `serialize-javascript@^7.0.5` — closing all 18 high vulnerabilities.
- **cli**: Updated `hono` and `@hono/node-server` — closing both moderate vulnerabilities.
- Both packages now report `0 vulnerabilities` from `npm audit --omit=dev`.

### Retired GitHub Pages deploy path

- Deleted `.github/workflows/deploy-pages.yml` (permanently broken; GCS is canonical).
- Updated deployment docs, specs, and regression guards to enforce the single GCS deploy contract.

### Built-in GitHub Issues reference plugin

- New `@agentxchain/plugin-github-issues` — mirrors governed run status into a configured GitHub issue.
- Fires on `after_acceptance` (turn summaries) and `on_escalation` (blocked/needs-human).
- One comment per run, updated in place. Manages `agentxchain:phase/*` and `agentxchain:blocked` labels while preserving non-AgentXchain labels.
- Advisory-only: no issue closure/reopen, no fabricated state (per `DEC-GITHUB-ISSUES-002`).
- Structured `warn` on token/API failure — never blocks the governed run.

### Evidence

- 2680 node tests / 570 suites / 0 failures.
- 0 vulnerabilities across both packages.
- Docusaurus production build passes.

## 2.27.0

`2.27.0` is the operator onboarding and multi-session continuity release.

This release ships the complete tutorial walkthrough (zero-API-key, copy-pasteable, E2E-proven), the multi-session continuity operator guide with cross-session phase approval proof, and tutorial contract repairs ensuring all front-door docs use truthful operator commands.

### Tutorial walkthrough: install-to-completion narrative

- New `docs/tutorial` page: 10-step walkthrough from `npm install` through `approve-completion` and `report`.
- Uses `manual-dev` and `manual-qa` adapters for zero-API-key reproducibility.
- Exact gate file content for a concrete URL shortener project — operators can copy-paste through the entire lifecycle.
- 11 docs guard assertions covering lifecycle commands, gate content, turn-result examples, and discovery surface inclusion.

### Tutorial contract repair

- Tutorial, getting-started, and first-turn pages now use `init --dir .` (not bare `init`).
- Tutorial explicitly rebinds `dev` to `manual-dev` and `qa` to `manual-qa` before claiming a fully manual path.
- Removed fake implementation→QA approval step that didn't match real governance flow.
- New subprocess E2E (`e2e-tutorial-walkthrough.test.js`) proves the exact operator loop described in the tutorial.

### Multi-session continuity

- New `docs/multi-session` operator guide: how governed runs survive across terminal sessions, machine reboots, and agent handoffs.
- Cross-session phase approval E2E: proves `approve-transition` works in a fresh session against state persisted by a prior session.
- Multi-session completion E2E: proves `approve-completion` across session boundaries.

### Evidence

- 2676 node tests / 570 suites / 0 failures.
- Docusaurus production build passes.

## 2.26.0

`2.26.0` is the charter enforcement and enterprise template release.

This release ships artifact ownership enforcement (`owned_by`), the complete enterprise-app blueprint template with scaffold-to-runtime proof, dynamic ROADMAP generation from routing, open-ended role support, SEO discoverability, community links, mobile navigation fix, and the vs-Warp comparison page.

### Charter enforcement: artifact ownership binding at gate time

- New optional `owned_by: "<role_id>"` field on workflow-kit artifact entries binds artifact ownership to a specific role.
- Gate evaluator checks that at least one accepted turn from the owning role exists in the current phase before the gate passes.
- Phase-scoped participation proof — not file-level attribution.
- Works for both phase-exit gates and run-completion gates.
- Optional artifacts with `owned_by` are only checked when the file exists.

### Enterprise-app template: scaffold-to-runtime proof

- Blueprint-backed `enterprise-app` template ships with 6 roles (pm, architect, dev, security_reviewer, qa, tech_writer), 5 phases (planning → architecture → implementation → security_review → qa), and ownership-enforced artifacts.
- `ARCHITECTURE.md` owned by `architect`, `SECURITY_REVIEW.md` owned by `security_reviewer`.
- Scaffold-to-runtime E2E proves the real operator path: scaffolded files survive into runtime without manual repair.

### Dynamic ROADMAP generation from routing

- Scaffolded `.planning/ROADMAP.md` phase table is now derived from `routing` keys and role mandates instead of a hardcoded 3-row table.
- Blueprint-backed templates with custom routing get a truthful phase table at scaffold time.

### Open-ended roles

- Removed hardcoded `VALID_PROMPT_OVERRIDE_ROLES` — any valid role ID is now accepted in template prompt overrides.

### SEO discoverability

- Added `robots.txt`, `llms.txt`, and `sitemap.xml` for both agentxchain.dev and agentxchain.ai.

### Community links

- Added X/Twitter and Reddit links to navbar, footer, and homepage.

### Mobile navigation fix

- Fixed `.navbar-sidebar__items` collapsing to zero height on narrow desktop viewports due to `backdrop-filter: blur(20px)` creating a CSS containing block.

### vs-Warp comparison page

- New comparison page: AgentXchain vs Warp.dev — honest, research-backed comparison.

### Evidence

- 2649 node tests / 566 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.2

`2.25.2` is the workflow-kit release.

This release ships the complete workflow-kit subsystem: per-phase artifact contracts with semantic validators, runtime gate integration, template validate and scaffold integration, and operator-facing docs. It also fixes a real `template validate` defect where explicit empty `workflow_kit: {}` was not treated as an opt-out.

### Workflow-kit config: per-phase artifacts with semantic validators (Slice 1)

- New optional `workflow_kit` section in `agentxchain.json` lets operators declare per-phase artifacts with semantic validators (`section_check`, `pm_signoff`, `acceptance_matrix`, `release_notes`).
- Parser and validator support with `_explicit` flag to distinguish operator-declared configs from normalization defaults.
- Default behavior unchanged when `workflow_kit` is absent.

### Workflow-kit gate integration (Slice 2)

- Phase-exit and run-completion gates now build an effective artifact set from both `requires_files` and `workflow_kit.phases[phase].artifacts`.
- Duplicate paths are merged by path — not evaluated twice.
- Workflow-kit semantics augment legacy gate semantics; they do not replace them.
- Missing optional workflow-kit artifacts do not block.

### Workflow-kit template validate and scaffold integration (Slice 3)

- `template validate` now reflects declared workflow-kit artifacts in `required_files` and generates `structural_checks` from `semantics` declarations when workflow_kit is explicit.
- `init --governed` scaffolds custom artifact files when an explicit `workflow_kit` config is present, with `section_check` artifacts getting required sections pre-filled as markdown headings.
- Reinit reads existing config for `workflow_kit` before overwriting.

### Fixed: explicit empty `workflow_kit: {}` template validation opt-out

- `workflow_kit: {}` now correctly behaves as an opt-out during `template validate`.
- Previously, explicit empty `workflow_kit` still produced default required files and structural checks.

### Operator docs for workflow-kit

- `getting-started.mdx`, `templates.mdx`, and `adapters.mdx` now explain the `workflow_kit` config section, how custom artifacts are scaffolded/validated, and the boundary between `routing`, `gates.requires_files`, and explicit `workflow_kit`.

### Evidence

- 2606 node tests / 558 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.1

`2.25.1` is the coordinator custom-phase proof patch.

`2.25.0` shipped operator-defined phases and ordered single-repo enforcement, but the coordinator custom-phase surface was still under-documented. This patch closes that gap: multi-repo docs now show the coordinator contract explicitly, and the shipped evidence surface now includes a dedicated subprocess proof for ordered coordinator custom phases.

### Multi-repo docs now explain coordinator custom phases directly

- `/docs/multi-repo` now shows a concrete `planning -> design -> implementation -> qa` coordinator example.
- The docs show the required matching child-repo `routing` shape.
- The docs state the coordinator rule plainly: `phase_transition_request` may only target the immediate next declared phase.
- The docs show the failure case too: `planning -> implementation` is rejected as `phase_skip_forbidden` when `design` exists between them.

This matters because coordinator workflow-shape drift is exactly where vague docs become operational errors.

### Coordinator custom-phase proof is now first-class evidence

- Added `cli/test/e2e-coordinator-custom-phases.test.js`.
- Happy path proves ordered transitions across two child repos and four phases.
- Negative path proves coordinator skip rejection without mutating coordinator state.
- `cli/test/multi-repo-docs-content.test.js` now guards the public docs against drifting away from that proof.

No coordinator runtime defect was found here. The implementation was already correct. What was missing was proof plus operator-facing contract language.

### Release surfaces remain synchronized

- Added the `v2.25.1` release-notes page and sidebar entry.
- Updated the homepage badge, conformance capabilities version, protocol implementor guide example, and launch evidence title.

### Evidence

- 86 node tests / 21 suites / 0 failures in focused coordinator proof and release/docs guards.
- Docusaurus production build passes.

## 2.25.0

`2.25.0` is the custom-phases release.

Previous releases assumed the governed lifecycle was permanently `planning -> implementation -> qa`. That contradicted the product vision. AgentXchain now supports operator-defined phase names in config, enforces declared phase order at runtime, and tells operators exactly where the default scaffold ends and custom-phase extension begins.

### Routing config can now declare custom phases

- Single-repo governed configs no longer hardcode `planning`, `implementation`, and `qa` as the only valid phases.
- Coordinator configs now derive valid phases from declared routing keys instead of rejecting any non-default name.
- Phase names must match `^[a-z][a-z0-9_-]*$` so they stay machine-safe and unambiguous.

This makes phases an operator-defined protocol surface instead of a hardcoded product assumption.

### Runtime phase transitions are now sequential and fail closed

- Single-repo runtime now enforces the same ordered phase contract as coordinator runtime.
- If routing declares `planning -> design -> implementation -> qa`, a turn may request only the immediate next phase.
- Final-phase turns may not request another phase transition and must use `run_completion_request`.
- Defense in depth exists in both turn-result validation and gate evaluation, so out-of-order transitions fail closed even if one layer is bypassed.

This closes a real protocol defect: single-repo runs previously accepted phase skips that coordinator runs already rejected.

### Scaffold and docs now explain the product boundary honestly

- `agentxchain init --governed` now prints `Phases: planning -> implementation -> qa (default; extend via routing in agentxchain.json)`.
- `getting-started.mdx` now has a dedicated custom-phases section with a concrete `design`-phase example.
- `adapters.mdx` documents the runtime contract: phase order comes from declaration order, custom phases require operator-supplied gate files, and only the immediate next phase is valid.

This matters because the default scaffold is still intentionally three-phase. Operators need to know that is a starting point, not the full product boundary.

### Evidence

- 3357 node tests / 0 failures.
- Docusaurus production build passes.

## 2.24.3

`2.24.3` is a coordinator-operator visibility release.

Previous releases built the coordinator execution surface (multi-repo orchestration, phase gates, blocked-state recovery, run-identity guards). But the dashboard and report surfaces were still presenting coordinator state as flat metadata strings. `2.24.3` closes that gap: coordinator blockers are now a structured, inspectable operator surface from CLI reports through the dashboard.

### Coordinator child run identity guard

Coordinator gates now verify that each child repo's `run_id` matches the expected value from the coordinator's `super_run_id` binding. When a child repo has been reset or restarted outside the coordinator's control, the gate rejects with `repo_run_id_mismatch` instead of silently proceeding against stale state. Recovery uses `agentxchain multi resume`.

### `repo_run_id_mismatch` in coordinator reports and CLI

`agentxchain multi step` and governed-run reports now surface `repo_run_id_mismatch` as a structured diagnostic with repo_id, expected run_id, and actual run_id — not a flat prose blocker string. The multi-repo docs include the new blocker code and recovery path.

### Dashboard coordinator blocker API and panel

New `/api/coordinator/blockers` endpoint computes a normalized blocker snapshot server-side using the existing gate evaluation library. Returns mode (`pending_gate`, `phase_transition`, `run_completion`), gate context, blocker codes, and structured detail for each blocker.

New **Blockers** dashboard view renders this snapshot as a pure display panel — no client-side gate logic. Renders mode badge, gate context, blocker codes with color coding, `repo_run_id_mismatch` expected/actual run_id diagnostic, and mode-aware recovery commands.

### Initiative view structured blocker integration

The initiative dashboard view now consumes the computed blocker snapshot instead of flattening coordinator state into a `blocked_reason` string. Coordinator attention state shows mode, gate context, and structured blocker details with a link to the full Blockers panel.

### Evidence

- 2537 node tests / 546 suites / 0 failures.
- Docusaurus production build passes.

## 2.24.2

`2.24.2` is an onboarding-truth patch release.

`2.24.1` closed the launch evidence gaps, but the shipped operator experience still had one inconsistency: `step` told no-key evaluators exactly how to recover a QA credential failure, while `run` only failed with the provider error. `2.24.2` closes that CLI drift and rolls the already-shipped mobile-nav fix into the next published package boundary.

### `run` now tells the truth on missing QA credentials

- `agentxchain run` now emits the same first-party no-key QA fallback as `agentxchain step` when a QA `api_proxy` dispatch fails with `missing_credentials`.
- The guidance is narrow and explicit:
  - edit `roles.qa.runtime` from `api-qa` to `manual-qa`
  - recover the retained QA turn with `agentxchain step --resume`
  - follow the getting-started guide for the mixed-mode scaffold
- This only appears when the failing role is `qa`, the runtime is the default `api-qa`, and the raw config actually defines the built-in `manual-qa` runtime. No generic "just rebind something" hand-waving.

### Automated onboarding proof now covers the real `run` path

- `run-api-proxy` integration coverage now proves the no-key QA path through the real `agentxchain run` surface.
- The test asserts the operator-facing contract, not just process failure:
  - non-zero exit
  - no outbound API request
  - missing env-var naming
  - explicit `manual-qa` fallback
  - exact `roles.qa.runtime` edit
  - truthful recovery command `agentxchain step --resume`
  - getting-started docs link

### The mobile-nav fix is now part of the released version boundary

- The narrow-width website nav collapse fix from `main` is included in the published version line after living on the website ahead of npm.
- The root cause remains the same: `backdrop-filter` on `.navbar` created a containing block for the fixed sidebar. The shipped fix disables that blur when the sidebar is shown, which is visually inert because the overlay covers the navbar anyway.

### Evidence

- 2503 node tests / 540 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.24.1

`2.24.1` is the corrected evidence-closure release.

`2.23.0` made proposal authority honest. `2.24.0` was an unpublished release-candidate tag that failed strict preflight because the public evidence sections lost their concrete node-test counts. `2.24.1` is the corrected public cut. It closes the remaining launch-critical proof gaps: MCP is now proven live against a real Anthropic model, Scenario D escalation and operator recovery are dogfooded end to end, and release postflight now verifies the public package through an isolated `npx -p` execution path instead of assuming npm visibility equals executable truth.

### MCP is now proven through a real model behind a real MCP server

- Added `examples/mcp-anthropic-agent/`, a thin stdio MCP server that exposes `agentxchain_turn` and forwards it to the Anthropic Messages API.
- Added `examples/live-governed-proof/run-mcp-real-model-proof.mjs`, which drives the governed CLI through the MCP adapter and proves the real provider path.
- The governed acceptance boundary now has concrete live evidence for: CLI -> MCP adapter -> MCP stdio transport -> MCP server -> Anthropic API -> JSON extraction -> validation -> acceptance.

### Scenario D escalation and recovery are now proven end to end

- Added `examples/live-governed-proof/run-escalation-recovery-proof.mjs`.
- The proof exercises retry exhaustion, run blocking, retained failed turn state, operator recovery, corrected dev acceptance, and `eng_director` intervention in one continuous governed path.
- This closes the gap between escalation logic existing in tests and escalation behavior being exercised through the real CLI workflow.

### Release postflight now proves the public `npx` path

- `cli/scripts/release-postflight.sh` now runs an isolated `npx --yes -p agentxchain@<version> -c "agentxchain --version"` smoke check with temp HOME/cache/npmrc state.
- This form matters. `npx agentxchain@<version> --version` is ambiguous under modern npm because `--version` can be consumed by `npm exec` instead of the package binary.
- Release postflight no longer stops at registry metadata and install smoke. It now verifies that the public package actually resolves and executes the way first-run users will invoke it.
- `RELEASE_POSTFLIGHT_SPEC.md` and `release-postflight.test.js` were updated to make that contract fail closed.

### Evidence

- 2486 node tests / 534 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.23.0

`2.23.0` is a proposal-authority release.

`2.22.0` closed budget and escalation recovery truth. `2.23.0` closes the cloud-agent authorship gap: API-backed agents can now propose governed file changes, operators can apply or reject them explicitly, gates fail closed until proposals are materialized, and the full completion path is proven live against a real provider.

### `api_proxy` proposal authoring is now shipped

- `write_authority: "proposed"` is now a first-class runtime contract for `api_proxy` roles.
- Proposed file changes are materialized under `.agentxchain/proposed/<turn_id>/` instead of being silently treated as workspace writes.
- Operators now have explicit proposal workflows: inspect, apply, or reject proposed files before continuing the governed run.
- Reserved internal orchestrator paths are rejected at the proposal boundary instead of being allowed to masquerade as product work.

### Proposal-aware gates and completion now fail closed

- Implementation-exit and run-completion gates now reject proposal-only state until the operator has applied the proposed files into the workspace.
- Completion-only proposed turns can now truthfully request `run_completion_request: true` with a no-op payload (`proposed_changes: []`, `files_changed: []`) instead of being forced into fake work delivery.
- Final-phase dispatch guidance now tells proposed roles exactly how to emit a completion turn instead of leaving the model to guess.

### Live proposed-authority proof is now real

- Full hardened live proof now passes against Anthropic Claude Sonnet 4.6: `run_7b067f892916b799`.
- Proposal turn `turn_78181787ad6ab3a7` emitted gate-valid `## Changes` and `## Verification` content from the real provider.
- Completion turn `turn_0ebc2190d01230ea` requested `run_completion_request: true`, paused on `pending_run_completion`, and completed only after human approval.
- The live proof harness now persists rejected provider payloads under `.planning/LIVE_PROOF_DIAGNOSTICS/` on failure so future reruns produce inspectable evidence instead of cleanup-amnesia.

### Cost truth is now operator-owned

- `config.budget.cost_rates` now overrides bundled defaults, so AgentXchain does not pretend to maintain a complete provider/model pricing catalog.
- Anthropic bundled defaults were corrected to the real published rates used in-product (`claude-opus-4-1-20250805`: `$15/$75` -> `$5/$25`; `claude-haiku-4-5-20251001`: `$0.80/$4.00` -> `$1.00/$5.00`).
- Bundled rates were renamed to `BUNDLED_COST_RATES` to make the boundary explicit: they are defaults, not the source of truth.

### Evidence

- 2476 node tests / 532 suites / 0 failures.
- 761 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.22.0

`2.22.0` is a governance depth release.

`2.21.0` closed front-door truth gaps. `2.22.0` closes the governance runtime gaps: cost control, escalation recovery, and operator guidance truthfulness.

### Budget enforcement

- `per_run_max_usd` and `on_exceed: 'pause_and_escalate'` are now enforced at runtime. Previously scaffolded as dead config.
- Post-acceptance exhaustion transitions the run to `blocked` with `budget_exhausted` category.
- Pre-assignment guard rejects new turns when the budget is already exhausted.
- Per-turn overrun warning emitted when actual cost exceeds reservation (advisory only).

### Budget recovery

- Operator raises `per_run_max_usd` in `agentxchain.json`, then `agentxchain resume` assigns the next turn.
- Budget is reconciled from config at load time, so `agentxchain status` shows current headroom.
- Proven through real CLI subprocess execution.

### Escalation recovery E2E proof

- Both escalation paths (retained-turn and run-level) are now proven through real CLI subprocess execution.
- Decision ledger contains `operator_escalated` and `escalation_resolved` entries after the full cycle.

### Runtime-aware escalation guidance

- Recovery action strings now vary by runtime type: `agentxchain resume` for manual runtimes, `agentxchain step --resume` for non-manual.
- Targeted multi-turn escalation appends `--turn <id>`.
- Stale pre-2.22.0 recovery actions are reconciled at load time.

### OpenAI cost rates

- Added built-in cost rates for 8 OpenAI models: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o3`, `o3-mini`, `o4-mini`.
- Unlisted models still work but report `$0` cost — adapter docs state this explicitly.

### Multi-provider governed proof harness

- Added `examples/live-governed-proof/run-multi-provider-proof.mjs` with mock-backed contract test.
- Proves multi-provider governed orchestration under deterministic mocks. Live execution blocked only by `OPENAI_API_KEY`.

### Evidence

- 2394 node tests / 514 suites / 0 failures.
- Docusaurus production build passes.

## 2.21.0

`2.21.0` is a truth-surface release.

`2.20.0` hardened release identity, but the product still had an honesty gap in the front door: onboarding docs had drifted from the real scaffold, several operator docs overstated or omitted shipped behavior, and comparison pages were unguarded marketing copy against moving competitors.

### Release completeness now fails closed in CI

- The publish workflow now treats downstream truth as a completion gate instead of advisory follow-through.
- Canonical Homebrew tap state must be provably current before the release workflow can finish green.
- The release playbook and release-doc guards were updated to match the shipped CI contract instead of a softer operator story.

### The onboarding path is now audited against the real scaffold

- Added `/docs/first-turn` as the bridge from `agentxchain demo` to a real governed repo.
- Audited `quickstart`, `templates`, `adapters`, `cli`, and `protocol` docs against actual CLI behavior and scaffold output.
- Added code-backed guards so these pages fail when examples drift from the shipped product surface.

### Comparison pages are now guarded public truth surfaces

- Refreshed all four shipped comparison pages against current official sources:
  - OpenAI Agents SDK: sessions, tracing, provider-agnostic model support, resumable HITL interrupts
  - CrewAI: task guardrails, checkpoint/resume, `@human_feedback`
  - LangGraph: `Command`, parallel supersteps, subgraphs, checkpoint-backed interrupts
  - AG2 / AutoGen: guardrails, Swarm-style handoffs, A2A / AG-UI support
- Added `comparison-pages-content.test.js` so homepage/nav routes, required page sections, and competitor-strength claims stay anchored to the positioning matrix.

### Evidence

- 2372 node tests / 511 suites, 0 failures.
- 761 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.

## 2.20.0

The release path is now harder to lie about. This release replaces raw `npm version` with a fail-closed release-identity command, marks downstream Homebrew truth as required for release completion, and proves the new contract with execution-level tests instead of string-matching shell scripts.

### Release Identity Hardening

- Added `npm run bump:release -- --target-version <semver>` as the supported release-identity path.
- `release-bump.sh` now:
  - runs `npm version --no-git-tag-version`
  - creates commit `<semver>`
  - creates annotated tag `v<semver>`
  - verifies the tag is an annotated tag object
  - verifies the tag dereferences to the release commit before exiting 0
- Raw `npm version <semver>` is no longer the documented release-identity mechanism.

### Downstream Truth Is Required

- `.planning/RELEASE_PLAYBOOK.md` now marks both downstream update and downstream truth verification as required steps.
- The playbook now states explicitly that a stale canonical Homebrew tap means the release is incomplete.
- When CI cannot push the canonical tap because `HOMEBREW_TAP_TOKEN` is absent, the operator contract now requires local `sync:homebrew --push-tap` follow-through instead of treating the warning as sufficient.

### Execution-Level Proof

- Added subprocess release-identity tests that create a temp git repo rooted above `cli/`, run `release-bump.sh`, and assert:
  - `package.json` and `package-lock.json` are updated
  - the release commit message is `<semver>`
  - the tag object is annotated
  - the tag dereferences to `HEAD`
- Added fail-closed tests for dirty-tree rejection and pre-existing target tags.

### Evidence

- 2338 node tests / 508 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- `release-bump.sh` temp-repo proof passes, including dirty-tree and pre-existing-tag failure cases.

## 2.19.0

AgentXchain now has an honest one-command first-run path. This release ships the `demo` command, moves the adoption funnel to demo-first across the front door, upgrades the demo narrative to a security-sensitive scenario that actually demonstrates governance value, and prevents baseline evidence paths from poisoning later governed turns.

### Demo-First Adoption

- Added `agentxchain demo`, a one-command governed lifecycle walkthrough that runs in a temp git workspace, stages real turn results through the runner interface, and cleans up automatically.
- Front-door adoption surfaces now lead with `npx agentxchain demo`:
  - root `README.md`
  - `cli/README.md`
  - homepage hero CTAs
  - quickstart Path 0
- Discoverability guards now fail if the demo falls out of the README, package README, quickstart, or homepage.

### Higher-Signal Demo Narrative

- The demo story now centers on auth token rotation instead of a toy counter app.
- PM, Dev, and QA objections now surface consequence-bearing failures:
  - missing rollback path could invalidate live API keys
  - clock skew could skip or double-rotate keys
  - missing failure-audit entries create a compliance gap
- Demo lessons now explain the cost of ungoverned delivery instead of restating abstract governance rules.

### Baseline Evidence Hardening

- `.planning/AGENT-TALK.md`, `.agentxchain/reviews/`, and `.agentxchain/reports/` no longer poison the next governed actor's baseline-dirty check.
- Evidence paths remain observable for the turn that creates them, but unchanged pre-existing evidence dirt is filtered out of later same-HEAD and head-changed observation.
- Authoritative follow-up turns can now succeed without committing derived review/report artifacts first.

### Evidence

- 2315 node tests / 499 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.
- Demo proof: `agentxchain demo` completes in ~1.1s with 5 decisions and 3 objections.

## 2.18.0

The governed lifecycle now works correctly in git-backed workspaces with proper artifact observation, all four adapter types have live execution evidence (MCP at transport level), and the full governed completion path is proven end to end.

### Live Connector & Completion Proof

- All four adapter types (`manual`, `local_cli`, `api_proxy`, `mcp`) now have live CLI execution evidence through real `agentxchain step` dispatch.
- MCP proof covers both `stdio` and `streamable_http` transports (transport-level with echo agents, not model-level).
- Terminal governed completion is proven live: `pending_run_completion` → `approve-completion` on a retained workspace.
- Governed PM signoff DX hardened: scaffolds ship with `Approved: NO` by default, with explicit guidance on the human-approval flip.

### Artifact Observation Fixes

- `compareDeclaredVsObserved` now degrades gracefully when git observation is unavailable instead of manufacturing phantom-artifact failures from an empty diff.
- Context-section parser now correctly handles `### Verification` subsections and code blocks containing markdown headers within `Gate Required Files`.
- CI proof scripts and test fixtures now initialize proper git repos so the repo-observer can detect file changes across turns.

### QA & Evidence Depth

- QA evidence visibility: verification details, changed-file previews, dispatch-log excerpts, and gate-file content previews now surface in review context.
- Turn-result normalization handles `artifacts_created` object coercion, exit-gate-to-phase correction, missing-status recovery, and terminal completion signaling.
- Phase-aware prompt guidance ensures authoritative roles request explicit phase transitions.
- Review-turn context now includes bounded changed-file previews and semantic gate-file annotations.

### Evidence

- 2290 node tests / 495 suites, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers.
- Live completion: `run_91f4ba5d54707a7e` completed at `2026-04-07T11:14:16.734Z`.
- Live MCP dogfood: `turn_e41e35ba8eea9768` (stdio), `turn_5292f4de9e01ea71` (streamable_http).

## 2.17.0

Protocol conformance now proves the workflow-kit semantics it previously left implicit, and the public implementor guide now states the exact fixture-backed contract for every shipped surface instead of collapsing proof into slogans.

### Workflow Gate Conformance Expansion

- Tier 1 `gate_semantics` now proves semantic failures for:
  - `.planning/SYSTEM_SPEC.md` missing required sections
  - `.planning/IMPLEMENTATION_NOTES.md` scaffold-placeholder content
  - `.planning/acceptance-matrix.md` placeholder requirement tables
  - `.planning/RELEASE_NOTES.md` placeholder ship-surface content
- The Tier 1 corpus increased from `46` to `50` fixtures.
- The total conformance corpus increased from `74` to `81` fixtures across all three tiers.

### Implementor Guide Truth Contracts

- `/docs/protocol-implementor-guide` now enumerates the concrete fixture-backed invariants for all shipped surfaces:
  - Tier 1: `state_machine`, `turn_result_validation`, `gate_semantics`, `decision_ledger`, `history`, `config_schema`
  - Tier 2: `dispatch_manifest`, `hook_audit`
  - Tier 3: `coordinator`
- Section-aware docs guards now fail if any surface regresses back to vague summary text while the fixture corpus still proves specific invariants.
- Release-surface version truth stays aligned across the homepage badge, `capabilities.json`, release notes, and the implementor-guide example.

### Evidence

- 2224 node tests / 489 suites, 0 failures.
- 705 Vitest tests / 36 files, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers (Tier 1: 50, Tier 2: 23, Tier 3: 8).
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.17.0` live on registry.

## 2.16.0

Coordinator governance reporting is now operational instead of partial, workflow-kit gates now enforce the repo-native planning contract they already claimed to depend on, and external consumers can dispatch a real adapter-backed turn from the published package boundary.

### Coordinator Governance Report Completion

- Coordinator exports now write real decision-ledger entries during init, dispatch, gate, and recovery flows instead of exposing an empty report surface.
- `agentxchain report` for coordinator workspaces now includes:
  - coordinator timeline
  - coordinator timing
  - barrier summary
  - barrier transition history from `barrier-ledger.jsonl`
  - deterministic next actions from verified coordinator state
  - coordinator decision digest from `decision-ledger.jsonl`
- Coordinator report docs were updated in the same slice so the operator contract matches the shipped JSON, text, and markdown surfaces.

### Workflow-Kit Gate Truth

- Governed planning now fails closed when the scaffolded workflow-kit contract drifts:
  - baseline planning system spec enforcement
  - template-specific `SYSTEM_SPEC.md` overlays
  - implementation-exit gate requires `IMPLEMENTATION_NOTES.md`
  - QA gate enforces acceptance-matrix semantics
  - ship gate enforces release-notes presence
- These checks turn repo-native planning/docs artifacts into real gate inputs instead of dead files that the product claimed to care about but did not enforce.

### Adapter-Backed External Consumer Starter

- `examples/external-runner-starter/run-adapter-turn.mjs` now proves the published `agentxchain/adapter-interface` boundary from a clean consumer install.
- The starter uses `dispatchLocalCli`, generates its own deterministic mock agent at runtime, and drives a real dispatch → stage → accept flow.
- Pack-and-install proof now guards both external adoption paths:
  - manual runner-interface starter
  - adapter-backed starter

### Evidence

- 2186 node tests / 483 suites, 0 failures.
- Tier 1: 46 / 46 conformance fixtures passing.
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.16.0` live on registry.

## 2.15.0

The intake-to-coordinator workflow is now proven end to end: handoff, blocked-state recovery, hook-stop asymmetry, and repo-local intake-to-run automation continuity all ship with real subprocess E2E proofs.

### Intake-to-Coordinator Handoff

- `intake handoff` bridges source-repo intent to a coordinator workstream, bound by `super_run_id`.
- Coordinator context (`COORDINATOR_CONTEXT.json` and `.md`) is rendered into coordinator artifacts as informational references.
- Coordinator-root intake errors now enumerate child repos instead of returning opaque failures.
- Handoff is front-door discoverable in README, cli README, quickstart, and multi-repo docs.
- E2E proof: `e2e-intake-coordinator-handoff.test.js` drives real CLI dispatch through `multi step`, `accept-turn`, and `multi approve-gate`.

### Blocked-State Recovery

- New `multi resume` command recovers coordinators from `blocked` state.
- `multi resume` resyncs child repos first, fails closed on blocked children, restores `active` or `paused`, and records `blocked_resolved` history entries.
- `intake resolve` now accepts `blocked` as a valid source state, enabling the same run/workstream to recover to `completed`.
- E2E proof: `e2e-intake-coordinator-blocked.test.js` uses a real `after_acceptance` tamper-detection hook violation to drive `blockCoordinator()`.

### Coordinator Hook-Stop Asymmetry

- Pre-action hooks are idempotent barriers that reject operations without persisting `blocked` state.
- Post-action hooks can persist `blocked` and fire `on_escalation`.
- The distinction is now documented, spec'd (`COORDINATOR_HOOK_ASYMMETRY_SPEC.md`), and guarded by `coordinator-hook-asymmetry.test.js`.

### Intake-to-Run Integration

- `intake start` hands off to `agentxchain run` through the same `run_id` — the runner adopts the intake-started run rather than silently creating a new one.
- E2E proof: `e2e-intake-run-integration.test.js` drives the full `record → triage → approve → plan → start → run → resolve` sequence through CLI subprocesses.

### Interface Alignment Barriers

- Real `interface_alignment` barriers shipped with end-to-end multi-repo docs example.
- Runner adoption docs tightened with Tier 3 conformance requirements.

### Evidence

- 2048 node tests / 457 suites, 0 failures.
- 694 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Docusaurus production build passes.

## 2.14.0

External runner adoption is now a real package contract instead of a docs promise. This release adds a canonical installed-package starter, proves the packed tarball works in a clean consumer project, and extends release postflight so a publish is not complete unless the public runner exports import successfully.

### External Runner Package Contract

- New `examples/external-runner-starter/run-one-turn.mjs` provides the canonical installed-package one-turn starter for external runner authors.
- New `examples/external-runner-starter/README.md` distinguishes repo-native CI proof scripts from the installed-package starter instead of pretending they are the same surface.
- New `external-runner-package-contract.test.js` packs the real tarball, installs it into a temp project, and runs the starter through `agentxchain/runner-interface`.

### Runner Docs And Example Accuracy

- `/docs/build-your-own-runner` and `/docs/runner-interface` now name `agentxchain/runner-interface` and `agentxchain/run-loop` as the external contract, not repo source paths.
- Runner docs now explicitly separate repo-native proofs (`examples/ci-runner-proof/`) from external-consumer starter code.
- The repo-native proof README now states its real purpose instead of implying that external consumers should copy repo-relative imports.

### Release Truth Hardening

- `release-postflight.sh` now fails closed unless the published package passes both smoke surfaces:
  - CLI binary execution
  - runner package export import (`agentxchain/runner-interface` and `agentxchain/run-loop`)
- `release-postflight.test.js` now guards runner-export smoke, including the failure path where the published interface version drifts.

### Evidence

- 1970 node --test tests / 441 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

## 2.13.0

Multi-repo onboarding is now front-door discoverable, and the protocol conformance kit proves the semantic workflow gates it already claimed to enforce.

### Multi-Repo Onboarding

- The multi-repo cold-start path is now linked from all front-door surfaces: root `README.md`, `cli/README.md`, and the landing page.
- New guard coverage prevents multi-repo mentions from regressing back into feature-name-only dead ends with no onboarding pointer.
- The shipped `/docs/quickstart#multi-repo-cold-start` walkthrough is now the explicit operator path for coordinator setup.

### Protocol Conformance Expansion

- Tier 1 `gate_semantics` now proves `evaluateRunCompletion()` directly instead of stopping at phase-exit behavior.
- New fixtures prove negative semantic truth for `.planning/PM_SIGNOFF.md` and `.planning/ship-verdict.md`, including rejected signoff, missing approval marker, non-affirmative ship verdict, human-approval pause, immediate completion, and non-final-phase rejection.
- The reference conformance adapter now supports `evaluate_run_completion`, so third-party implementations can prove the same ship-verdict contract the reference CLI enforces.

### Release Surface Hardening

- `capabilities.json` and the protocol implementor guide example are now version-synced and guarded.
- New `current-release-surface.test.js` enforces that package version, changelog, release-notes route, sidebar, homepage badge, capabilities example, and implementor guide example stay aligned.

### Evidence

- 1949 node --test tests / 437 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

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
