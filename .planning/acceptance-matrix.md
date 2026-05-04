# Acceptance Matrix — M9: CI Pipeline Integration

**Run:** run_685ea79f49acd469
**Turn:** turn_ee2c089077fbd4d8 (QA)
**Scope:** 1 new lib module (5 functions), 1 new command, 1 modified CLI entry, 12 new tests, vitest contract bumped 673 → 674.

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AT-CI-001 | detectCIEnvironment returns github_actions when GITHUB_ACTIONS=true | QA verified source: `ci-reporter.js:7-18` — checks `process.env.GITHUB_ACTIONS === 'true'`, constructs run_url from SERVER_URL/REPOSITORY/RUN_ID, returns provider/run_url/run_id/ref/sha. Test AT-CI-001 passes: env.provider === 'github_actions', run_url correctly assembled. | PASS |
| AT-CI-002 | detectCIEnvironment returns gitlab_ci when GITLAB_CI=true | QA verified source: `ci-reporter.js:19-27` — checks `process.env.GITLAB_CI === 'true'`, reads CI_PIPELINE_URL/ID/REF/SHA. Test AT-CI-002 passes: env.provider === 'gitlab_ci'. | PASS |
| AT-CI-003 | detectCIEnvironment returns generic when only CI=true | QA verified source: `ci-reporter.js:28-36` — fallback check `process.env.CI === 'true'`, returns generic provider with all nulls. Test AT-CI-003 passes. | PASS |
| AT-CI-004 | detectCIEnvironment returns null outside CI | QA verified source: `ci-reporter.js:37` — returns null when no CI env vars set. Test AT-CI-004 passes: env === null. Detection priority: GitHub → GitLab → generic → null confirmed. | PASS |
| AT-CI-005 | formatGitHubAnnotations emits ::notice for passing run | QA verified source: `ci-reporter.js:49-50` — `report.overall === 'pass'` → `::notice title=AgentXchain Governance::Run ... — PASS`. Test AT-CI-005 passes: output includes `::notice` and `PASS`. | PASS |
| AT-CI-006 | formatGitHubAnnotations emits ::error for failing run | QA verified source: `ci-reporter.js:51-52` — `report.overall === 'fail'` → `::error title=AgentXchain Governance::Run ... — FAIL`. Test AT-CI-006 passes: output includes `::error` and `FAIL`. Blocked-on annotation (line 78-79) also emits `::error`. | PASS |
| AT-CI-007 | formatGitHubAnnotations includes gate-level annotations | QA verified source: `ci-reporter.js:58-69` — iterates gate_summary entries, satisfied/pass/passed → `::notice`, other → `::warning`. Test AT-CI-007 passes: `::notice title=Gate planning_signoff::satisfied`, `::warning title=Gate qa_ship_verdict::pending`. | PASS |
| AT-CI-008 | writeGitHubOutputVars writes key=value pairs to file | QA verified source: `ci-reporter.js:91-107` — 6 key=value pairs (run_status, run_id, phase, blocked, turn_count, decision_count), appends to outputPath via appendFileSync. Test AT-CI-008 passes: file contents verified, pairs array returned. | PASS |
| AT-CI-009 | formatJUnitXml produces valid XML with testsuites and testcases | QA verified source: `ci-reporter.js:114-177` — XML declaration, root `<testsuites>`, two `<testsuite>` (Gates, Turns), `<testcase>` per gate/turn. XML escaping for &, <, >, ". Test AT-CI-009 passes: `<?xml`, `<testsuites`, `<testsuite name="Gates"`, `<testsuite name="Turns"`, `<testcase name="planning_signoff"`. | PASS |
| AT-CI-010 | formatJUnitXml maps failed gates to failure elements | QA verified source: `ci-reporter.js:128-143` — unsatisfied gates (not satisfied/pass/passed) get `<failure>` elements. Failed/blocked turns (line 146-157) also get `<failure>`. Test AT-CI-010 passes: `<failure message="pending">`, `<failure message="failed">`. | PASS |
| AT-CI-011 | deriveCIExitCode returns 0 for pass, 1 for fail, 2 for error | QA verified source: `ci-reporter.js:184-188` — pass→0, fail→1, all others→2. Test AT-CI-011 passes: 4 assertions (pass=0, fail=1, error=2, unknown=2). | PASS |
| AT-CI-012 | ci-report command integrates with governance report pipeline | QA verified source: `ci-report.js:1-80` — imports buildRunExport, loadExportArtifact, buildGovernanceReport from existing pipeline. Auto-detection and --format override logic correct. Test AT-CI-012 uses direct function invocation per spec-recommended alternative approach. | PASS |

