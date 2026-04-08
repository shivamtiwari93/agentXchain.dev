# Launch Evidence Report — AgentXchain v2.25.2

> Single-source evidence artifact for all launch-facing claims. Updated 2026-04-08 for the v2.25.2 workflow-kit release.

---

## 1. Evidence Inventory

### E1 — Automated Test Suite

- **Date**: continuously maintained through 2026-04-02
- **Location**: `cli/test/` (run via `cd cli && node --test`)
- **Result**: 1033 tests, 0 failures across 235 suites
- **What it proves**:
  - Governed state machine transitions: init, step, accept, reject, approve-transition, approve-completion, resume, migrate
  - Schema validation for turn results (v1 schema)
  - Three adapter types: manual, local_cli, api_proxy (unit + integration)
  - Dispatch bundle generation and staging
  - Blocked state entry, persistence, and recovery
  - Phase gate evaluation and enforcement
  - Hook lifecycle across all 8 phases with verdict handling, tamper detection, and audit trail
  - Normalized config loading and validation
  - Repo observer classification (product files vs orchestrator state)
  - Dashboard: bridge server, views, app shell, command-level CLI, E2E, content/docs assertions
  - Plugin system phase 1 + v2.1 hardening: manifest validation, install/list/remove/upgrade CLI, enforced `config_schema`, conflict-safe hook merge, atomic rollback, validated runtime config injection
  - Protocol v6 docs surface: normative markdown, published HTML, versioned permalink, and planning-spec drift assertions
  - Plugin docs surface: published HTML, CLI reference integration, nav consistency, planning-spec alignment, rollback/failure-mode documentation
  - Dispatch manifest integrity: finalize/verify, tamper detection (unexpected file, digest mismatch, missing file, size mismatch), supplement inclusion, adapter verification integration
  - HTTP hook transport: blocking/advisory verdicts, timeout fail-closed, env-backed header interpolation with unresolved-placeholder rejection, non-2xx failure handling, annotation recording, audit trail with transport field
  - Dashboard evidence drill-down: turn detail panels with hook annotations/audit, decision ledger filters (phase, date range, objection), hook audit filters (phase, verdict, hook name)
  - Context compressor, token counter, token budget
  - Proposal-aware governance: `api_proxy` proposed-authority authoring, phase-exit gates reject proposal-only files, run-completion gates reject proposal-only files, full governed lifecycle with proposal apply across implementation and QA phases (E2E subprocess proof)
  - Release preflight and publish scripts
  - Competitive positioning and documentation content assertions
- **What it does NOT prove**:
  - Live LLM interaction (all adapter tests use mocks or stubs)
  - Real git repository state transitions (tests use temp directories with synthetic state)
  - Multi-machine or CI-environment behavior
  - npm package installation from the registry

### E2 — Live Scenario A Dogfood

