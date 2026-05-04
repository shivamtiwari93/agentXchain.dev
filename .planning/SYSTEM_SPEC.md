# System Spec — M9: CI Pipeline Integration

**Run:** `run_685ea79f49acd469`
**Baseline:** git:136b6cc (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Add a CI reporter module and CLI command that formats governed run results in CI-native formats: GitHub Actions annotations, GitHub output variables, and JUnit XML. This closes the CI gap in the VISION.md:18 integrations pillar.

The CI reporter **reuses** the existing `buildRunExport()` → `buildGovernanceReport()` pipeline (export.js + report.js). It adds a thin formatting layer — no new state reading, no new validation, no duplication.

---

## 1. Architecture Overview

### 1.1 Current Report Pipeline

```
agentxchain export → buildRunExport(cwd)
  │
  └─ agentxchain report → buildGovernanceReport(artifact)
       ├─ formatGovernanceReportText(report)
       ├─ formatGovernanceReportMarkdown(report)
       ├─ formatGovernanceReportHtml(report)
       └─ JSON.stringify(report)     (json format)
```

### 1.2 Extended Pipeline (After This Deliverable)

```
agentxchain ci-report → buildRunExport(cwd) or loadExportArtifact(input)
  │
  └─ buildGovernanceReport(artifact)
       │
       └─ ci-reporter.js
            ├─ detectCIEnvironment()                         ← NEW
            ├─ formatGitHubAnnotations(report)               ← NEW
            ├─ writeGitHubOutputVars(report, outputPath)     ← NEW
            ├─ formatJUnitXml(report)                        ← NEW
            └─ deriveCIExitCode(report)                      ← NEW
```

The key architectural invariant: `ci-reporter.js` consumes the **same report object** that `formatGovernanceReportText()` and friends consume. No parallel state reading path.

---

## 2. Deliverables

### 2.1 ci-reporter.js — CI Formatting Module

**New file:** `cli/src/lib/ci-reporter.js`

#### 2.1.1 `detectCIEnvironment()`

Returns a CI environment descriptor or `null` if not in CI.

```javascript
/**
 * Detect CI environment from process.env.
 * @returns {{ provider: string, run_url: string|null, run_id: string|null, ref: string|null, sha: string|null } | null}
 */
export function detectCIEnvironment() {
  if (process.env.GITHUB_ACTIONS === 'true') {
    return {
      provider: 'github_actions',
      run_url: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
      run_id: process.env.GITHUB_RUN_ID || null,
      ref: process.env.GITHUB_REF || null,
      sha: process.env.GITHUB_SHA || null,
    };
  }
  if (process.env.GITLAB_CI === 'true') {
    return {
      provider: 'gitlab_ci',
      run_url: process.env.CI_PIPELINE_URL || null,
      run_id: process.env.CI_PIPELINE_ID || null,
      ref: process.env.CI_COMMIT_REF_NAME || null,
      sha: process.env.CI_COMMIT_SHA || null,
    };
  }
  if (process.env.CI === 'true') {
    return {
      provider: 'generic',
      run_url: null,
      run_id: null,
      ref: null,
      sha: null,
    };
  }
  return null;
}
```

**Detection priority:** GitHub Actions → GitLab CI → generic. GitHub Actions sets `GITHUB_ACTIONS=true` *and* `CI=true`, so the specific check must come first.

#### 2.1.2 `formatGitHubAnnotations(report)`

Converts a governance report into GitHub Actions workflow command strings.

```javascript
/**
 * Format governance report as GitHub Actions annotations.
 * @param {{ overall: string, subject?: object }} report - Governance report from buildGovernanceReport()
 * @returns {string} Newline-separated GitHub Actions workflow commands
 */
export function formatGitHubAnnotations(report) {
  const lines = [];

  // Overall run status
  const summary = report.subject?.run?.status || report.overall;
  if (report.overall === 'pass') {
    lines.push(`::notice title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — PASS (${report.subject?.run?.phase || 'unknown'} phase)`);
  } else if (report.overall === 'fail') {
    lines.push(`::error title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — FAIL: ${report.message || 'governance check failed'}`);
  } else {
    lines.push(`::warning title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — ${report.overall}: ${report.message || 'review required'}`);
  }

  // Gate annotations
  const gates = report.subject?.run?.gate_summary;
  if (gates && typeof gates === 'object') {
    for (const [gateName, gateStatus] of Object.entries(gates)) {
      if (typeof gateStatus !== 'string') continue;
      const normalizedStatus = gateStatus.toLowerCase();
      if (normalizedStatus === 'satisfied' || normalizedStatus === 'pass' || normalizedStatus === 'passed') {
        lines.push(`::notice title=Gate ${gateName}::satisfied`);
      } else {
        lines.push(`::warning title=Gate ${gateName}::${gateStatus}`);
      }
    }
  }

  // Decision annotations (first 20 to avoid flooding)
  const decisions = report.subject?.run?.decisions || [];
  for (const d of decisions.slice(0, 20)) {
    lines.push(`::notice title=Decision ${d.id || 'unknown'}::${d.statement || d.summary || 'no statement'}`);
  }

  // Blocked-on annotation
  if (report.subject?.run?.blocked_on) {
    lines.push(`::error title=Blocked::${report.subject.run.blocked_reason || report.subject.run.blocked_on}`);
  }

  return lines.join('\n');
}
```

**Format contract:** Each line is a single GitHub Actions workflow command. Lines use `::notice title=X::message`, `::warning title=X::message`, or `::error title=X::message`. The title provides grouping; the message provides detail.

#### 2.1.3 `writeGitHubOutputVars(report, outputPath)`

Writes structured key-value pairs to the `$GITHUB_OUTPUT` file for downstream CI steps.

```javascript
import { appendFileSync } from 'node:fs';

/**
 * Write governance report summary as GitHub Actions output variables.
 * @param {{ overall: string, subject?: object }} report
 * @param {string} outputPath - Path to $GITHUB_OUTPUT file
 * @returns {string[]} Array of key=value pairs written
 */
export function writeGitHubOutputVars(report, outputPath) {
  const run = report.subject?.run || {};
  const pairs = [
    `run_status=${report.overall || 'unknown'}`,
    `run_id=${run.run_id || ''}`,
    `phase=${run.phase || ''}`,
    `blocked=${run.blocked_on ? 'true' : 'false'}`,
    `turn_count=${(run.turns || []).length}`,
    `decision_count=${(run.decisions || []).length}`,
  ];

  if (outputPath) {
    appendFileSync(outputPath, pairs.join('\n') + '\n');
  }

  return pairs;
}
```

**Output variables available to downstream steps:**
- `run_status`: overall governance verdict (pass/fail/error)
- `run_id`: the governed run ID
- `phase`: current phase
- `blocked`: whether the run is blocked
- `turn_count`: number of completed turns
- `decision_count`: number of decisions recorded

#### 2.1.4 `formatJUnitXml(report)`

Generates JUnit XML from gate results and turn outcomes.

```javascript
/**
 * Format governance report as JUnit XML.
 * @param {{ overall: string, subject?: object }} report
 * @returns {string} JUnit XML string
 */
export function formatJUnitXml(report) {
  const run = report.subject?.run || {};
  const gates = run.gate_summary || {};
  const turns = run.turns || [];

  // Escape XML special characters
  const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Build gate test cases
  const gateEntries = Object.entries(gates).filter(([, v]) => typeof v === 'string');
  const gateFailures = gateEntries.filter(([, status]) => {
    const s = status.toLowerCase();
    return s !== 'satisfied' && s !== 'pass' && s !== 'passed';
  });
  const gateCases = gateEntries.map(([name, status]) => {
    const s = status.toLowerCase();
    const passed = s === 'satisfied' || s === 'pass' || s === 'passed';
    if (passed) {
      return `    <testcase name="${esc(name)}" classname="agentxchain.gates" time="0" />`;
    }
    return [
      `    <testcase name="${esc(name)}" classname="agentxchain.gates" time="0">`,
      `      <failure message="${esc(status)}">${esc(name)} gate status: ${esc(status)}</failure>`,
      '    </testcase>',
    ].join('\n');
  });

  // Build turn test cases
  const turnFailures = turns.filter((t) => t.status === 'failed' || t.status === 'blocked');
  const turnCases = turns.map((t) => {
    const name = `${t.turn_id || 'unknown'} (${t.role || 'unknown'})`;
    const time = typeof t.duration_seconds === 'number' ? t.duration_seconds.toFixed(1) : '0';
    if (t.status === 'completed' || t.status === 'accepted') {
      return `    <testcase name="${esc(name)}" classname="agentxchain.turns" time="${time}" />`;
    }
    return [
      `    <testcase name="${esc(name)}" classname="agentxchain.turns" time="${time}">`,
      `      <failure message="${esc(t.status || 'unknown')}">${esc(t.summary || t.status || 'turn did not complete successfully')}</failure>`,
      '    </testcase>',
    ].join('\n');
  });

  const totalTests = gateEntries.length + turns.length;
  const totalFailures = gateFailures.length + turnFailures.length;
  const totalTime = typeof run.duration_seconds === 'number' ? run.duration_seconds.toFixed(1) : '0';

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="AgentXchain Governance" tests="${totalTests}" failures="${totalFailures}" errors="0" time="${totalTime}">`,
    `  <testsuite name="Gates" tests="${gateEntries.length}" failures="${gateFailures.length}" errors="0">`,
    ...gateCases,
    '  </testsuite>',
    `  <testsuite name="Turns" tests="${turns.length}" failures="${turnFailures.length}" errors="0">`,
    ...turnCases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');

  return xml;
}
```

**JUnit mapping:**
- `<testsuites name="AgentXchain Governance">` — root element
- `<testsuite name="Gates">` — each gate becomes a `<testcase>` with `classname="agentxchain.gates"`
- `<testsuite name="Turns">` — each turn becomes a `<testcase>` with `classname="agentxchain.turns"`
- `<failure>` elements added for unsatisfied gates and non-completed turns

#### 2.1.5 `deriveCIExitCode(report)`

```javascript
/**
 * Derive CI-appropriate exit code from governance report.
 * @param {{ overall: string }} report
 * @returns {number} 0 = pass, 1 = fail, 2 = error
 */
