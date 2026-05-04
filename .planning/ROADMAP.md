# Roadmap — agentXchain.dev

## Current Version

`agentxchain@2.155.72` — 72 CLI commands, protocol v7, 3 runtime types (local_cli, api_proxy, manual), generic + sdlc templates, workflow kit, plugin system, intake system, dashboard, multi-repo coordination, continuous vision-driven mode.

## Milestone Queue

Milestones are derived from `.planning/VISION.md` and ordered by impact on the core product thesis: **governed long-horizon AI software delivery.**

---

### M1: Self-Governance Hardening — Ghost Turn Elimination
- [x] Diagnose root cause of ghost turns when dispatching to local_cli runtimes with stream-json output
  - **Root cause:** Missing `--verbose` flag in runtime command config. Claude Code CLI rejects `--print --output-format stream-json` without `--verbose`, exiting immediately (code 1) with error to stderr only. Orchestrator correctly ignores stderr as startup proof (DEC-BUG54), so `first_output_at` is never set → watchdog classifies as ghost.
  - **Evidence:** 3 ghost turns across runs `run_5fb440e67c8d1cae` and `run_2768a5d6ca1ca89a` (2 at ~2s = immediate CLI rejection, 1 at ~180s = startup watchdog timeout). Fix applied in commit `6cf44000d`. Subsequent run `run_8485b8044fbc7e77` completed all 3 phases with zero ghosts.
  - **Secondary finding:** The orchestrator's ghost detection, output tracking, and recovery logic are all sound. The failure was purely a configuration issue in `agentxchain.json` runtime command arrays.
- [x] Add startup heartbeat protocol: adapter emits periodic keepalive during tool-use silence
  - **Implemented:** `cli/src/lib/adapters/local-cli-adapter.js` `armStartupHeartbeat()` emits periodic `startup_heartbeat` diagnostics via `setInterval` during pre-output silence. Heartbeats update `dispatch-progress.js` `last_activity_at` but do NOT set `first_output_at` (not startup proof). Configurable via `startup_heartbeat_ms` at runtime/global/default (30s) levels. Commit `7c8dc9908`.
- [x] Add configurable turn timeout (distinct from startup watchdog) for long-running turns
  - **Implemented:** `timeouts.per_turn_minutes` is the existing configurable turn-level timeout, distinct from `startup_watchdog_ms`. Dev threaded explicit dispatch timeout inputs into the adapter so run-loop deadlines are reflected at the adapter boundary. No second conflicting timeout mechanism was needed.
- [x] Regression tests for ghost detection, auto-retry, and escalation paths
  - (a) missing `--verbose` flag regression: `local-cli-adapter.test.js:202` — pre-spawn guard blocks incompatible Claude flag combinations
  - (b) stderr-only output → ghost classification: `local-cli-adapter.test.js:905` — stderr produces no startup proof
  - (c) fast-exit subprocess → immediate ghost detection: `bug-51-fast-startup-watchdog.test.js` (multiple scenarios)
  - (d) auto-retry with attempt counter: `continuous-run.test.js:1025` (`auto-reissues a paused ghost-blocked run`), `ghost-retry.test.js`
  - (e) max-retry escalation to human: `continuous-run.test.js`, `notifications-lifecycle.test.js:260` (escalation events)
  - (f) heartbeat during tool-use silence: `local-cli-adapter.test.js:931` — heartbeat fires without marking startup proof
- [ ] Acceptance: zero ghost turns across 10 consecutive self-governed runs <!-- tracking: 3/10 zero-ghost runs (8485b804, 984f0f8c, 936b36c7) as of 2026-05-02 -->

### M2: Vision Derivation — Continuous Roadmap Replenishment
- [x] Fix idle-expansion heuristic to distinguish "current roadmap exhausted" from "vision fully addressed"
- [x] When ROADMAP.md milestones are all checked and VISION.md has uncovered scope, dispatch PM to derive next increment
- [x] Emit clear status: "Roadmap exhausted, vision still open, deriving next increment"
- [x] Regression tests for the three-state model: run complete, roadmap exhausted, vision exhausted
- [ ] Acceptance: continuous mode runs 5+ consecutive runs without idle-stopping when VISION.md has scope <!-- tracking: 1/5 consecutive runs as of 2026-05-02 -->

### M3: Multi-Model Turn Handoff Quality
- [x] Ensure Claude-to-GPT and GPT-to-Claude handoffs preserve full context via CONTEXT.md
- [x] Validate that stream-json and --json output formats are correctly parsed by the adapter
- [x] Add model identity metadata to turn checkpoints (which model produced this turn)
- [x] Test cross-model challenge quality: does QA (Opus 4.6) effectively challenge Dev (GPT 5.5)?
- [x] Acceptance: all 4 roles produce valid turn results across 3 consecutive PM→Dev→QA→completion cycles