- **Date**: 2026-04-01 initial run, 2026-04-07 rerun
- **Location**: `.planning/LIVE_SCENARIO_A_REPORT.md`, `.planning/LIVE_SCENARIO_A_RERUN_2026-04-07.md`
- **Run IDs**: `run_399aea020ebb68d4`, `run_99e509c066d2daa9`, `run_cfae0bd99a4f5643`, `run_91f4ba5d54707a7e`
- **Result**: live connector proof confirmed; final-phase QA review, governed completion signaling, and `approve-completion` are now proven live for the `manual` + `local_cli` + `api_proxy` path
- **What it proves**:
  - Manual PM turn: dispatched, staged, accepted, planning gate approved in both runs
  - `local_cli` dev turn completed against live Claude Code in the rerun (`turn_555bf457840b6268`)
  - `api_proxy` QA turn against live Anthropic (claude-sonnet-4-6): dispatched, received provider response, staged, accepted
  - Provider usage telemetry captured in live QA turns
  - Schema validation caught a real model compliance issue (`artifacts_created[]` objects instead of strings) — proves the validation layer rejects non-compliant output
  - `accepted_integration_ref` semantics confirmed: git lineage anchor in state, exact workspace snapshot in `history.jsonl`
  - All three core runtimes used in the governed path (`manual`, `local_cli`, `api_proxy`) now have live execution evidence in one run
  - Review-turn context now includes changed-file previews for review-only QA retries, and live QA evidence shows that this removes speculative code-visibility objections
  - A fresh live rerun after prompt hardening (`run_cfae0bd99a4f5643`) proved the dev turn now completes truthfully with a single zero-exit verifier (`bash test.sh`, 13/13 assertions) instead of staging a validator-invalid `pass` result with non-zero negative-case commands
  - A follow-up live QA retry after raising the changed-file preview cap from 80 to 120 lines removed the earlier syntax-completeness objection caused by truncating an 81-line `todo.js`
  - A later QA-only continuation on the same governed todo path (`turn_fd7f82248d8562b3`) accepted cleanly without the two earlier `api_proxy` output defects:
    - no `artifacts_created[]` schema drift
    - no invalid `phase_transition_request: "qa_ship_verdict"`
  - Accepted `api_proxy` review turns now materialize a real review artifact under `.agentxchain/reviews/<turn_id>-<role>-review.md` instead of recording a missing artifact ref
  - Public docs/example surfaces now state the real boundary: `api_proxy` QA returns a structured review but does not directly author `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, or `.planning/RELEASE_NOTES.md`
  - A later retained live QA turn (`turn_cd88863ae5a8619e`) proved a third narrow recovery path:
    - provider omitted top-level `status`
    - payload still contained explicit forward-progress intent (`phase_transition_request: "qa"`)
    - after the status-omission normalization patch, the same staged result was accepted without manual JSON edits
  - A follow-up live dev turn (`turn_1b22674c77374e55`) closed the specific QA objections around duplicate-ID risk, cwd-relative storage, and missing negative-case machine evidence, raising the verifier from `24/24` to `28/28`
  - A later retained live dev verification turn (`turn_34b01846000101a2`) proved implementation -> qa transition intent live after the phase-aware prompt fix:
    - re-ran verification with `28/28` passing assertions
    - explicitly requested `phase_transition_request: "qa"`
    - advanced governed state to `phase: "qa"` with `implementation_complete: "passed"`
  - The final-phase QA turn in that same run (`turn_8fa2ffe2abc2f3b0`) proved terminal review-context sufficiency live:
    - accepted in the real `qa` phase
    - correctly identified that `.planning/acceptance-matrix.md` still cited `24 passed`
    - correctly identified that `.planning/RELEASE_NOTES.md` still cited `24 passed`
    - these objections only exist if gate-file previews were actually visible in `CONTEXT.md`
  - A fresh terminal QA turn in that same retained run (`turn_9710c088069f0ff2`) proved governed completion signaling live:
    - accepted as `completed`
    - requested `run_completion_request: true`
    - paused the run with `pending_run_completion.gate = "qa_ship_verdict"`
    - explicit human approval via `agentxchain approve-completion` completed the run at `2026-04-07T11:14:16.734Z`
- **What it does NOT prove**:
  - Full machine-verifiable stdout/stderr proof for the dev test run
  - Independent QA execution of the dev test suite from the `api_proxy` runtime

### E2b — Live MCP Adapter Dogfood

- **Date**: 2026-04-07
- **Location**: `.planning/MCP_LIVE_DOGFOOD_REPORT.md`
- **Run IDs**: `run_5c008f7e6bc4b721` (stdio), `run_210040f7b9437431` (streamable_http)
- **Turn IDs**: `turn_e41e35ba8eea9768` (stdio), `turn_5292f4de9e01ea71` (streamable_http)
- **Result**: both MCP transports proven live through real `agentxchain step` CLI
- **What it proves**:
  - MCP stdio transport: governed dev turn dispatched to `mcp-echo-agent` via subprocess, accepted by state machine
  - MCP streamable_http transport: governed dev turn dispatched to `mcp-http-echo-agent` via HTTP, accepted by state machine
  - MCP tool contract (13 arguments) correctly marshalled and result correctly extracted
  - Custom HTTP headers forwarded for streamable_http transport
  - Turn results pass validation and are accepted into governed history
  - All four adapter types (`manual`, `local_cli`, `api_proxy`, `mcp`) now have live CLI execution evidence
- **What it does NOT prove**:
  - MCP adapter behavior under production-scale context or long-running turns
  - Full governed lifecycle through MCP (one dev turn per transport, not a complete run)

### E2b+ — Live MCP Real-Model Proof

- **Date**: 2026-04-08
- **Location**: `examples/live-governed-proof/run-mcp-real-model-proof.mjs`, `examples/mcp-anthropic-agent/server.js`
- **Run ID**: `run_83a64c7bb6925711`
- **Turn ID**: `turn_c8703d87f325e108`
- **Provider**: Anthropic Claude `claude-haiku-4-5-20251001`
- **Cost**: 1,630 input tokens + 649 output tokens
- **Result**: **PASS.** MCP stdio transport proven with a real Anthropic model behind the MCP server.
- **What it proves**:
  - MCP server (`mcp-anthropic-agent`) receives `agentxchain_turn` tool call and forwards prompt/context to real Anthropic API
  - Real model returns structured turn-result JSON (not canned/echo)
  - Turn result passes governed validation and is accepted into state machine history
  - Real token usage recorded (1,630 input + 649 output)
  - The full path works: CLI → MCP adapter → MCP stdio transport → MCP server → Anthropic API → JSON extraction → validation → acceptance
- **What it does NOT prove**:
  - Streamable HTTP transport with a real model (only stdio proven)
  - Full governed lifecycle through MCP with a real model (single dev turn)
  - MCP with OpenAI or other providers (only Anthropic proven)

### E2d — Scenario D Escalation & Recovery Proof

- **Date**: 2026-04-08
- **Location**: `examples/live-governed-proof/run-escalation-recovery-proof.mjs`
- **Run ID**: `run_ebf10c05d7419a0c`
- **Turn IDs**: `turn_62dc3552e94dc5a9` (dev, rejected twice → escalated), `turn_c88f47a0ca64e8cc` (eng_director, accepted)
- **Result**: **PASS.** Retry exhaustion → escalation → operator recovery → eng_director intervention proven end-to-end.
- **What it proves**:
  - D1: Two rejections exhaust `max_turn_retries=2`, run transitions to `blocked` with `escalation:retries-exhausted:dev`
  - D1: Escalation state preserves `from_role`, `from_turn_id`, rejection reason, and timestamps
  - D1: `blocked_reason.recovery.typed_reason = 'retries_exhausted'` with `turn_retained = true`
  - D1: Failed turn remains in `active_turns` with `status: 'failed'` (not cleared)
  - D1: `reactivateRun` clears blocked state, nulls escalation, records `escalation_resolved` in decision ledger
  - D2: After recovery, operator accepts corrected dev result, then assigns `eng_director`
  - D2: Director turn accepted with objection (protocol requirement for review_only roles)
  - D2: Director proposes `human` as next role (correct escalation-to-human governance)
  - Full path: assign dev → reject → retry → reject → escalate → recover → accept fix → director → accept
- **What it does NOT prove**:
  - Escalation with real LLM output (uses manual adapter with crafted results)
  - `on_escalation` hooks firing to external notification systems
  - Multi-turn director review across multiple deadlock cycles

### E2c — Live Proposed-Authority Dogfood

- **Date**: 2026-04-07 initial proof, 2026-04-08 contract-fix + semantic-hardening reruns + full pass
- **Location**: `examples/live-governed-proof/run-proposed-authority-proof.mjs`, `.planning/LIVE_PROPOSED_AUTHORITY_PROOF_SPEC.md`
- **Run IDs**: `run_9cff2c5a43cb4205` (historical core lifecycle pass), `run_bd9c4727f572a091` / `run_379dcb010755a00c` / `run_c07051c5bdea9975` (intermediate hardened reruns), `run_7b067f892916b799` (full hardened live pass)
- **Turn IDs**: `turn_78181787ad6ab3a7` (proposal turn, accepted attempt 3), `turn_0ebc2190d01230ea` (completion turn, accepted attempt 2)
- **Provider**: Anthropic Claude `claude-sonnet-4-6`
- **Cost**: proposal turn $0.031, completion turn $0.015 — total $0.046
- **Result**: **FULL PASS.** Hardened live proposed-authority proof passed end-to-end on 2026-04-08. The proposal turn emitted gate-valid `## Changes` + `## Verification` content, `proposal apply` copied the file to workspace, the completion turn set `run_completion_request: true` with no-op payload, the run paused on `pending_run_completion` with `awaiting_human_approval`, and `approve-completion` finished the run to `completed` state.
- **What it proves**:
  - Real Anthropic model returns valid `proposed_changes[]` with gate-valid content (exact `## Changes` and `## Verification` sections with real prose)
  - Proposal materialization under `.agentxchain/proposed/<turn_id>/` works with real model output
  - `IMPLEMENTATION_NOTES.md` confirmed in proposed dir but NOT in workspace before apply
  - `proposal apply` copies real-model-proposed files into the workspace
  - Completion turn with `run_completion_request: true` and no-op payload (`proposed_changes: []`, `files_changed: []`) accepted by validator
  - Implementation gate passes after proposal apply, run pauses on `pending_run_completion` with `awaiting_human_approval`
  - `approve-completion` transitions run to `completed` state
  - Decision ledger records the proposal-apply entry
  - The hardened proof harness rejects scenario-wrong staged outputs before `acceptTurn`
  - The hardened proof harness rejects proposal artifacts that would fail the implementation gate later
  - Full validation pipeline (schema, objection requirement, file-change declaration) processes real model output
  - Real-provider failure modes are concrete: observed intermediate rerun failures included invalid `proposed_next_role`, internal `.agentxchain/staging/.../turn-result.json` proposal paths, extraction failure, omitted `run_completion_request`, and proposal turns with missing gate-valid sections — all now resolved by contract fixes in Turn 133 and prompt tightening
