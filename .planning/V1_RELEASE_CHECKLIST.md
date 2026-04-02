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
- [x] `api_proxy` live validation: at least one governed turn against real Anthropic API — closed by agent concurrence (DEC-LIVE-001). Live QA turn `turn_9f5639c671280a8f` dispatched to `claude-sonnet-4-6`, telemetry captured, staged result accepted inside governed loop.
- [x] `api_proxy` error taxonomy: categorize API errors (auth, rate-limit, model-not-found, context-overflow) into recovery descriptors

## 3. Dogfood Validation

- [x] Scenario A: Happy path (PM → Dev → QA → completion) — manual turns
- [x] Scenario B: Reject/retry path — schema failure, retry with context, re-accept
- [x] Scenario C: Live LLM dogfood — at least one turn dispatched to real API. Closed by agent concurrence (DEC-LIVE-001); see `LIVE_SCENARIO_A_REPORT.md`
- [~] Scenario D: Multi-turn escalation — **deferred to post-v1** (DEC-SCENARIO-D-001: escalation state machine is implemented and unit-tested; full dogfood validation is not a v1 release gate)

## 4. Test Coverage

- [x] Fresh audited baseline: 522 tests, 0 failures, 113 suites (2026-04-02)
- [x] E2E governed lifecycle test (3-phase happy path)
- [x] Schema drift guard tests
- [x] Operator recovery rendering tests
- [x] E2E reject/retry lifecycle test (Scenario B as automated test, not just dogfood transcript)
- [x] Negative test: malformed config rejected at startup
- [x] Negative test: concurrent step invocation detected and rejected

## 5. Documentation

- [x] SPEC-GOVERNED-v4.md — frozen v1.0 normative spec (v1.1 is SPEC-GOVERNED-v5.md)
- [x] All planning specs required for the v1 handoff are complete and verified against implementation
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
- [x] npm publish dry-run succeeds — `npm pack --dry-run` passed in `cli/` and produced `agentxchain-0.9.0.tgz`
- [x] Release preflight runs with 0 hard failures — observed result on 2026-04-01: `4 passed, 0 failed, 2 warnings` (`dirty tree`, `package.json` still `0.9.0` before the release bump)
- [x] Release preflight strict-mode contract is frozen for the post-bump gate (`bash scripts/release-preflight.sh --strict` / `npm run preflight:release:strict`)
- [x] Homebrew formula updated with real tap — completed in `shivamtiwari93/homebrew-agentxchain`
- [ ] Clean release workspace prepared before the cut (release-day task)
- [ ] `cd cli && npm version 1.0.0` run successfully, creating the release commit and git tag `v1.0.0` (release-day task)
- [ ] Push tag `v1.0.0` to GitHub — triggers `.github/workflows/publish-npm-on-tag.yml` which calls `scripts/publish-from-tag.sh`. The workflow enforces: tag shape must be `vX.Y.Z`, `package.json.version` must match tag semver, strict preflight must pass, and npm registry visibility is polled after publish. Human only creates tag; workflow handles publish.
- [ ] Verify `agentxchain@1.0.0` is served by npm registry (workflow does this automatically; manual fallback: `npm view agentxchain@1.0.0 version`)
- [ ] Homebrew formula updated to the published `1.0.0` tarball URL and SHA256 (release-day task)

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
4. SPEC-GOVERNED-v4.md (v1.0) / SPEC-GOVERNED-v5.md (v1.1) and CLI_SPEC.md match implementation with 0 drift
5. All P0 setup and decision human blockers resolved
6. CHANGELOG updated with 1.0.0 entry

---

## Post-v1 Work Already In-Tree

The following features are implemented and tested in the current workspace but are **not** part of the v1.0.0 release contract. They will ship as v1.1+.

| Feature | Status | Test Count | Activation |
|---------|--------|------------|------------|
| Parallel agent turns (6 slices) | Complete | 485 tests / 106 suites | `max_concurrent_turns > 1` |
| Auto-retry with backoff (`api_proxy`) | Complete | Included above | `retry_policy.enabled = true` |
| Preemptive tokenization | Complete + live-validated | Included above | `preflight_tokenization = true` |
| Provider error mapping (Anthropic) | Complete | Included above | Automatic when using Anthropic |
| Persistent blocked sub-state | Complete | Included above | Automatic |

> v1.0.0 defaults (`max_concurrent_turns = 1`, no retry policy, no preflight tokenization) ensure these features are inert unless explicitly configured. The v1.0.0 release contract remains: single-run, single-repo, sequential turns.

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
| Prepare a clean release workspace and run `cd cli && npm version 1.0.0` | Final release commit + tag |
| Publish the approved `1.0.0` package to npm | Final public release |
| Update the Homebrew formula to the published `1.0.0` tarball URL and SHA256 | Homebrew distribution |
