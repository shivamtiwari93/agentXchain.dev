# Roadmap — agentXchain.dev Self-Governance Cycle

**Run:** `run_8485b8044fbc7e77`
**Date:** 2026-05-01

## Run Scope

**Objective:** Complete a clean planning→implementation→QA self-governance cycle on agentxchain.dev, validating protocol gate progression and artifact contracts.

**Constraint:** HUMAN-ROADMAP mandates DOGFOOD-100 as the sole priority (paused at 97/100 on credential blocker). This self-governance run is dogfood-adjacent substrate validation — no feature additions, no code changes.

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| Planning | Scope the run, complete spec, resolve open questions, sign off | **Complete** — PM_SIGNOFF approved, SYSTEM_SPEC and ROADMAP refreshed for `run_8485b8044fbc7e77` |
| Implementation | Dev verifies planning artifacts are actionable; produces IMPLEMENTATION_NOTES.md confirming protocol behavior matches spec | Pending |
| QA | Challenge correctness of planning artifacts and implementation notes against VISION.md and shipped behavior (v2.155.72). Produce acceptance-matrix, ship-verdict, release notes | Pending |

## Build Order (Implementation Phase)

When the dev role enters implementation, the recommended verification sequence is:

1. **Verify protocol state machine** — confirm `.agentxchain/state.json` schema and phase transitions match SYSTEM_SPEC
2. **Verify turn validation** — confirm turn-result.json schema enforcement matches artifact contract
3. **Verify gate evaluation** — confirm gate file checks match gate configuration in `agentxchain.json`
4. **Verify decision ledger / history** — confirm append-only JSONL integrity
5. **Verify ghost recovery** — confirm `auto_retry_ghost` behavior matches spec (reissue + attempt counter + escalation). Evidence: 4 ghost reissues in `history.jsonl`
6. **Produce IMPLEMENTATION_NOTES.md** — document verification findings and any divergences

This sequence follows dependency order: state machine underpins turn validation, which underpins gate evaluation, which underpins the rest.

**Scope clarification for dev:** This is a validation run. The dev mandate's "write actual source code" clause does not apply — `IMPLEMENTATION_NOTES.md` documenting verification findings is the expected deliverable per the run scope and gate configuration. Do NOT implement new features or refactor existing code.

## Deliverables

| Artifact | Owner | Phase | Status |
|----------|-------|-------|--------|
| `.planning/PM_SIGNOFF.md` | PM | Planning | Done |
| `.planning/SYSTEM_SPEC.md` | PM | Planning | Done |
| `.planning/ROADMAP.md` | PM | Planning | Done |
| `.planning/IMPLEMENTATION_NOTES.md` | Dev | Implementation | Pending |
| `.planning/acceptance-matrix.md` | QA | QA | Pending |
| `.planning/ship-verdict.md` | QA | QA | Pending |
| `.planning/RELEASE_NOTES.md` | QA | QA | Pending |

## Dependencies & Blockers

- **DOGFOOD-100 credential blocker** (operator-side): Anthropic 401 on tusq.dev at counter 97/100. Does NOT block this self-governance run on agentxchain.dev.
- **Ghost turn pattern**: 4 PM ghosts across 2 prior runs. Mitigated in this run by scoping PM work to artifact refresh rather than generation from scratch.
- This run has **no external blockers**. All gate files can be produced by the assigned roles.