### MV: Test Infrastructure — Vitest Migration
- [x] Write codemod script to migrate 663 `node:test` imports → `vitest` (with `before`→`beforeAll`, `after`→`afterAll` renames)
- [x] Execute codemod: all 663 test files in `cli/test/` use native vitest imports
- [x] Update vitest config: glob pattern `test/**/*.test.js`, remove shim alias, 60s timeout
- [x] Update package.json scripts: consolidate to single `test` + new `test:watch`
- [x] Delete `vitest-node-test-shim.js` and `vitest-slice-manifest.js`
- [x] Acceptance: `npm run test` passes all 664 files under vitest, `test:watch` provides TDD workflow, zero `node:test` imports remain

### BUG-FIX: Session Status Inconsistency After Ghost Auto-Retry
- [x] Fix `clearGhostBlockerAfterReissue()` to write session checkpoint after clearing blocked state (Bug A: session.json stale) <!-- run_aeb78d7979d66c0a -->
- [x] Add `isGovernedRunStillActiveForSession()` helper + main loop recovery guard (Bug B: premature session terminal) <!-- run_aeb78d7979d66c0a -->
- [x] 3 regression tests: checkpoint consistency, loop recovery, loop no-recovery <!-- run_aeb78d7979d66c0a -->
- [x] Acceptance: session.json consistent with state.json after auto-retry; continuous loop does not exit when governed run is active

### M4: Recovery & Resilience Hardening
- [x] Audit all recovery paths: ghost recovery, budget exhaustion, credential failure, process crash <!-- run_24a851cc6e95d841: SYSTEM_SPEC.md documents 17 gaps across 4 domains (ghost, budget, credential, crash) -->
- [x] Add structured recovery classification to governance reports <!-- run_5276bd12be02449a: recovery-classification module, emit-time payload enrichment, and report rendering across text/markdown/html -->
- [x] Improve checkpoint-restore: verify a killed mid-turn process can cleanly resume <!-- run_da40a332eed44f56: step --resume PID liveness guard + stale dispatch-progress cleanup + step-crash-resume regression coverage -->
- [ ] Add turn-level cost tracking for local_cli runtimes (parse stream-json cost events)
- [ ] Acceptance: simulated crash during dev turn recovers cleanly via `step --resume`

### BUG-FIX: Step Command Missing Auto-Checkpoint After Acceptance
- [x] Wire `checkpointAcceptedTurn()` into `step.js` after successful acceptance (matches `run.js` afterAccept behavior) <!-- run_8aceec319cd6aaed: step.js:80 import + step.js:1007-1020 auto-checkpoint block -->
- [x] Add `--no-checkpoint` opt-out flag to `step` command <!-- run_8aceec319cd6aaed: agentxchain.js:752 -->
- [x] Integration test: PM turn accepted → auto-checkpointed → dev turn assigned without dirty-workspace error <!-- run_8aceec319cd6aaed: step-auto-checkpoint.test.js (AT-STEP-CKPT-001 + AT-STEP-CKPT-002) -->
- [ ] Acceptance: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit

### M5: Protocol V8 — Parallel Turn Support
- [x] Implement parallel turn dispatch within a single phase (multiple devs working concurrently) <!-- run-loop.js:251 executeParallelTurns() + governed-state.js:3540-3555 max_concurrent_turns enforcement + normalized-config.js:1494 getMaxConcurrentTurns() -->
- [x] Add conflict detection when parallel turns modify overlapping files <!-- governed-state.js:4984-5025 acceptance-time file overlap detection, turns to conflicted status with conflict_state -->
- [x] Add merge strategy for parallel turn results <!-- governed-state.js:6467-6482 reject_and_reassign (Path A) + governed-state.js:4179-4201 human_merge (Path B); spec: PARALLEL_CONFLICT_RECOVERY_SPEC.md -->
- [x] Update governance reports to show parallel execution timelines <!-- report.js:459-461 concurrent_with + sibling_attributed_files in history; text/markdown/HTML rendering at lines 1435, 1817, 2053, 2432, 2797 -->
- [x] Acceptance: 2 dev turns dispatched in parallel, both accepted, conflicts detected and resolved <!-- e2e-parallel-lifecycle.test.js:166-200; 7 test files, 29 tests, 0 failures as of 2026-05-03 -->

### M6: Dashboard Live Observer
- [x] Real-time dashboard showing active turns, phase progression, and budget consumption <!-- dashboard.js:20 dashboardCommand(); bridge-server.js:261 createBridgeServer(); timeline.js:474-493 active turns + timeline.js:464 phase header + run-history.js:177 total_cost_usd -->
- [x] WebSocket or SSE event stream from the run loop <!-- bridge-server.js:279-310 watches events.jsonl via FileWatcher, pushes { type: 'event', event } to all WS clients with per-client event type subscription filtering -->
- [x] Turn timeline visualization with model attribution <!-- timeline.js:444 render() with active turns (474-493) + history (496-528); governed-state.js:5171 stores runtime_id per history entry; timeline.js:410 renders runtime_id in connector health panel -->
- [x] Gate status indicators with file-level detail <!-- gate.js Gate Review view renders pending phase transitions with file-level evidence; bridge-server.js:366-384 approve-gate POST mutation; /api/gate-actions endpoint via gate-action-reader.js -->
- [x] Acceptance: dashboard reflects live state within 5s of turn events during a governed run <!-- file-watcher.js:13 DEBOUNCE_MS=100; bridge-server.js:279 WebSocket push on invalidation; 28 test files, 478 tests, 0 failures as of 2026-05-03 -->

