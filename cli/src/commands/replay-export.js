/**
 * CLI command: agentxchain replay export <export-file>
 *
 * Starts the dashboard bridge-server serving a completed export's state
 * for offline post-mortem analysis. The dashboard is fully read-only:
 * no file watcher, no gate approval, no WebSocket push.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import chalk from 'chalk';

import { createBridgeServer } from '../lib/dashboard/bridge-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function replayExportCommand(exportFile, opts = {}) {
  if (!exportFile) {
    console.error(chalk.red('Usage: agentxchain replay export <export-file>'));
    process.exit(2);
  }

  const exportPath = resolve(exportFile);
  if (!existsSync(exportPath)) {
    console.error(chalk.red(`Export file not found: ${exportPath}`));
    process.exit(2);
  }

  let exportData;
  try {
    exportData = JSON.parse(readFileSync(exportPath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`Failed to parse export file: ${err.message}`));
    process.exit(2);
  }

  if (!exportData.files || typeof exportData.files !== 'object') {
    console.error(chalk.red('Export file missing "files" object. Not a valid agentxchain export.'));
    process.exit(2);
  }

  // Create temp workspace with exported files
  const tempId = randomBytes(8).toString('hex');
  const tempRoot = join(tmpdir(), `agentxchain-replay-${tempId}`);
  const tempAgentxchainDir = join(tempRoot, '.agentxchain');

  try {
    mkdirSync(tempRoot, { recursive: true });
    mkdirSync(tempAgentxchainDir, { recursive: true });

    // Write all embedded files from the export
    let fileCount = 0;
    for (const [relPath, content] of Object.entries(exportData.files)) {
      const absPath = join(tempRoot, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      fileCount++;
    }

    // Ensure agentxchain.json exists (needed by some dashboard endpoints)
    const configPath = join(tempRoot, 'agentxchain.json');
    if (!existsSync(configPath)) {
      // Synthesize a minimal config from export summary
      const minimalConfig = {
        protocol_version: exportData.summary?.protocol_version || 6,
        protocol_mode: 'governed',
        version: 4,
        project: { name: exportData.summary?.project_name || 'replay-export' },
        roles: exportData.summary?.roles || {},
        runtimes: {},
        workflow: exportData.summary?.workflow || {},
      };
      writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2));
    }

    const dashboardDir = join(__dirname, '..', '..', 'dashboard');
    if (!existsSync(dashboardDir)) {
      console.error(chalk.red('Dashboard assets not found.'));
      cleanup(tempRoot);
      process.exit(1);
    }

    const port = parseInt(opts.port, 10) || 3847;
    const bridge = createBridgeServer({
      agentxchainDir: tempAgentxchainDir,
      dashboardDir,
      port,
      replayMode: true,
    });

    const { port: actualPort } = await bridge.start();
    const url = `http://localhost:${actualPort}`;

    const runId = exportData.summary?.run_id || null;
    const schemaVersion = exportData.schema_version || null;

    if (opts.json) {
      console.log(JSON.stringify({
        port: actualPort,
        url,
        export_file: exportPath,
        run_id: runId,
        export_schema_version: schemaVersion,
        files_restored: fileCount,
        temp_dir: tempRoot,
      }, null, 2));
    } else {
      console.log('');
      console.log(chalk.bold(`  Replay Export Dashboard`));
      console.log(chalk.dim('  ' + '─'.repeat(40)));
      console.log(`  ${chalk.dim('Export:')}   ${exportPath}`);
      console.log(`  ${chalk.dim('Run ID:')}   ${runId || '—'}`);
      console.log(`  ${chalk.dim('Schema:')}   ${schemaVersion || '—'}`);
      console.log(`  ${chalk.dim('Files:')}    ${fileCount} restored`);
      console.log(`  ${chalk.dim('URL:')}      ${chalk.cyan(url)}`);
      console.log('');
      console.log(chalk.dim('  Read-only mode — no live updates, no gate approval.'));
      console.log(chalk.dim('  Press Ctrl+C to stop.'));
      console.log('');
    }

    if (opts.open !== false && !opts.json) {
      try {
        const { exec } = await import('child_process');
        const openCmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'start'
          : 'xdg-open';
        exec(`${openCmd} ${url}`);
      } catch {
        // Browser open is best-effort
      }
    }

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (!opts.json) {
        console.log('\nShutting down replay dashboard...');
      }
      await bridge.stop();
      cleanup(tempRoot);
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    cleanup(tempRoot);
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`Port ${opts.port || 3847} is already in use. Try --port <number>.`));
      process.exit(1);
    }
    throw err;
  }
}

function cleanup(tempRoot) {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
