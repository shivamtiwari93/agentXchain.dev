# Launch Evidence Report — AgentXchain v2.17.0

> Single-source evidence artifact for all launch-facing claims. Updated 2026-04-07.

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
- **Run IDs**: `run_399aea020ebb68d4`, `run_99e509c066d2daa9`, `run_cfae0bd99a4f5643`, `run_42b64ccb7b051bf6` (QA-only continuation proof)
- **Result**: live connector proof confirmed; QA output-contract drift closed; full completion still partial
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
- **What it does NOT prove**:
  - Final run completion approval (`approve-completion`)
  - Live MCP adapter proof
  - Full machine-verifiable stdout/stderr proof for the dev test run
  - Independent QA execution of the dev test suite from the `api_proxy` runtime

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
| "The protocol requires human approval for phase transitions and final completion" | E1 (gate-evaluator tests, governed-state tests) + E2 (planning gate approved live) | Phrase this as a protocol guarantee, not as evidence that `approve-completion` has been exercised live. |
| "Append-only audit trail" / "structured history" | E1 (history.jsonl tests) + E2 (live history entries captured) | |
| "Model-agnostic / runtime-swappable" | E1 (adapter coverage) + E2 (manual + local_cli + api_proxy completed live in one governed run) | Still do NOT claim "all adapters proven live" because MCP is not covered by this dogfood and the run did not reach final completion. |
| "Manual, local CLI, and API-backed agents all run under the same protocol" | E1 (adapter tests) + E2 (all three executed live in one governed run) | This claim is now supported by both test coverage and live execution evidence. |
| "`api_proxy` review turns produce real review artifacts and fail closed on phantom review-file claims" | E1 (new governed-state/repo-observer tests) + E2 (live QA-only continuation wrote `.agentxchain/reviews/turn_fd7f82248d8562b3-qa-review.md`) | Phrase narrowly. This is review-artifact truth, not a claim that `api_proxy` writes QA gate files. |
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
| "Full live end-to-end proof" or "all adapters proven live" | E2 now proves manual + `local_cli` + `api_proxy` live in one governed run, but MCP is still not part of that proof and the run did not reach final completion. | Complete a governed run through `approve-completion` and separately add live MCP proof if that claim is desired. |
| "Production-proven" or "battle-tested" | No production deployment evidence exists. All evidence is from development/dogfood environments. | Post-release operator evidence from real projects. |
| "OpenAI Swarm" as a current competitor | DEC-POSITIONING-008: Swarm is deprecated. The replacement is the OpenAI Agents SDK. | N/A — use Agents SDK or omit. |
| "Agents SDK has no governance" (or similar dismissive framing) | DEC-POSITIONING-010: The Agents SDK has handoffs, guardrails, human-in-the-loop, tracing, and sessions. It lacks mandatory challenge and delivery-phase gates, but it is not featureless. | Narrow the comparison to specific governance gaps, not blanket dismissal. |
| "Dashboard is feature-complete" in public copy | Dashboard is v2.0 scope with explicit deferrals (dispatch-bundle inspection, editor deep links, dashboard-triggered approvals). | Ship deferred features or reword to "v2.0 observation surface." |
| "Full live run completion" | E2: Run ended in `paused` at QA phase, not `completed`. `approve-completion` was never exercised live. | Complete a run through `approve-completion`. |

## 4. Evidence Gaps

These are the most valuable evidence items that do not yet exist. Ordered by launch value.

| Gap | Impact | Prerequisite |
|-----|--------|--------------|
| Full governed run through `approve-completion` | Unlocks "full lifecycle proven" claim | Complete a run to ship decision |
| Live MCP adapter dogfood | Unlocks a truthful "all four adapters proven live" claim | Run a governed turn through the MCP adapter against a real server |
| Post-release `npx agentxchain` installation verification | Proves the npm package works from the registry | v2.0.1 published to npm |
| Scenario D escalation dogfood | Validates retry exhaustion + eng_director recovery paths | v2.0.1 published (per spec) |
| External operator evidence | Moves from "self-proven" to "community-validated" | Post-launch adoption |

---

## Audit

- **Test count verified**: 2026-04-03 exact suite count remains 1033 tests / 0 failures across 235 suites, which preserves the `1000+` launch-copy floor; 2026-04-07 targeted truth slice adds 231 tests / 0 failures across 45 suites for review-artifact truth, dispatch-bundle truth, and docs truth
- **Launch surfaces checked**: SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, website-v2/src/pages/index.tsx, website-v2/src/pages/why.mdx — no disallowed claims found
- **Evidence sources read**: LIVE_SCENARIO_A_REPORT.md, LIVE_API_PROXY_PREFLIGHT_REPORT.md, test suite output
