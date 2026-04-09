import chalk from 'chalk';

import { loadExportArtifact, verifyExportArtifact } from '../lib/export-verifier.js';
import { restoreRunExport } from '../lib/restore.js';

export async function restoreCommand(opts) {
  const input = opts?.input;
  if (!input) {
    console.error('Restore requires --input <path>.');
    process.exitCode = 1;
    return;
  }

  const loaded = loadExportArtifact(input, process.cwd());
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exitCode = 1;
    return;
  }

  const verification = verifyExportArtifact(loaded.artifact);
  if (!verification.ok) {
    console.error('Restore input failed export verification:');
    for (const error of verification.errors.slice(0, 20)) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const result = restoreRunExport(process.cwd(), loaded.artifact);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green(`Restored governed continuity state from ${loaded.input}`));
  console.log(`  ${chalk.dim('Run:')}      ${result.run_id || 'none'}`);
  console.log(`  ${chalk.dim('Status:')}   ${result.status || 'unknown'}`);
  console.log(`  ${chalk.dim('Files:')}    ${result.restored_files}`);
  console.log(`  ${chalk.dim('Next:')}     agentxchain resume`);
}

