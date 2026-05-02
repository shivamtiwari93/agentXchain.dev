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
- [ ] Fix idle-expansion heuristic to distinguish "current roadmap exhausted" from "vision fully addressed"
- [ ] When ROADMAP.md milestones are all checked and VISION.md has uncovered scope, dispatch PM to derive next increment
- [ ] Emit clear status: "Roadmap exhausted, vision still open, deriving next increment"
- [ ] Regression tests for the three-state model: run complete, roadmap exhausted, vision exhausted
- [ ] Acceptance: continuous mode runs 5+ consecutive runs without idle-stopping when VISION.md has scope

### M3: Multi-Model Turn Handoff Quality
- [ ] Ensure Claude-to-GPT and GPT-to-Claude handoffs preserve full context via CONTEXT.md
- [ ] Validate that stream-json and --json output formats are correctly parsed by the adapter
- [ ] Add model identity metadata to turn checkpoints (which model produced this turn)
- [ ] Test cross-model challenge quality: does QA (Opus 4.6) effectively challenge Dev (GPT 5.5)?
- [ ] Acceptance: all 4 roles produce valid turn results across 3 consecutive PM→Dev→QA→completion cycles

### M4: Recovery & Resilience Hardening
- [ ] Audit all recovery paths: ghost recovery, budget exhaustion, credential failure, process crash
- [ ] Add structured recovery classification to governance reports
- [ ] Improve checkpoint-restore: verify a killed mid-turn process can cleanly resume
- [ ] Add turn-level cost tracking for local_cli runtimes (parse stream-json cost events)
- [ ] Acceptance: simulated crash during dev turn recovers cleanly via `step --resume`

### M5: Protocol V8 — Parallel Turn Support
- [ ] Implement parallel turn dispatch within a single phase (multiple devs working concurrently)
- [ ] Add conflict detection when parallel turns modify overlapping files
- [ ] Add merge strategy for parallel turn results
- [ ] Update governance reports to show parallel execution timelines
- [ ] Acceptance: 2 dev turns dispatched in parallel, both accepted, conflicts detected and resolved

### M6: Dashboard Live Observer
- [ ] Real-time dashboard showing active turns, phase progression, and budget consumption
- [ ] WebSocket or SSE event stream from the run loop
- [ ] Turn timeline visualization with model attribution
- [ ] Gate status indicators with file-level detail
- [ ] Acceptance: dashboard reflects live state within 5s of turn events during a governed run

### M7: Connector Ecosystem Expansion
- [ ] Add Cursor IDE connector (local_cli adapter variant)
- [ ] Add Windsurf connector
- [ ] Add OpenCode connector
- [ ] Validate each connector with a single governed turn end-to-end
- [ ] Acceptance: `agentxchain doctor` passes for each new connector type

### M8: agentxchain.ai Managed Surface — MVP
- [ ] Design control plane API for remote run management
- [ ] Implement hosted runner that executes protocol against cloud agent APIs
- [ ] Organization dashboard with multi-project visibility
- [ ] Persistent run history and governance audit trail
- [ ] Acceptance: a governed run completes via the hosted runner with dashboard visibility

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| Planning | Protect user value, scope clarity, and acceptance criteria. | In progress (`run_cc4217fafd6611bc`) |
| Implementation | Implement `<!-- tracking: -->` annotation in vision scanner | Pending |
| QA | Challenge correctness, acceptance coverage, and ship readiness. | Pending |