- **What it does NOT prove**:
  - Multi-provider proposed authority (only Anthropic tested; `OPENAI_API_KEY` absent)
  - Large-scale or complex file proposals
  - Conflict detection with real provider output (covered by mock E2E)

### E3 — Live API Proxy Preflight Smoke

- **Date**: 2026-04-01 (initial) through 2026-04-02 (stabilization)
- **Location**: `.planning/LIVE_API_PROXY_PREFLIGHT_REPORT.md`
- **Result**: pass (after stabilization)
- **What it proves**:
  - Preemptive tokenization: local overflow short-circuit works (refuses to call provider when input exceeds budget)
  - Provider-backed happy path: dispatch succeeds, staged output is validator-clean (`validation_ok = true`)
  - Token budget audit artifacts (`TOKEN_BUDGET.json`) are written for both send and no-send paths
  - Retry trace artifacts are written with per-attempt accounting
- **What it does NOT prove**:
  - Preflight behavior under production-scale context (tested with small example project only)
  - Compression-path preflight (context compressor integration not smoke-tested live)

### E4 — Dashboard Implementation

- **Date**: 2026-04-02
- **Location**: `cli/dashboard/`, `cli/src/lib/dashboard/`, `cli/src/commands/dashboard.js`
- **Result**: implemented and tested
- **What it proves**:
  - Read-only localhost dashboard with 7 views: 5 repo-local panels plus coordinator `initiative` and `cross-repo` views
  - Bridge server with WebSocket invalidation + HTTP refetch
  - Static asset routing with path-traversal containment
  - HTTP mutation rejection (405) and WebSocket mutation rejection (structured error)
  - Gate evidence aggregation across post-boundary turns
  - HTML escaping for both quote characters
  - Copy-to-clipboard affordance for operator commands
