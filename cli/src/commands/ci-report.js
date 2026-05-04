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