### M7: Connector Ecosystem Expansion
- [x] Add Cursor IDE connector (local_cli adapter variant) <!-- run_10a2b2d8f0a8399b: isCursorLocalCliRuntime() + command validation + doctor support + 14 tests in cursor-connector.test.js; QA verified in run_f89a47c58f54929c -->
- [x] Add Windsurf connector <!-- run_0db6a75ab239c3a3: isWindsurfLocalCliRuntime() + windsurf_requires_agent_mode validation + KNOWN_CLI_AUTHORITY_FLAGS entry + doctor annotation + 14 tests in windsurf-connector.test.js; QA ship verdict YES (turn_1cd75071e9051de9) -->
- [x] Add OpenCode connector <!-- run_0db6a75ab239c3a3: isOpenCodeLocalCliRuntime() + opencode_requires_non_interactive validation + KNOWN_CLI_AUTHORITY_FLAGS entry + doctor annotation + 14 tests in opencode-connector.test.js; QA ship verdict YES (turn_1cd75071e9051de9) -->
- [x] Validate each connector with a single governed turn end-to-end <!-- run_f89a47c58f54929c: AT-CCV-007 (Claude), AT-CCV-009 (Codex), AT-CCV-010 (Cursor) all pass connector validate with overall:'pass'; QA verified 474 tests, 0 failures -->
- [x] Acceptance: `agentxchain doctor` passes for each new connector type <!-- run_0db6a75ab239c3a3: QA verified 10/10 acceptance criteria, 56 tests across 5 suites, 0 failures; all 5 connectors (Claude, Codex, Cursor, Windsurf, OpenCode) detected by doctor -->

### M8: agentxchain.ai Managed Surface — MVP
- [x] Design control plane API for remote run management <!-- run_8140752664578eb2: OpenAPI 3.1 spec at api/v1/control-plane.openapi.yaml + protocol-bridge.js (15 bridge functions + 5 error classes) + 7 schema tests; QA ship verdict YES -->
- [x] Implement hosted runner that executes protocol against cloud agent APIs <!-- run_0937d8f23ff72791: hosted-runner.js (16 routes, node:http), execution-worker.js, job-queue.js, serve.js command, 11 tests; QA ship verdict YES, 323 regression tests clean -->
- [x] Organization dashboard with multi-project visibility <!-- run_76ce2c791a84e1cb: project-registry.js, org-state-aggregator.js, org-overview.js, org-runs.js, 6 org routes on hosted-runner.js, static file serving, --projects CLI option, 8 integration tests (org-dashboard.test.js), 136 tests across 6 files; QA ship verdict YES -->
- [x] Persistent run history and governance audit trail <!-- run_b2a4084d6b3fe3b3: getRunHistory + getAuditTrail (2 aggregator methods), 2 hosted runner routes (/v1/org/history, /v1/org/audit-trail), 2 dashboard components (org-history.js, org-audit-trail.js), 8 integration tests; QA ship verdict YES (turn_2f903c5a3d12867f), 132 tests across 6 files, 0 failures -->
- [ ] Acceptance: a governed run completes via the hosted runner with dashboard visibility

### M9: CI Pipeline Integration
- [ ] CI reporter module with provider detection (GitHub Actions, GitLab CI, generic) <!-- cli/src/lib/ci-reporter.js: detectCIEnvironment(), formatGitHubAnnotations(), writeGitHubOutputVars(), formatJUnitXml(), deriveCIExitCode() -->
- [ ] `agentxchain ci-report` command with GitHub Actions annotations, output variables, and JUnit XML <!-- cli/src/commands/ci-report.js + cli/bin/agentxchain.js registration -->
- [ ] Exit code derivation from governance report (0=pass, 1=fail, 2=error) <!-- deriveCIExitCode() in ci-reporter.js -->
- [ ] Acceptance: CI reporter formats a governed run report as GitHub Actions annotations and JUnit XML with correct exit codes

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| Planning | Scope M9 CI Pipeline Integration: CI reporter module + ci-report command + GitHub Actions annotations + JUnit XML + output variables + exit codes; charter 1 new test file with 12 tests | In progress (`run_685ea79f49acd469`) |
| Implementation | Dev creates ci-reporter.js (5 functions), ci-report.js (1 command), registers in agentxchain.js, creates ci-reporter.test.js (~12 tests) | Pending |
| QA | Verify 12 ci-reporter tests pass, verify JUnit XML well-formedness, verify GitHub annotations format, run full test suite, check off M9 items | Pending |