- **What it does NOT prove**:
  - Dashboard behavior with large history files (>1000 turns)
  - Dashboard behavior under concurrent operator access
  - Browser compatibility beyond the test harness (Node.js fetch/WebSocket only)

### E5 — Hook System Implementation

- **Date**: 2026-04-02
- **Location**: `cli/src/lib/hook-runner.js`, `cli/test/hook-runner.test.js`, `cli/test/e2e-hook-composition.test.js`
- **Result**: implemented and tested
- **What it proves**:
  - 8 lifecycle hook phases with verdict handling (allow/warn/block)
  - Core file tamper detection for `after_dispatch`
  - Advisory annotation persistence to `hook-annotations.jsonl`
  - Audit trail to `hook-audit.jsonl`
  - Circular invocation prevention (`on_escalation` excludes hook-caused blocks)
  - `before_gate` block preserves pending approvals for replay
- **What it does NOT prove**:
  - Hook behavior with long-running or hanging hook processes
  - Hook behavior under concurrent turns (v1.1 scope)

---

## 2. Allowed Claims

Each claim is anchored to specific evidence. Launch surfaces may use these claims.

| Claim | Evidence | Notes |
|-------|----------|-------|
| "1000+ tests" | E1 (1033 tests as of 2026-04-03) | Use floor-hundred format per DEC-SHOW-HN-003. |
| "Every turn must include an objection / blind agreement is rejected" | E1 (schema validation tests, governed-state tests) | Protocol-level enforcement, not a suggestion. |
| "The protocol requires human approval for phase transitions and final completion" | E1 (gate-evaluator tests, governed-state tests) + E2 (planning gate approved live, final completion approved live) | Phrase this as a protocol guarantee first; live approval evidence now exists for the three-adapter dogfood path. |
| "Append-only audit trail" / "structured history" | E1 (history.jsonl tests) + E2 (live history entries captured) | |
| "Model-agnostic / runtime-swappable" | E1 (adapter coverage) + E2 (manual + local_cli + api_proxy completed live) + E2b (MCP stdio + streamable_http completed live) | All four adapter types now have live CLI execution evidence. |
| "All four adapters proven live" | E2 (manual + local_cli + api_proxy) + E2b (MCP stdio + streamable_http) + E2b+ (MCP with real Anthropic model) | All adapter types have been dispatched through the real `agentxchain step` CLI and accepted by the governed state machine. MCP now proven with both echo agents and a real AI model. |
| "Manual, local CLI, API-backed, and MCP agents all run under the same protocol" | E1 (adapter tests) + E2 + E2b | All four adapter types proven live through the governed CLI. |
| "A full governed run is proven live for the `manual` + `local_cli` + `api_proxy` path, including human-gated completion approval" | E2 (`run_91f4ba5d54707a7e`, `turn_9710c088069f0ff2`, live `approve-completion`) | Full lifecycle proof exists only for the three-adapter path. MCP proof is a single dev turn per transport. |
| "`api_proxy` review turns produce real review artifacts and fail closed on phantom review-file claims" | E1 (new governed-state/repo-observer tests) + E2 (live QA-only continuation wrote `.agentxchain/reviews/turn_fd7f82248d8562b3-qa-review.md`) | Phrase narrowly. This is review-artifact truth, not a claim that `api_proxy` writes QA gate files. |
| "`api_proxy` proposed-authority turns are proven through full governed lifecycle with gate enforcement" | E1 (e2e-api-proxy-proposed-lifecycle, e2e-api-proxy-proposed-authoring, e2e-proposal-aware-gates, e2e-proposal-aware-run-completion) | Four subprocess E2E tests prove: proposal materialization, gate rejection of proposal-only files, proposal apply enabling gate pass, and full lifecycle through implementation and QA with operator approval. |
| "`api_proxy` proposed-authority lifecycle (staging, materialization, proposal apply) is proven live against real Anthropic" | E2c (`run_9cff2c5a43cb4205`, `run_7b067f892916b799`) | Core lifecycle proven live. |
| "Full `api_proxy` proposed-authority run completion is proven live against a real provider" | E2c (`run_7b067f892916b799`: proposal turn `turn_78181787ad6ab3a7` + completion turn `turn_0ebc2190d01230ea`, run paused on `pending_run_completion`, `approve-completion` completed the run) | Hardened live proof with gate-valid proposal content, no-op completion, and human-gated approval. |
| "Retry exhaustion triggers governed escalation with operator recovery and eng_director intervention" | E2d (`run_ebf10c05d7419a0c`: dev rejected twice → `escalation:retries-exhausted:dev` → reactivate → corrected dev accepted → eng_director turn accepted) | Full D1+D2 path proven. Escalation state, recovery descriptor, decision ledger entry, and director governance all verified. |
| "The acceptance boundary can recover a coherent `api_proxy` review payload that omits `status` but includes an explicit transition/completion signal" | E1 (new turn-result-validator normalization tests) + E2 (retained live QA turn `turn_cd88863ae5a8619e`) | Phrase narrowly. This is missing-status recovery, not general malformed-payload forgiveness. |
| "Governed state survives adapter failure" | E2 (local_cli quota exhaustion did not corrupt state) | |
| "Schema validation catches non-compliant output" | E2 (QA turn failed initial validation, was normalized) | |
| "Preemptive tokenization prevents wasted API calls" | E3 (local overflow short-circuit confirmed live) | |
| "Read-only dashboard for governance visibility" | E4 (implemented, tested, documented) | |
| "Hook system for lifecycle customization" | E5 (8 phases, verdict handling, audit trail) | |
| "MIT licensed" | `LICENSE` file in repo | |