export function deriveCIExitCode(report) {
  if (report.overall === 'pass') return 0;
  if (report.overall === 'fail') return 1;
  return 2;
}
```

---

### 2.2 ci-report.js — CLI Command

**New file:** `cli/src/commands/ci-report.js`

```javascript
import { buildRunExport } from '../lib/export.js';
import { loadExportArtifact } from '../lib/export-verifier.js';
import { buildGovernanceReport } from '../lib/report.js';
import {
  deriveCIExitCode,
  detectCIEnvironment,
  formatGitHubAnnotations,
  formatJUnitXml,
  writeGitHubOutputVars,
} from '../lib/ci-reporter.js';

export async function ciReportCommand(options) {
  const cwd = process.cwd();
  const format = options.format || 'auto';

  // Step 1: Build or load the governance report
  let report;
  if (options.input && options.input !== '-') {
    const loaded = loadExportArtifact(options.input, cwd);
    if (!loaded.ok) {
      console.error(loaded.error);
      process.exitCode = 1;
      return;
    }
    const result = buildGovernanceReport(loaded.artifact, { input: loaded.input });
    report = result.report;
  } else {
    // Build from current project
    const exportResult = buildRunExport(cwd);
    if (!exportResult.ok) {
      console.error(exportResult.error);
      process.exitCode = 1;
      return;
    }
    const result = buildGovernanceReport(exportResult.export, { input: 'current-project' });
    report = result.report;
  }

  // Step 2: Detect CI environment and resolve format
  const ci = detectCIEnvironment();
  let resolvedFormat = format;
  if (resolvedFormat === 'auto') {
    if (ci?.provider === 'github_actions') {
      resolvedFormat = 'github-actions';
    } else {
      resolvedFormat = 'json';
    }
  }

  // Step 3: Emit formatted output
  switch (resolvedFormat) {
    case 'github-actions': {
      const annotations = formatGitHubAnnotations(report);
      console.log(annotations);

      // Write output variables if $GITHUB_OUTPUT is set
      const ghOutput = process.env.GITHUB_OUTPUT;
      if (ghOutput) {
        writeGitHubOutputVars(report, ghOutput);
      }
      break;
    }
    case 'junit-xml': {
      const xml = formatJUnitXml(report);
      console.log(xml);
      break;
    }
    case 'json': {
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    default:
      console.error(`Unsupported ci-report format "${resolvedFormat}". Use "github-actions", "junit-xml", "json", or "auto".`);
      process.exitCode = 1;
      return;
  }

  // Step 4: Exit with CI-appropriate code
  process.exitCode = deriveCIExitCode(report);
}
```

**Command behavior:**
1. Builds a governance report from the current project (or a provided export file)
2. Auto-detects CI provider or uses `--format` override
3. Emits formatted output to stdout
4. Writes output variables to `$GITHUB_OUTPUT` (GitHub Actions format only)
5. Exits with 0 (pass), 1 (fail), or 2 (error)

---

### 2.3 agentxchain.js — Command Registration

**Modify existing file:** `cli/bin/agentxchain.js`

#### 2.3.1 Add import (after line 89, after the `reportCommand` import)

```javascript
import { ciReportCommand } from '../src/commands/ci-report.js';
```

#### 2.3.2 Add command registration (after line 195, after the `report` command block)

```javascript
program
  .command('ci-report')
  .description('Report governed run results in CI-native formats (GitHub Actions annotations, JUnit XML)')
  .option('--input <path>', 'Export artifact path, or use current project if omitted')
  .option('--format <format>', 'Output format: auto, github-actions, junit-xml, json', 'auto')
  .action(ciReportCommand);
```

---

## 3. Test Specification

### 3.1 ci-reporter.test.js (~12 tests)

**New file:** `cli/test/ci-reporter.test.js`

Imports `detectCIEnvironment`, `formatGitHubAnnotations`, `writeGitHubOutputVars`, `formatJUnitXml`, `deriveCIExitCode` from `ci-reporter.js`.

#### Test Cases

| # | Test ID | Suite | Description | Key Assertion |
|---|---------|-------|-------------|---------------|
| 1 | AT-CI-001 | CI detection | returns github_actions when GITHUB_ACTIONS=true | `env.provider === 'github_actions'` |
| 2 | AT-CI-002 | CI detection | returns gitlab_ci when GITLAB_CI=true | `env.provider === 'gitlab_ci'` |
| 3 | AT-CI-003 | CI detection | returns generic when only CI=true | `env.provider === 'generic'` |
| 4 | AT-CI-004 | CI detection | returns null outside CI | `env === null` |
| 5 | AT-CI-005 | GitHub annotations | emits ::notice for passing run | output includes `::notice title=AgentXchain Governance::` |
| 6 | AT-CI-006 | GitHub annotations | emits ::error for failing run | output includes `::error title=AgentXchain Governance::` |
| 7 | AT-CI-007 | GitHub annotations | includes gate annotations | output includes `::notice title=Gate` or `::warning title=Gate` |
| 8 | AT-CI-008 | GitHub output vars | writes key=value pairs to file | file contains `run_status=pass` and `run_id=` |
| 9 | AT-CI-009 | JUnit XML | produces valid XML with testsuites and testcases | output contains `<testsuites`, `<testsuite`, `<testcase` |
| 10 | AT-CI-010 | JUnit XML | maps failed gates to failure elements | output contains `<failure` for unsatisfied gate |
| 11 | AT-CI-011 | Exit code | returns 0 for pass, 1 for fail, 2 for error | `deriveCIExitCode({ overall: 'pass' }) === 0` etc. |
| 12 | AT-CI-012 | Command integration | ci-report command produces output and exits with correct code | command produces non-empty output; exit code matches overall |

#### Test Helpers

**CI detection tests** must temporarily set and restore `process.env` variables. Use a helper pattern:

```javascript
function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}
```

**Report fixture** for formatting tests:

```javascript
const PASSING_REPORT = {
  overall: 'pass',
  subject: {
    kind: 'governed_run',
    run: {
      run_id: 'run_test_001',
      status: 'active',
      phase: 'qa',
      blocked_on: null,
      blocked_reason: null,
      gate_summary: {
        planning_signoff: 'satisfied',
        implementation_complete: 'satisfied',
        qa_ship_verdict: 'pending',
      },
      turns: [
        { turn_id: 'turn_001', role: 'pm', status: 'accepted', duration_seconds: 45 },
        { turn_id: 'turn_002', role: 'dev', status: 'accepted', duration_seconds: 120 },
      ],
      decisions: [
        { id: 'DEC-001', statement: 'Test decision' },
      ],
      duration_seconds: 165,
    },
  },
};

