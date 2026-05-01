# Roadmap — agentXchain.dev Self-Governance Cycle

## Run Scope

**Objective:** Complete a clean planning→implementation→QA self-governance cycle on agentxchain.dev, validating protocol gate progression and artifact contracts.

**Constraint:** HUMAN-ROADMAP mandates DOGFOOD-100 as the sole priority. This self-governance run is dogfood-adjacent substrate validation — no feature additions.

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| Planning | Scope the run, complete spec, resolve open questions, sign off. | In progress |
| Implementation | Dev validates planning artifacts are actionable; produces IMPLEMENTATION_NOTES.md confirming protocol behavior matches spec. | Pending |
| QA | Challenge correctness of planning artifacts and implementation notes against VISION.md and shipped behavior (v2.155.72). Produce acceptance-matrix, ship-verdict, release notes. | Pending |

## Build Order (Implementation Phase)

When the dev role enters implementation, the recommended sequence is:

1. **Verify protocol state machine** — confirm `.agentxchain/state.json` schema and phase transitions match SYSTEM_SPEC
2. **Verify turn validation** — confirm turn-result.json schema enforcement matches artifact contract
3. **Verify gate evaluation** — confirm gate file checks match gate configuration in `agentxchain.json`
4. **Verify decision ledger / history** — confirm append-only JSONL integrity
5. **Verify ghost recovery** — confirm `auto_retry_ghost` behavior matches spec (reissue + attempt counter + escalation)
6. **Produce IMPLEMENTATION_NOTES.md** — document verification findings and any divergences

This sequence follows dependency order: state machine underpins turn validation, which underpins gate evaluation, which underpins the rest.

## Deliverables

| Artifact | Owner | Phase |
|----------|-------|-------|
| `.planning/SYSTEM_SPEC.md` | PM | Planning |
| `.planning/ROADMAP.md` | PM | Planning |
| `.planning/PM_SIGNOFF.md` | PM | Planning |
| `.planning/IMPLEMENTATION_NOTES.md` | Dev | Implementation |
| `.planning/acceptance-matrix.md` | QA | QA |
| `.planning/ship-verdict.md` | QA | QA |
| `.planning/RELEASE_NOTES.md` | QA | QA |

## Dependencies & Blockers

- **DOGFOOD-100 credential blocker** (operator-side): Anthropic 401 on tusq.dev. Does NOT block this self-governance run on agentxchain.dev.
- **BUG-78** (natural no-edit review proof): Awaiting organic occurrence. Does NOT block this run.
- This run has **no external blockers**. All gate files can be produced by the assigned roles.
