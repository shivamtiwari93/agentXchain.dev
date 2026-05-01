# PM Signoff — M1: Ghost Turn Elimination

Approved: YES

**Run:** `run_984f0f8c07a30a5c`
**Phase:** planning
**Turn:** `turn_60a246b6d712406a`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed multi-agent delivery via local_cli runtimes (Claude Code, GPT CLI). The immediate target: the agentxchain.dev project itself, where ghost turns have disrupted self-governance runs.

### Core Pain Point

Ghost turns silently consume budget and retry slots without producing any work. The root cause was undiagnosed — prior PM work (DEC-003, run `run_8485b8044fbc7e77`) incorrectly hypothesized prompt size or provider timeouts. The actual cause is a CLI flag misconfiguration that causes immediate subprocess rejection, invisible to the orchestrator because the error goes to stderr only.

### Core Workflow

1. PM diagnoses ghost turn root cause and documents findings in SYSTEM_SPEC (this turn — done)
2. Dev implements hardening: startup heartbeat, configurable turn timeout, regression tests for ghost detection/retry/escalation
3. QA validates regression coverage and confirms zero ghost turns in acceptance run

### MVP Scope (this run)

- **PM (this turn):** Diagnose root cause of ghost turns, document findings in SYSTEM_SPEC, check off ROADMAP item, scope dev work
- **Dev:** Implement remaining M1 items — startup heartbeat protocol, configurable turn timeout, regression test suite for ghost scenarios
- **QA:** Validate regression tests pass, verify the fix prevents ghost turns, acceptance matrix against M1 criteria

### Out of Scope

- M2–M8 roadmap items
- DOGFOOD-100 (paused at 97/100 on credential blocker)
- tusq.dev work (separate repo)
- Dashboard, connector, or website work
- Refactoring orchestrator ghost detection logic (it is already correct)

### Success Metric

All M1 checklist items addressed: root cause diagnosed (done), heartbeat protocol implemented, configurable timeout added, regression tests passing, zero ghost turns in subsequent governed runs.

## Challenge to Previous Work

### OBJ-PM-001: Prior ghost turn diagnosis was wrong

The previous PM turn (DEC-003, `run_8485b8044fbc7e77`) stated: *"4 consecutive PM ghost turns indicate the PM runtime may be hitting provider-side timeouts. Reducing PM workload to artifact refresh rather than generation from scratch keeps the turn within the 20-minute deadline budget."*

This was incorrect on all three hypothesized causes:
- **(a) PM prompt too large** — False. The 2-second ghost turns never reached prompt evaluation. The CLI rejected the command at flag validation.
- **(b) Provider-side timeouts** — False. No network request was made. The process exited before any API call.
- **(c) Planning workload incompatible with timeout** — False. The workload was irrelevant; the subprocess never started.

**Actual root cause:** Missing `--verbose` flag in `agentxchain.json` runtime command arrays. Claude Code CLI requires `--verbose` when `--print --output-format stream-json` is used. Without it: immediate exit (code 1), error to stderr, no stdout → no startup proof → ghost classification.

The mitigation (reducing PM workload) happened to "fix" the problem only because the underlying config was separately fixed in commit `6cf44000d` before the successful run. The workload reduction was coincidental, not causal.

### OBJ-PM-002: Stale run references

All planning artifacts previously referenced `run_8485b8044fbc7e77`. Updated to `run_984f0f8c07a30a5c`.

### OBJ-PM-003: Dev scope was too narrow

The prior run scoped dev to "verification-only" with no code changes allowed. Dev correctly challenged this (DEC-002, dev turn) and produced actual source code changes (turn-result-validator hardening). For this run, dev is explicitly scoped to write implementation code: heartbeat protocol, configurable timeout, and regression tests. This is not a validation run.

## Notes for Dev

Your charter for this run is **implementation, not verification**:

1. **Startup heartbeat protocol** — Modify the local_cli adapter to emit periodic keepalive events during tool-use silence. This gives the watchdog positive evidence that the agent process is alive even when no stdout is flowing.
   - Key files: `cli/src/lib/local-cli-adapter.js` (dispatch/output tracking), `cli/src/lib/dispatch-progress.js` (output classification)

2. **Configurable turn timeout** — Add a `turn_timeout_ms` config option (distinct from the startup watchdog's `startup_proof_deadline_ms`). The startup watchdog catches fast failures; the turn timeout catches hung processes that passed startup but stopped producing.
   - Key files: `cli/src/lib/stale-turn-watchdog.js` (ghost detection), `agentxchain.json` (config schema)

3. **Regression tests** — Cover the ghost turn failure modes:
   - (a) CLI flag rejection (stderr-only, fast exit) → ghost classification
   - (b) Startup proof timeout (no stdout within deadline) → ghost classification
   - (c) Auto-retry with attempt counter increment
   - (d) Max-retry exhaustion → human escalation
   - (e) Heartbeat keeps process alive during tool-use silence
   - Key files: `cli/test/` directory, follow existing test patterns

4. **Do NOT modify** reserved state files (`.agentxchain/state.json`, `history.jsonl`, `decision-ledger.jsonl`, `lock.json`).

## Notes for QA

- Verify all regression tests pass and cover the 5 scenarios listed above
- Cross-reference dev's implementation against the root cause analysis in SYSTEM_SPEC.md
- Confirm the heartbeat protocol doesn't generate false-positive startup proof for genuinely dead processes
- Acceptance: M1 regression suite green, no ghost turns during this run's execution