const FAILING_REPORT = {
  overall: 'fail',
  message: 'governance check failed',
  subject: {
    kind: 'governed_run',
    run: {
      run_id: 'run_test_002',
      status: 'blocked',
      phase: 'implementation',
      blocked_on: 'credential_failure',
      blocked_reason: 'API key expired',
      gate_summary: {
        planning_signoff: 'satisfied',
        implementation_complete: 'pending',
      },
      turns: [
        { turn_id: 'turn_003', role: 'pm', status: 'accepted', duration_seconds: 30 },
        { turn_id: 'turn_004', role: 'dev', status: 'failed', summary: 'API key expired' },
      ],
      decisions: [],
      duration_seconds: 60,
    },
  },
};
```

#### AT-CI-012 Command Integration Pattern

For the command integration test, use a temporary directory with a minimal agentxchain project fixture (agentxchain.json + .agentxchain/state.json + .agentxchain/history.jsonl) and invoke `ciReportCommand` with `--format json`. Assert:
- Non-empty stdout (JSON output)
- `process.exitCode` matches `deriveCIExitCode` for the report

Alternatively, invoke the CI reporter functions directly on a pre-built export artifact, avoiding the need for a full project fixture. This is cleaner and avoids coupling to the export machinery internals.

---

## 4. Files Changed (Expected)

| File | Change Type | LOC | Description |
|------|-------------|-----|-------------|
| `cli/src/lib/ci-reporter.js` | **Create** | ~120 | CI detection, GitHub annotations, output vars, JUnit XML, exit code |
| `cli/src/commands/ci-report.js` | **Create** | ~70 | CLI command: export → report → CI format → exit code |
| `cli/bin/agentxchain.js` | **Modify** | +3 | Import + command registration for ci-report |
| `cli/test/ci-reporter.test.js` | **Create** | ~200 | 12 tests covering detection, formatting, integration |

2 new source files, 1 modified file, 1 new test file. Vitest contract file count increases from 673 to 674.

---

## 5. Key Architecture Invariants

1. **No new state reading.** `ci-reporter.js` does not import `config.js`, `governed-state.js`, or any state reader. It consumes the governance report object produced by the existing `buildGovernanceReport()` function in `report.js`.
2. **No modifications to existing modules.** `report.js`, `export.js`, `export-verifier.js` remain untouched. The CI reporter is purely additive.
3. **Pure functions.** `formatGitHubAnnotations()`, `formatJUnitXml()`, and `deriveCIExitCode()` are pure functions (input → output, no side effects). Only `writeGitHubOutputVars()` has a side effect (appends to a file) and `detectCIEnvironment()` reads env vars.
4. **Standard output formats.** GitHub Actions annotations use the documented `::command::` syntax. JUnit XML follows the JUnit 4 schema (testsuites/testsuite/testcase/failure). Both are consumed natively by GitHub, GitLab, Jenkins, and CircleCI without configuration.
5. **Exit code contract.** 0 = governance pass (ship-ready), 1 = governance fail, 2 = error (invalid input, missing project). CI systems treat non-zero as failure by default, matching the governance semantics.

---

## Interface

### Exported Functions

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

### CLI Interface

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

### Example CI Usage

**GitHub Actions step:**
```yaml
- name: Report governance results
  run: npx agentxchain ci-report
  env:
    GITHUB_OUTPUT: ${{ github.output }}
