import { appendFileSync } from 'node:fs';

/**
 * Normalize gate_summary to [gateName, statusString] entries.
 * Handles both array format ([{ gate_id, status }]) from the real report pipeline
 * and object format ({ gateName: statusString }) from legacy/synthetic fixtures.
 */
function normalizeGateEntries(gates) {
  if (Array.isArray(gates)) {
    return gates
      .filter(g => typeof g?.gate_id === 'string' && typeof g?.status === 'string')
      .map(g => [g.gate_id, g.status]);
  }
  if (gates && typeof gates === 'object') {
    return Object.entries(gates).filter(([, v]) => typeof v === 'string');
  }
  return [];
}

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

/**
 * Format governance report as GitHub Actions annotations.
 * @param {{ overall: string, subject?: object }} report - Governance report from buildGovernanceReport()
 * @returns {string} Newline-separated GitHub Actions workflow commands
 */
export function formatGitHubAnnotations(report) {
  const lines = [];

  // Overall run status
  if (report.overall === 'pass') {
    lines.push(`::notice title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — PASS (${report.subject?.run?.phase || 'unknown'} phase)`);
  } else if (report.overall === 'fail') {
    lines.push(`::error title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — FAIL: ${report.message || 'governance check failed'}`);
  } else {
    lines.push(`::warning title=AgentXchain Governance::Run ${report.subject?.run?.run_id || 'unknown'} — ${report.overall}: ${report.message || 'review required'}`);
  }

  // Gate annotations
  for (const [gateName, gateStatus] of normalizeGateEntries(report.subject?.run?.gate_summary)) {
    const normalizedStatus = gateStatus.toLowerCase();
    if (normalizedStatus === 'satisfied' || normalizedStatus === 'pass' || normalizedStatus === 'passed') {
      lines.push(`::notice title=Gate ${gateName}::satisfied`);
    } else {
      lines.push(`::warning title=Gate ${gateName}::${gateStatus}`);
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

/**
 * Format governance report as JUnit XML.
 * @param {{ overall: string, subject?: object }} report
 * @returns {string} JUnit XML string
 */
export function formatJUnitXml(report) {
  const run = report.subject?.run || {};
  const turns = run.turns || [];

  // Escape XML special characters
  const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Build gate test cases
  const gateEntries = normalizeGateEntries(run.gate_summary);
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