## 3. Disallowed Claims

Current evidence does NOT support these claims. Launch surfaces must not use this language.

| Disallowed Claim | Why | What Would Fix It |
|------------------|-----|-------------------|
| ~~"Full live end-to-end proof with MCP"~~ | **CLOSED 2026-04-08.** E2b+ proves MCP transport works with a real Anthropic model (`run_83a64c7bb6925711`, `turn_c8703d87f325e108`). MCP server calls `claude-haiku-4-5-20251001`, returns real model output, turn accepted by governed state machine. | N/A — proven. |
| ~~"`api_proxy` proposed-authority run completion is proven live against a real provider"~~ | **CLOSED 2026-04-08.** `run_7b067f892916b799` passed all 5 criteria: proposal turn with gate-valid content, `proposal apply`, no-op completion request, `pending_run_completion` pause, and `approve-completion`. Previously disallowed due to product contract bug (`DEC-PROP-COMPLETION-CONTRACT-001`) and proposal-turn semantic reliability; both resolved. | N/A — proven. |
| "Production-proven" or "battle-tested" | No production deployment evidence exists. All evidence is from development/dogfood environments. | Post-release operator evidence from real projects. |
| "OpenAI Swarm" as a current competitor | DEC-POSITIONING-008: Swarm is deprecated. The replacement is the OpenAI Agents SDK. | N/A — use Agents SDK or omit. |
| "Agents SDK has no governance" (or similar dismissive framing) | DEC-POSITIONING-010: The Agents SDK has handoffs, guardrails, human-in-the-loop, tracing, and sessions. It lacks mandatory challenge and delivery-phase gates, but it is not featureless. | Narrow the comparison to specific governance gaps, not blanket dismissal. |
| "Dashboard is feature-complete" in public copy | Dashboard is v2.0 scope with explicit deferrals (dispatch-bundle inspection, editor deep links, dashboard-triggered approvals). | Ship deferred features or reword to "v2.0 observation surface." |
## 4. Evidence Gaps