```

**JUnit XML artifact:**
```yaml
- name: Generate JUnit report
  run: npx agentxchain ci-report --format junit-xml > governance-results.xml
- uses: actions/upload-artifact@v4
  with:
    name: governance-junit
    path: governance-results.xml
```

---

## Dev Charter

### Scope

**2 new source files + 1 modified file + 1 new test file (4 total).**

1. `cli/src/lib/ci-reporter.js` — Create: 5 exported functions
2. `cli/src/commands/ci-report.js` — Create: 1 exported command function
3. `cli/bin/agentxchain.js` — Modify: +1 import (after line 89), +1 command block (after line 195)
4. `cli/test/ci-reporter.test.js` — Create: 12 tests

### Out of Scope

- Changes to report.js, export.js, or export-verifier.js
- Changes to notification-runner.js or webhook system
- Changes to any adapter, state machine, or run-loop code
- GitLab CI collapsible sections (use JSON fallback for non-GitHub providers)
- Modifying governed-todo-app-proof.yml to use ci-report

### Verification

Dev must confirm:
1. `detectCIEnvironment()` returns correct provider for each env var combination
2. `formatGitHubAnnotations()` produces valid `::notice`, `::warning`, `::error` lines
3. `writeGitHubOutputVars()` writes key=value pairs to specified file
4. `formatJUnitXml()` produces well-formed XML with testsuites/testsuite/testcase structure
5. `formatJUnitXml()` includes `<failure>` elements for unsatisfied gates and failed turns
6. `deriveCIExitCode()` returns 0 for 'pass', 1 for 'fail', 2 for other
7. `ci-report` command registered in agentxchain.js and appears in `--help`
8. All 12 ci-reporter.test.js tests pass
9. Vitest contract passes with 674 files
10. Full test suite passes: `cd cli && npm test`

## Acceptance Tests

- [ ] AT-CI-001: detectCIEnvironment returns github_actions when GITHUB_ACTIONS=true
- [ ] AT-CI-002: detectCIEnvironment returns gitlab_ci when GITLAB_CI=true
- [ ] AT-CI-003: detectCIEnvironment returns generic when only CI=true
- [ ] AT-CI-004: detectCIEnvironment returns null outside CI
- [ ] AT-CI-005: formatGitHubAnnotations emits ::notice for passing run
- [ ] AT-CI-006: formatGitHubAnnotations emits ::error for failing run
- [ ] AT-CI-007: formatGitHubAnnotations includes gate-level annotations
- [ ] AT-CI-008: writeGitHubOutputVars writes key=value pairs to file
- [ ] AT-CI-009: formatJUnitXml produces valid XML with testsuites and testcases
- [ ] AT-CI-010: formatJUnitXml maps failed gates to failure elements
- [ ] AT-CI-011: deriveCIExitCode returns 0 for pass, 1 for fail, 2 for error
- [ ] AT-CI-012: ci-report command integrates with governance report pipeline
