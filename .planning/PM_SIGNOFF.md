# PM Signoff — M9: CI Pipeline Integration

Approved: YES

**Run:** `run_685ea79f49acd469`
**Phase:** planning
**Turn:** `turn_6a7155209207ff1c`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed multi-agent runs inside **CI pipelines** (GitHub Actions, GitLab CI, or any generic CI provider). These operators need governed run outcomes reported in CI-native formats — annotations, output variables, JUnit XML — so that CI dashboards, downstream steps, and merge gates can consume AgentXchain governance results without custom glue scripts.

### Core Pain Point

VISION.md (line 18) declares **integrations with IDEs, CLIs, APIs, CI, dashboards, and organizational systems** as a core product pillar. Of these six integration surfaces:

- **IDEs**: Complete — VS Code extension + 5 local CLI connectors (Claude, Codex, Cursor, Windsurf, OpenCode)
- **CLIs**: Complete — 72+ commands, full CLI governance surface
- **APIs**: Complete — control plane API, hosted runner, MCP server, protocol bridge
- **Dashboards**: Complete — M6 live observer + M8 org dashboard with history and audit trail
- **Organizational systems**: Partial — webhook notifications (9 events), GitHub Issues plugin

- **CI**: **Gap** — The system has GitHub Actions for its own CI (`ci.yml`) and a `watch-intake.yml` that ingests CI failures into the intake pipeline, but there is **no way to report governed run results back to CI in CI-native formats**. An operator running `agentxchain run` inside a GitHub Actions workflow gets no annotations, no output variables, no JUnit XML, and no structured exit codes.

**Evidence:**
- `cli/bin/agentxchain.js` — No `ci-report` command among the 72+ registered commands
- `cli/src/lib/` — No `ci-reporter.js` module
- `cli/src/commands/report.js` — Supports text/markdown/html/json but no GitHub Actions annotations or JUnit XML
- `.github/workflows/governed-todo-app-proof.yml` — Runs governed proofs in CI but has no structured output step
- `cli/src/lib/report.js:1241` — `buildGovernanceReport()` produces a comprehensive report object that could feed CI formatting, but no CI formatter exists

### Challenge to Previous Turn

#### OBJ-PM-001: Planning artifacts describe M7 Windsurf & OpenCode connectors (run_0db6a75ab239c3a3), not the integrations vision charter (severity: high)

All three planning artifacts are scoped for M7 connector expansion:
- PM_SIGNOFF.md: scopes Windsurf + OpenCode detection, validation, probe, doctor
- SYSTEM_SPEC.md: details `isWindsurfLocalCliRuntime`, `isOpenCodeLocalCliRuntime`, command validation rules
- ROADMAP.md phases table: shows `run_0db6a75ab239c3a3` with connector scope

This run (`run_685ea79f49acd469`) has a different charter: `[vision] What We Are Building: integrations** with IDEs, CLIs, APIs, CI, dashboards, and organizational systems`. The integrations vision maps to the CI pipeline gap, not further connector work. All three artifacts rewritten from scratch.

#### OBJ-PM-002: ROADMAP.md M7 items not checked off despite QA ship verdict YES (severity: medium)

Run `run_0db6a75ab239c3a3` completed with QA ship verdict YES (turn_1cd75071e9051de9: 10/10 acceptance criteria, 56 tests across 5 suites, 0 failures), but ROADMAP.md:88 (Windsurf), :89 (OpenCode), and :91 (doctor acceptance) remain unchecked. Fixed in this turn.

### Core Workflow (this run)

1. **PM (this turn)** — Scope CI reporter module and command; identify integration points with existing governance report pipeline
2. **Dev** — Implement `ci-reporter.js` module, `ci-report` command, register in CLI, write tests
3. **QA** — Verify all tests pass, verify CI annotations and JUnit XML output correctness, run full regression suite

### MVP Scope (this run)

**This run delivers M9: CI Pipeline Integration — reporting governed run results in CI-native formats.**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, gap analysis, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec for ci-reporter.js module + ci-report command
3. ROADMAP.md: Check off M7 items, add M9, update phases table

**Dev deliverables:**
1. `cli/src/lib/ci-reporter.js` — **Create**: CI environment detection, GitHub Actions annotations, GitHub output variables, JUnit XML, exit code derivation
2. `cli/src/commands/ci-report.js` — **Create**: New command that reads current run state via existing export→report pipeline, formats for detected CI provider
3. `cli/bin/agentxchain.js` — **Modify**: Register `ci-report` command
4. `cli/test/ci-reporter.test.js` — **Create**: ~12 tests covering detection, formatting, and integration

### Out of Scope

