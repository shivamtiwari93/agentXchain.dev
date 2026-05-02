# Acceptance Matrix — agentXchain.dev

**Run:** run_3a396386e18575b6
**Turn:** turn_080c074e61bbd5eb (QA)
**Scope:** Config protection (agentxchain.json operator-owned guardrails) + M3 Codex output format validation

## Config Protection Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| CP-001 | pm.md contains "Do NOT modify agentxchain.json" instruction | Line 76: `Do NOT modify agentxchain.json — this is operator-owned configuration.` | PASS |
| CP-002 | dev.md contains "Do NOT modify agentxchain.json" instruction | Line 47: `Do NOT modify agentxchain.json — this is operator-owned configuration.` | PASS |
| CP-003 | qa.md contains "Do NOT modify agentxchain.json" instruction | Line 54: `Do NOT modify agentxchain.json — this is operator-owned configuration.` | PASS |
| CP-004 | eng_director.md contains "Do NOT modify agentxchain.json" instruction | Line 59: `Do NOT modify agentxchain.json — this is operator-owned configuration.` | PASS |
| CP-005 | pm.md instruction is in write boundaries or protocol rules section | In `## Operator-Owned Files` section (line 75) — functionally equivalent to write boundaries for the PM role | PASS (see note 1) |
| CP-006 | dev.md instruction is in write boundaries or protocol rules section | In `## Implementation Rules` section (line 42) — the dev's constraint/rules section | PASS (see note 1) |
| CP-007 | qa.md instruction is in write boundaries or protocol rules section | In `## Write Boundaries` section (line 50) — exact match | PASS |
| CP-008 | eng_director.md instruction is in write boundaries or protocol rules section | In `## Write Boundaries` section (line 56) — exact match | PASS |
| CP-009 | agentxchain.json timeouts survive PM+Dev+QA cycle | `timeouts.per_turn_minutes: 120`, `timeouts.action: "escalate"` — verified via JSON parse; `git diff` empty across PM checkpoint (61323db1b), Dev checkpoint (d697508e1), and working tree | PASS |
| CP-010 | agentxchain.json watch routes survive PM+Dev+QA cycle | `watch.routes[0].match.category: "github_workflow_run_failed"`, `watch.routes[1].match.category: "beta_bug_report"` — 2 routes intact; `git diff` empty across all checkpoints | PASS |
| CP-011 | All 4 prompts reference OPERATOR_OWNED_FILES.md in Project Context | Each prompt's Project Context section includes `.planning/OPERATOR_OWNED_FILES.md` as a read-on-every-turn file | PASS |
| CP-012 | OPERATOR_OWNED_FILES.md lists agentxchain.json as protected | Table row: `agentxchain.json | Runtime configuration, timeouts, watch routes, role definitions, budget — operator-controlled` | PASS |

### Note 1: Section naming

The acceptance contract requires the instruction to be in the "write boundaries or protocol rules section." Two of four prompts (qa.md, eng_director.md) use the exact section name "Write Boundaries." The PM prompt uses "Operator-Owned Files" (a dedicated section for file write restrictions), and the Dev prompt uses "Implementation Rules" (the section governing implementation constraints). Both are contextually appropriate sections that govern write constraints — the spirit of the requirement is fully met. The literal section name differs because the PM and Dev roles have different structural conventions from the review-only roles.

## Codex Output Format Validation

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| M3-001 | Codex runtime detection | `isCodexLocalCliRuntime()` in claude-local-auth.js; 8/8 auth smoke probe tests pass | PASS |
| M3-002 | Codex auth failure classification | `hasCodexAuthFailureOutput()` in claude-local-auth.js; tested in local-cli-adapter.test.js | PASS |
| M3-003 | Codex error branch in adapter close handler | Codex auth failures return typed `codex_auth_failed` blocker; 46/46 adapter tests pass | PASS |
| M3-004 | Codex exec flag validation | `validateLocalCliCommandCompatibility()` catches missing `exec` subcommand; tested | PASS |
| M3-005 | No regression in Claude error classification | Claude auth failure, flag compatibility, Node incompatibility tests all pass | PASS |

## Regression Suites

| Suite | Count | Result |
|-------|-------|--------|
| local-cli-adapter.test.js | 46 | PASS |
| claude-local-auth-smoke-probe.test.js | 8 | PASS |
| agentxchain-config-schema.test.js | 7 | PASS |
| governed-state.test.js | 99 | PASS |
| dispatch-bundle.test.js | 74 | PASS |
| turn-result-validator + staged-result-proof | 114 | PASS |
| continuous-run.test.js | 87 | PASS |
| vision-reader.test.js | 36 | PASS |
| timeout-evaluator + run-loop + release-notes-gate | 80 | PASS |
| **Total** | **551** | **0 failures** |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure from prior runs; predates this run | Not a regression — confirmed across 10 consecutive QA runs |
