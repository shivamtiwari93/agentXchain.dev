import chalk from 'chalk';

import { buildCoordinatorExport, buildRunExport } from '../lib/export.js';
import {
  buildGovernanceReport,
  formatGovernanceReportHtml,
  formatGovernanceReportMarkdown,
  formatGovernanceReportText,
} from '../lib/report.js';

function detectAuditKind(cwd) {
  const runResult = buildRunExport(cwd);
  if (runResult.ok) {
    return {
      ok: true,
      input: cwd,
      artifact: runResult.export,
    };
  }

  const coordinatorResult = buildCoordinatorExport(cwd);
  if (coordinatorResult.ok) {
    return {
      ok: true,
      input: cwd,
      artifact: coordinatorResult.export,
    };
  }

  return {
    ok: false,
    error: runResult.error || coordinatorResult.error || 'No governed project or coordinator workspace found.',
  };
}

function printAndExit(report, format, exitCode) {
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    process.exit(exitCode);
  }

  if (format === 'markdown') {
    console.log(formatGovernanceReportMarkdown(report));
    process.exit(exitCode);
  }

  if (format === 'html') {
    console.log(formatGovernanceReportHtml(report));
    process.exit(exitCode);
  }

  if (format === 'text') {
    if (report.overall === 'error' || report.overall === 'fail') {
      console.log(chalk.red(formatGovernanceReportText(report)));
    } else {
      console.log(formatGovernanceReportText(report));
    }
    process.exit(exitCode);
  }

  console.error(`Unsupported audit format "${format}". Use "text", "json", "markdown", or "html".`);
  process.exit(2);
}

export async function auditCommand(options) {
  const format = options.format || 'text';
  const cwd = process.cwd();
  const resolved = detectAuditKind(cwd);

  if (!resolved.ok) {
    printAndExit({
      overall: 'error',
      input: cwd,
      message: resolved.error,
    }, format, 2);
    return;
  }

  const result = buildGovernanceReport(resolved.artifact, { input: resolved.input });
  printAndExit(result.report, format, result.exitCode);
}