- Changes to existing report.js, export.js, or export-verifier.js modules
- Changes to notification-runner.js or webhook system
- Changes to any adapter, state machine, or run-loop code
- Native Slack, Teams, or email integration (organizational systems — future work)
- CI-specific run triggers (watch-intake.yml already handles CI failure ingestion)
- Automated CI workflow generation (operators configure their own CI files)
- GitLab CI section formatting (detect provider but emit annotations on stderr as fallback)
- Changes to governed-todo-app-proof.yml (can be updated separately to consume ci-report)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Vision goal addressed: integrations with IDEs, CLIs, APIs, CI, dashboards, and organizational systems | CI pipeline integration closes the CI gap; all 6 integration surfaces now have substantive coverage |
| 2 | CI environment detection: GitHub Actions, GitLab CI, generic, none | ci-reporter.test.js AT-CI-001 through AT-CI-004 |
| 3 | GitHub Actions annotations: `::notice`, `::warning`, `::error` formatting | ci-reporter.test.js AT-CI-005 through AT-CI-007 |
| 4 | GitHub output variables: key=value pairs written to $GITHUB_OUTPUT | ci-reporter.test.js AT-CI-008 |
| 5 | JUnit XML: valid XML with testsuites, testcases, failure elements | ci-reporter.test.js AT-CI-009, AT-CI-010 |
| 6 | Exit code derivation: 0=pass, 1=fail, 2=error | ci-reporter.test.js AT-CI-011 |
| 7 | ci-report command integrates with governance report pipeline | ci-reporter.test.js AT-CI-012 |
| 8 | Vitest contract passes with 674 files | vitest-contract.test.js line 56 updated |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| GitHub Actions annotation format changes | Low | Format is stable since 2020; `::notice`/`::warning`/`::error` are documented workflow commands |
| JUnit XML schema variants across CI providers | Low | Use standard JUnit 4 schema (testsuites/testsuite/testcase); accepted by GitHub, GitLab, Jenkins, CircleCI |
| Governance report shape evolves | Low | CI reporter consumes the existing `buildGovernanceReport` output; changes propagate automatically |

### Design Decision: CI Reporter Reuses Existing Governance Report Pipeline (DEC-001)

The CI reporter does **not** read state.json directly. It reuses the existing `buildRunExport()` → `buildGovernanceReport()` pipeline from `export.js` and `report.js`. This means:
- No duplication of state reading, validation, or aggregation logic
- Full governance report quality (gates, decisions, turns, timing, recovery)
- CI formatting is a thin layer over an already-validated report object
- Future report improvements automatically flow through to CI output

### Design Decision: Auto-Detection with Format Override (DEC-002)

The `ci-report` command auto-detects the CI provider via environment variables (`GITHUB_ACTIONS`, `GITLAB_CI`, `CI`) and emits the appropriate format. Operators can override with `--format` (github-actions, junit-xml, json). Auto-detection is the default because most operators want zero-config CI integration.

### Design Decision: JUnit XML Maps Gates and Turns to Test Cases (DEC-003)

JUnit XML maps AgentXchain concepts to JUnit concepts:
- **Test suite "Gates"**: Each phase gate becomes a `<testcase>`. Satisfied gates pass; unsatisfied gates get `<failure>`.
- **Test suite "Turns"**: Each completed turn becomes a `<testcase>`. Completed turns pass; failed/blocked turns get `<failure>`.
- This mapping gives CI dashboards meaningful test result visualization without any CI-side configuration.

## Notes for Dev

**Your charter is 2 new files + 1 modified file + 1 new test file (4 total).**

See SYSTEM_SPEC.md for full technical details including:
- Exact function signatures for ci-reporter.js
- Exact command options for ci-report
- Exact insertion point in agentxchain.js for command registration
- Test case lists for ci-reporter.test.js
- JUnit XML schema and mapping rules

## Notes for QA

- Verify ci-reporter.test.js passes: `cd cli && npx vitest run test/ci-reporter.test.js`
- Verify vitest contract passes with 674 files: `cd cli && npx vitest run test/vitest-contract.test.js`
- Run full test suite: `cd cli && npm test`
- Verify GitHub Actions annotation format correctness manually (inspect output strings)
- Verify JUnit XML well-formedness (parse with DOMParser or xml2js)

## Acceptance Contract

1. **Vision goal addressed: integrations with IDEs, CLIs, APIs, CI, dashboards, and organizational systems** — CI pipeline integration closes the last major gap in the integrations pillar. After this delivery: IDEs (VS Code + 5 connectors), CLIs (72+ commands), APIs (control plane + hosted runner + MCP), CI (ci-report command with annotations + JUnit XML + output vars), Dashboards (live + org), Organizational (webhooks + GitHub Issues).
2. **Evidence:** M9 CI Pipeline Integration items checked off in ROADMAP.md after QA verification; ci-reporter.test.js passes all 12 tests; vitest contract at 674 files.

## API Map

| Module | Change | Purpose |
|--------|--------|---------|
| `ci-reporter.js` | **Create** | CI detection, GitHub annotations, output vars, JUnit XML, exit codes |
| `ci-report.js` | **Create** | CLI command: reads export → governance report → CI format |
| `agentxchain.js` | **Modify** (+1 import, +1 command block) | Register `ci-report` command |
