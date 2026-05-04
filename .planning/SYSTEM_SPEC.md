# System Spec — M9: CI Pipeline Integration (Verification)

**Run:** `run_0cd65963809561d6`
**Baseline:** git:a632d99 (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Verify that the CI reporter module and CLI command delivered in run_685ea79f49acd469 are intact, all 12 tests still pass, and no regressions exist. Close the ROADMAP.md gap where items 101-104 were never checked off despite a successful QA ship verdict.

**This is a verification-only spec.** No new code is expected. The full technical spec for the CI reporter remains valid from run_685ea79f49acd469's SYSTEM_SPEC.md (preserved in git history at commit 305ba5640).

---

## 1. Existing Delivery Summary

### 1.1 Files Delivered (run_685ea79f49acd469)

| File | Type | Content |
|------|------|---------|
| `cli/src/lib/ci-reporter.js` | New | 5 exported functions: detectCIEnvironment, formatGitHubAnnotations, writeGitHubOutputVars, formatJUnitXml, deriveCIExitCode |
| `cli/src/commands/ci-report.js` | New | ciReportCommand: export → report → CI format → exit code |
| `cli/bin/agentxchain.js` | Modified | Line 90: import ciReportCommand; Line 199: .command('ci-report') registration |
| `cli/test/ci-reporter.test.js` | New | 12 tests across CI detection, GitHub annotations, output vars, JUnit XML, exit codes, command integration |

### 1.2 Architecture Invariants (unchanged)

1. **No new state reading.** ci-reporter.js consumes the governance report object from buildGovernanceReport() — does not import config.js, governed-state.js, or any state reader.
2. **No modifications to existing modules.** report.js, export.js, export-verifier.js remain untouched.
3. **Pure functions.** formatGitHubAnnotations(), formatJUnitXml(), deriveCIExitCode() are pure. Only writeGitHubOutputVars() has a file-append side effect and detectCIEnvironment() reads env vars.
4. **Standard output formats.** GitHub Actions `::command::` syntax, JUnit 4 XML schema.
5. **Exit code contract.** 0=pass, 1=fail, 2=error.

### 1.3 Exported Interface

```
cli/src/lib/ci-reporter.js
  └─ export detectCIEnvironment()              → { provider, run_url, run_id, ref, sha } | null
  └─ export formatGitHubAnnotations(report)    → string (newline-separated ::cmd:: lines)
  └─ export writeGitHubOutputVars(report, path) → string[] (key=value pairs)
  └─ export formatJUnitXml(report)             → string (XML document)
  └─ export deriveCIExitCode(report)           → number (0, 1, or 2)

cli/src/commands/ci-report.js
  └─ export async ciReportCommand(options)     → void (writes to stdout, sets process.exitCode)
```

### 1.4 CLI Interface

```
agentxchain ci-report [options]

Options:
  --input <path>    Export artifact path, or use current project if omitted
  --format <format> Output format: auto, github-actions, junit-xml, json (default: auto)

Exit codes:
  0  Governance pass (ship-ready)
  1  Governance fail
  2  Error (invalid input, missing project)
```

---

## 2. Dev Charter (Verification Only)

### 2.1 Scope

**Zero new source files. Zero code changes expected.**

Dev's charter is to re-run tests and confirm the existing delivery is intact:

1. Run `cd cli && npx vitest run test/ci-reporter.test.js` — expect 12 tests pass
2. Run `cd cli && npm test` — expect no new regressions beyond the 12 pre-existing failures documented in run_685ea79f49acd469 (DEC-002)
3. If any ci-reporter tests fail: diagnose and fix
4. If new regressions appear: diagnose and fix

### 2.2 Files Changed (Expected)

None. If regressions are found, dev may modify:
- `cli/src/lib/ci-reporter.js` — only if ci-reporter tests fail
- `cli/src/commands/ci-report.js` — only if command integration fails
- `cli/test/ci-reporter.test.js` — only if test expectations need updating

### 2.3 Pre-existing Test Failures (Known)

12 pre-existing test failures documented across runs:
- 7 E2E proposal/remote-agent tests
- 2 current-release-surface tests
- 1 docs-cli-governance test
- 2 docs-dashboard tests
- 1 dashboard-app test

These are unrelated to the CI reporter. Dev should confirm the failure count has not increased.

---

## 3. Acceptance Tests

All 12 acceptance tests were defined and verified in run_685ea79f49acd469. Dev re-verifies they still pass:

| # | Test ID | Description | Expected |
|---|---------|-------------|----------|
| 1 | AT-CI-001 | detectCIEnvironment returns github_actions when GITHUB_ACTIONS=true | PASS |
| 2 | AT-CI-002 | detectCIEnvironment returns gitlab_ci when GITLAB_CI=true | PASS |
| 3 | AT-CI-003 | detectCIEnvironment returns generic when only CI=true | PASS |
| 4 | AT-CI-004 | detectCIEnvironment returns null outside CI | PASS |
| 5 | AT-CI-005 | formatGitHubAnnotations emits ::notice for passing run | PASS |
| 6 | AT-CI-006 | formatGitHubAnnotations emits ::error for failing run | PASS |
| 7 | AT-CI-007 | formatGitHubAnnotations includes gate-level annotations | PASS |
| 8 | AT-CI-008 | writeGitHubOutputVars writes key=value pairs to file | PASS |
| 9 | AT-CI-009 | formatJUnitXml produces valid XML with testsuites and testcases | PASS |
| 10 | AT-CI-010 | formatJUnitXml maps failed gates to failure elements | PASS |
| 11 | AT-CI-011 | deriveCIExitCode returns 0 for pass, 1 for fail, 2 for error | PASS |
| 12 | AT-CI-012 | ci-report command integrates with governance report pipeline | PASS |

---

## 4. Verification Commands

```bash
# Dev verification
cd cli && npx vitest run test/ci-reporter.test.js
cd cli && npm test

# QA verification
cd cli && npx vitest run test/ci-reporter.test.js
cd cli && npm test
# Inspect ROADMAP.md:101-104 for checkoff status
```

---

## 5. Key Architecture Invariants (Verification Checklist)

QA should confirm each invariant still holds:

1. [ ] ci-reporter.js does not import config.js or governed-state.js
2. [ ] report.js, export.js, export-verifier.js are unmodified since run_685ea79f49acd469
3. [ ] formatGitHubAnnotations, formatJUnitXml, deriveCIExitCode are pure functions
4. [ ] GitHub Actions annotations use ::notice/::warning/::error syntax
5. [ ] JUnit XML follows testsuites/testsuite/testcase structure
6. [ ] Exit codes: 0=pass, 1=fail, 2=error
