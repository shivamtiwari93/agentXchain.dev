# V1.0 Release Checklist — AgentXchain Governed CLI

> Gap analysis: what separates v0.9.0 (current) from a credible v1.0.0 release.

---

## Status Key

- [x] Done
- [ ] Not started
- [~] In progress / partial

---

## 1. Protocol Completeness

- [x] State machine: idle → active → paused → completed lifecycle
- [x] Turn assignment, acceptance, rejection, retry
- [x] Phase transitions with human approval gates
- [x] Run completion with human approval gate
- [x] Auto-advance on verification-only gates
- [x] Operator recovery descriptors on all blocked states
- [x] Decision ledger and history persistence
- [x] Orchestrator state file exclusion from actor observation
- [x] Clean-baseline enforcement for authoritative/proposed turns
- [x] `challenge_required` enforcement for review_only roles
- [x] Untracked file observation in diff summaries

## 2. Adapters

- [x] `manual` adapter: poll-based staging
- [x] `local_cli` adapter: subprocess dispatch with argv/stdin/dispatch_bundle_only transport
- [x] `api_proxy` adapter: synchronous Anthropic call, review_only only
- [ ] `api_proxy` live validation: at least one governed turn against real Anthropic API (credential prerequisite resolved; pending full Scenario C governed run)
- [x] `api_proxy` error taxonomy: categorize API errors (auth, rate-limit, model-not-found, context-overflow) into recovery descriptors

## 3. Dogfood Validation

- [x] Scenario A: Happy path (PM → Dev → QA → completion) — manual turns
- [x] Scenario B: Reject/retry path — schema failure, retry with context, re-accept
- [ ] Scenario C: Live LLM dogfood — at least one turn dispatched to real API (blocked on P0 HUMAN_TASK)
- [~] Scenario D: Multi-turn escalation — **deferred to post-v1** (DEC-SCENARIO-D-001: escalation state machine is implemented and unit-tested; full dogfood validation is not a v1 release gate)

## 4. Test Coverage

- [x] 369 tests, 0 failures, 84 suites
- [x] E2E governed lifecycle test (3-phase happy path)
- [x] Schema drift guard tests
- [x] Operator recovery rendering tests
- [x] E2E reject/retry lifecycle test (Scenario B as automated test, not just dogfood transcript)
- [x] Negative test: malformed config rejected at startup
- [x] Negative test: concurrent step invocation detected and rejected

## 5. Documentation

- [x] SPEC-GOVERNED-v4.md — standalone normative spec
- [x] All 13 planning specs complete and verified against implementation
- [x] DOGFOOD-RUNBOOK.md with clean-baseline checkpoints
- [x] CLI_SPEC.md frozen against Commander definitions
- [x] README.md exists
- [x] README.md updated with governed quickstart (init → step → accept → approve flow)
- [x] `--help` text for every governed command verified as user-facing documentation
- [x] CHANGELOG.md updated from 0.9.0 to 1.0.0 with release notes

## 6. Release Infrastructure

- [x] package.json at 0.9.0
- [x] CI workflow exists (.github/workflows/ci.yml)
- [x] CI enabled on GitHub repo
- [x] Branch protection requiring CI pass (`cli` on `main`)
- [x] npm package scope/name decided — continue with existing unscoped package `agentxchain`
- [ ] npm publish dry-run succeeds (release-day task, sequenced after npm scope decision)
- [ ] Homebrew formula updated with real tap (blocked on P2 HUMAN_TASK)
- [ ] Git tag v1.0.0 created on release commit (release-day task)

## 7. Code Quality

- [x] No known regressions
- [x] Audit governed critical-path `catch {}` blocks — dispatch bundle failures now surface as warnings/errors; legacy cleanup and audit-artifact best-effort catches left intentionally silent
- [x] Remove dead code / unused exports flagged during spec extraction — removed unused `getRepoUrl()` and unused `STAGING_RESULT_PATH` export after cross-repo reachability audit
- [x] Verify no hardcoded tmp paths or test-only logic in production code — no `/tmp`, `tmpdir`, `mkdtemp`, or `NODE_ENV === "test"` branches found under `cli/src/`

---

## Release Criteria (all must be true for v1.0.0)

1. Scenarios A, B, and C pass (C requires live API key)
2. 0 test failures on clean `npm ci && npm test`
3. README quickstart works for a new user with no prior context
4. SPEC-GOVERNED-v4.md and CLI_SPEC.md match implementation with 0 drift
5. All P0 human tasks resolved
6. CHANGELOG updated with 1.0.0 entry

---

## Estimated Autonomous Work Remaining (no human blockers)

| Task | Effort | Status |
|------|--------|--------|
| ~~CHANGELOG 1.0.0 draft~~ | ~~0.5 turn~~ | Done (Turn 16) |
| ~~--help text verification~~ | ~~0.5 turn~~ | Done (Turn 15) |
| ~~Negative test: malformed config rejected at startup~~ | ~~0.5 turn~~ | Done (Turn 15) |
| ~~Negative test: concurrent step invocation rejected~~ | ~~0.5 turn~~ | Done (Turn 15) |
| ~~Dead code / unused export audit~~ | ~~0.5 turn~~ | Done (Turn 16) |
| ~~Hardcoded tmp / test-only logic audit~~ | ~~0.5 turn~~ | Done (Turn 16) |

**Total: 0 autonomous turns remaining before human-gated items.**

---

## Human-Gated Items (cannot proceed without human)

| Item | Blocks |
|------|--------|
| Run live Scenario C with configured ANTHROPIC_API_KEY | Scenario C, api_proxy live validation |
| Run npm publish dry-run and release-day packaging checks | Release packaging confidence |
| Apply approved minor doc-drift corrections to SPEC-GOVERNED-v4.md | Final spec polish before tag |
