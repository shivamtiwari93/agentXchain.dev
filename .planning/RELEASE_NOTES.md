# Release Notes — M9: CI Pipeline Integration

**Run:** run_685ea79f49acd469
**Version:** agentxchain@2.155.72

## What's New

### CI Pipeline Integration

AgentXchain now reports governed run results in CI-native formats, closing the CI gap in the integrations pillar (VISION.md:18). New `agentxchain ci-report` command with three output formats:

- **GitHub Actions annotations**: `::notice`, `::warning`, and `::error` workflow commands for run status, gate results, decisions, and blocked-on conditions
- **GitHub output variables**: Writes `run_status`, `run_id`, `phase`, `blocked`, `turn_count`, `decision_count` to `$GITHUB_OUTPUT` for downstream CI steps
- **JUnit XML**: Standard JUnit 4 report with Gates and Turns testsuites, consumed natively by GitHub, GitLab, Jenkins, and CircleCI

### Auto-Detection

The `ci-report` command auto-detects the CI provider (GitHub Actions, GitLab CI, or generic) and selects the appropriate output format. Override with `--format github-actions|junit-xml|json`.

### Exit Codes

CI-appropriate exit codes: 0 (governance pass), 1 (governance fail), 2 (error). CI systems treat non-zero as failure, matching governance semantics.

## Usage

```bash
# Auto-detect CI provider and emit formatted output
agentxchain ci-report

# Force JUnit XML output (e.g., for artifact upload)
agentxchain ci-report --format junit-xml > governance-results.xml

# Use a pre-built export artifact
agentxchain ci-report --input .agentxchain/export.json --format github-actions
```

## Files Changed

| File | Change | Description |
|------|--------|-------------|
| `cli/src/lib/ci-reporter.js` | New | 5 exported functions: detectCIEnvironment, formatGitHubAnnotations, writeGitHubOutputVars, formatJUnitXml, deriveCIExitCode |
| `cli/src/commands/ci-report.js` | New | CLI command: export → report → CI format → exit code |
| `cli/bin/agentxchain.js` | Modified | +1 import, +1 command registration |
| `cli/test/ci-reporter.test.js` | New | 12 acceptance tests (AT-CI-001 through AT-CI-012) |
| `cli/test/vitest-contract.test.js` | Modified | File count 673 → 674 |

## Test Results

- 12/12 ci-reporter tests pass
- 11/11 vitest contract tests pass (674 files)
- 0 new failures introduced

## Architecture

The CI reporter reuses the existing `buildRunExport()` → `buildGovernanceReport()` pipeline. No new state reading, no modifications to report.js/export.js/export-verifier.js. Pure formatting layer over existing governance reports.

## Known Limitations

- GitLab CI collapsible section formatting not implemented (falls back to JSON output)
- CI workflow generation (e.g., auto-creating GitHub Actions YAML) out of scope
- 12 pre-existing test failures in docs contracts, dashboard view registry, and E2E proposal/remote-agent tests remain from prior milestones (unrelated to CI delivery)