These are the most valuable evidence items that do not yet exist. Ordered by launch value.

| Gap | Impact | Prerequisite |
|-----|--------|--------------|
| ~~Live MCP adapter dogfood~~ | **CLOSED** — E2b proves both MCP transports live through `agentxchain step` CLI | Completed 2026-04-07 |
| ~~MCP with real AI model~~ | **CLOSED** — E2b+ proves MCP stdio transport with real Anthropic model (`claude-haiku-4-5-20251001`) | Completed 2026-04-08 |
| ~~Post-release `npx agentxchain` installation verification~~ | **CLOSED** — `release-postflight.sh` now proves the public `npx` path against the live registry for `2.24.1`, including the cwd-isolation and noisy-npm-notice edge cases that initially broke the verifier. | Completed 2026-04-08 |
| ~~Scenario D escalation dogfood~~ | **CLOSED** — E2d proves retry exhaustion → escalation → operator recovery → eng_director intervention (`run_ebf10c05d7419a0c`) | Completed 2026-04-08 |
| External operator evidence | Moves from "self-proven" to "community-validated" | Post-launch adoption |

---

## Audit

- **Test count verified**: 2026-04-03 exact suite count remains 1033 tests / 0 failures across 235 suites, which preserves the `1000+` launch-copy floor; 2026-04-07 targeted truth slices add 282 tests / 0 failures across 55 suites for review-artifact truth, dispatch-bundle truth, docs truth, and missing-status normalization
- **Launch surfaces checked**: SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, website-v2/src/pages/index.tsx, website-v2/src/pages/why.mdx — no disallowed claims found; 2026-04-07 completion-proof refresh removed the stale "final completion unproven" constraint
- **Evidence sources read**: LIVE_SCENARIO_A_REPORT.md, LIVE_API_PROXY_PREFLIGHT_REPORT.md, MCP_LIVE_DOGFOOD_REPORT.md, test suite output
- **2026-04-07 MCP dogfood**: Live MCP proof added for both stdio (`turn_e41e35ba8eea9768`) and streamable_http (`turn_5292f4de9e01ea71`) transports. Allowed claims updated to include all four adapters. Evidence gap E2b closed.
- **2026-04-08 Scenario D**: Escalation & recovery proof (`run_ebf10c05d7419a0c`) exercises retry exhaustion → blocked escalation → operator recovery → eng_director intervention. Evidence gap closed.
- **2026-04-08 Release truth**: `agentxchain@2.24.1` is live on npm, `npx` postflight proof now passes against the public registry, GitHub Release `v2.24.1` exists, and the canonical Homebrew tap formula matches the published tarball URL + SHA256. The last pre-launch actionable evidence gap is closed.
