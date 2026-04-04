import chalk from 'chalk';

import { loadExportArtifact } from '../lib/export-verifier.js';
import {
  buildGovernanceReport,
  formatGovernanceReportMarkdown,
  formatGovernanceReportText,
} from '../lib/report.js';

function printAndExit(report, format, exitCode) {
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    process.exit(exitCode);
  }

  if (format === 'markdown') {
    console.log(formatGovernanceReportMarkdown(report));
    process.exit(exitCode);
  }

  if (format === 'text') {
    if (report.overall === 'error') {
      console.log(chalk.red(formatGovernanceReportText(report)));
    } else if (report.overall === 'fail') {
      console.log(chalk.red(formatGovernanceReportText(report)));
    } else {
      console.log(formatGovernanceReportText(report));
    }
    process.exit(exitCode);
  }

  console.error(`Unsupported report format "${format}". Use "text", "json", or "markdown".`);
  process.exit(1);
}

export async function reportCommand(opts) {
  const format = opts.format || 'text';
  const loaded = loadExportArtifact(opts.input || '-', process.cwd());

  if (!loaded.ok) {
    printAndExit({
      overall: 'error',
      input: loaded.input,
      message: loaded.error,
    }, format, 2);
    return;
  }

  const result = buildGovernanceReport(loaded.artifact, { input: loaded.input });
  printAndExit(result.report, format, result.exitCode);
}