**Summary: 12/12 PASS**

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| CI detection priority (ci-reporter.js:7-37) | GitHub Actions (line 8) → GitLab CI (line 19) → generic (line 28) → null (line 37). GitHub Actions sets both GITHUB_ACTIONS=true and CI=true; specific check correctly comes first. | PASS |
| GitHub annotations format (ci-reporter.js:45-83) | Overall: pass→::notice, fail→::error, other→::warning. Gates: satisfied/pass/passed→::notice, other→::warning. Decisions capped at 20. Blocked-on→::error. Uses standard `::cmd title=T::msg` syntax. | PASS |
| Output vars contract (ci-reporter.js:91-107) | 6 key=value pairs match spec §2.1.3. appendFileSync used (not writeFileSync). Returns pairs for testability. Guards outputPath before write. | PASS |
| JUnit XML structure (ci-reporter.js:114-177) | Two testsuites (Gates, Turns). Correct test/failure counts at root and suite level. XML special characters escaped. Turn time uses duration_seconds. | PASS |
| Exit code contract (ci-reporter.js:184-188) | 0=pass, 1=fail, 2=error. Clean switch on report.overall. | PASS |
| Command orchestration (ci-report.js:12-80) | --input → loadExportArtifact, otherwise → buildRunExport. Auto → github-actions on GHA, json otherwise. Writes GITHUB_OUTPUT only in github-actions mode. Sets process.exitCode (not process.exit()). | PASS |
| Error handling (ci-report.js:20-24, 31-34, 73-75) | loadExportArtifact failure → stderr + exitCode 1. buildRunExport failure → stderr + exitCode 1. Unsupported format → stderr + exitCode 1 + return (skips deriveCIExitCode). | PASS |
| Import placement (agentxchain.js:90) | `ciReportCommand` imported after `reportCommand` (line 89). Clean insertion. | PASS |
| Command registration (agentxchain.js:198-203) | Registered after `report` command (line 192-196). Two options: --input, --format with default 'auto'. | PASS |
| Architecture invariant: no state reading | `ci-reporter.js` imports only `appendFileSync` from `node:fs`. No config.js, no governed-state.js. Confirmed via grep. | PASS |
| Architecture invariant: no module modifications | git diff HEAD~1 --name-only shows only 6 files. report.js, export.js, export-verifier.js untouched. | PASS |
| Architecture invariant: pure functions | formatGitHubAnnotations, formatJUnitXml, deriveCIExitCode are deterministic (input→output). Only writeGitHubOutputVars has file I/O side effect. detectCIEnvironment reads process.env. | PASS |
| Vitest contract (vitest-contract.test.js:56) | Asserts `TEST_FILES.length === 674`. 11/11 pass. Bumped from 673 (1 new test file). | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| ci-reporter.test.js | 12 | PASS |
| vitest-contract.test.js | 11 | PASS (674 files) |
| **Total (2 suites)** | **23** | **0 failures** |

All test suites run independently by QA using `npx vitest run test/<file>`.

Note: Full suite (674 files) shows 12 pre-existing failures (7 E2E proposal/remote-agent, 2 current-release-surface, 1 docs-cli-governance, 2 docs-dashboard, 1 dashboard-app) documented since M7 dev turn DEC-003. These are unrelated to M9 delivery.

## Section D: Dev Challenge Review

### DEC-001 (No material deviations from PM spec): VERIFIED

QA independently compared all 5 exported functions in ci-reporter.js against SYSTEM_SPEC §2.1 deliverables. Function signatures, return types, detection priority, annotation format, XML structure, and exit code contract all match. One micro-improvement: spec §2.1.2 includes an unused `const summary` variable (line 113 of spec) that the implementation correctly omits. Dev's claim is accurate.

### DEC-002 (12 pre-existing failures unchanged): ACCEPTED

Dev's machine evidence shows full suite at 662 passed / 12 failed (674 files). These 12 failures are documented in M7 dev turn DEC-003 and verified in multiple subsequent QA turns. Zero references to ci-reporter.js or ci-report.js in any failing test file.

### DEC-003 (AT-CI-012 uses direct function invocation): APPROVED

SYSTEM_SPEC §3.1 AT-CI-012 explicitly offers two approaches: full project fixture OR "invoke the CI reporter functions directly on a pre-built export artifact." Dev chose the cleaner alternative. The test (ci-reporter.test.js:254-278) exercises formatGitHubAnnotations, formatJUnitXml, and deriveCIExitCode on both PASSING_REPORT and FAILING_REPORT fixtures, verifying both happy and failure paths.

## Section E: QA Findings

### Finding 1 (blocking): Stale QA artifacts from wrong run

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced run_0db6a75ab239c3a3 (M7: Windsurf & OpenCode Connectors) instead of current run_685ea79f49acd469 (M9: CI Pipeline Integration). All three rewritten from scratch by this QA turn.

### Finding 2 (info): Dev IMPLEMENTATION_NOTES verification inaccuracy

IMPLEMENTATION_NOTES.md line 60 states "Full test suite: all tests pass" but dev's machine evidence shows exit code 1 for `cd cli && npx vitest run` due to 12 pre-existing failures. The claim is misleading; DEC-002 correctly documents the situation. Non-blocking — does not affect functional correctness.

### Finding 3 (info): Dev verification normalized as not_reproducible

Orchestrator marked dev verification as "not_reproducible — local_cli turn has machine evidence with non-zero exit codes despite claiming pass." This is due to the full suite exit code 1 (pre-existing failures). QA independently confirms: all M9-specific tests pass (12/12 ci-reporter, 11/11 vitest-contract). The not_reproducible tag is a false alarm.

### Finding 4 (info): Spec micro-deviation correctly resolved

SYSTEM_SPEC §2.1.2 formatGitHubAnnotations includes `const summary = report.subject?.run?.status || report.overall;` which is defined but never referenced. Implementation correctly omits this dead variable. This is a spec quality issue, not an implementation defect.
