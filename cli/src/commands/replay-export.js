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

function restoreExportFiles(root, files, scopeLabel) {
  if (!files || typeof files !== 'object') {
    throw new Error(`${scopeLabel} is missing a valid files object.`);
  }

  let restored = 0;
  for (const [relPath, entry] of Object.entries(files)) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });

    if (typeof entry === 'string') {
      writeFileSync(absPath, entry);
      restored++;
      continue;
    }

    if (!entry || typeof entry !== 'object' || typeof entry.content_base64 !== 'string') {
      throw new Error(`${scopeLabel} entry "${relPath}" must provide content_base64.`);
    }

    writeFileSync(absPath, Buffer.from(entry.content_base64, 'base64'));
    restored++;
  }

  return restored;
}

function restoreCoordinatorRepos(tempRoot, repos) {
  if (!repos || typeof repos !== 'object') {
    return 0;
  }

  let restored = 0;
  for (const [repoId, repoEntry] of Object.entries(repos)) {
    if (!repoEntry || repoEntry.ok === false) {
      continue;
    }

    if (typeof repoEntry.path !== 'string' || !repoEntry.path.trim()) {
      throw new Error(`Coordinator repo "${repoId}" is marked ok but has no path.`);
    }

    const nestedFiles = repoEntry.export?.files;
    if (!nestedFiles || typeof nestedFiles !== 'object') {
      throw new Error(`Coordinator repo "${repoId}" is marked ok but has no nested export.files.`);
    }

    const repoRoot = join(tempRoot, repoEntry.path);
    mkdirSync(repoRoot, { recursive: true });
    restored += restoreExportFiles(repoRoot, nestedFiles, `repos.${repoId}.export.files`);
  }

  return restored;
}

function readEmbeddedJsonEntry(entry, label) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${label} is not a valid export file entry.`);
  }

  if (entry.data && typeof entry.data === 'object') {
    return entry.data;
  }

  if (typeof entry.content_base64 !== 'string' || !entry.content_base64) {
    throw new Error(`${label} must provide content_base64.`);
  }

  try {
    return JSON.parse(Buffer.from(entry.content_base64, 'base64').toString('utf8'));
  } catch (err) {
    throw new Error(`${label} contains invalid JSON: ${err.message}`);
  }
}

function getCoordinatorReplayPhases(exportData) {
  const coordinatorConfig = exportData?.config
    || readEmbeddedJsonEntry(exportData?.files?.['agentxchain-multi.json'], 'files["agentxchain-multi.json"]');
  const routingPhases = Object.keys(coordinatorConfig?.routing || {});
  if (routingPhases.length > 0) {
    return routingPhases;
  }

  const phases = [];
  for (const workstreamId of Object.keys(coordinatorConfig?.workstreams || {})) {
    const phase = coordinatorConfig.workstreams?.[workstreamId]?.phase;
    if (phase && !phases.includes(phase)) {
      phases.push(phase);
    }
  }

  return phases.length > 0 ? phases : ['planning'];
}

function restoreFailedCoordinatorRepoStubs(tempRoot, exportData) {
  if (!exportData?.repos || typeof exportData.repos !== 'object') {
    return 0;
  }

  const phases = getCoordinatorReplayPhases(exportData);
  const coordinatorState = exportData?.files?.['.agentxchain/multirepo/state.json']
    ? readEmbeddedJsonEntry(exportData.files['.agentxchain/multirepo/state.json'], 'files[".agentxchain/multirepo/state.json"]')
    : null;

  let restored = 0;
  for (const [repoId, repoEntry] of Object.entries(exportData.repos)) {
    if (!repoEntry || repoEntry.ok !== false) {
      continue;
    }

    if (typeof repoEntry.path !== 'string' || !repoEntry.path.trim()) {
      throw new Error(`Coordinator repo "${repoId}" failed export but has no path.`);
    }

    const repoRoot = join(tempRoot, repoEntry.path);
    const promptPath = '.agentxchain/prompts/replay.md';
    const repoRun = coordinatorState?.repo_runs?.[repoId] || {};
    const defaultPhase = repoRun.phase || phases[0] || 'planning';
    const routing = Object.fromEntries(
      phases.map((phase) => [
        phase,
        {
          entry_role: 'replay',
          allowed_next_roles: ['replay', 'human'],
        },
      ]),
    );
    const config = {
      schema_version: '1.0',
      template: 'generic',
      project: {
        id: `${repoId}-replay-placeholder`,
        name: `${repoId} Replay Placeholder`,
      },
      roles: {
        replay: {
          title: 'Replay Placeholder',
          mandate: 'Preserve coordinator replay continuity when nested repo export is unavailable.',
          write_authority: 'review_only',
          runtime: 'replay-placeholder',
        },
      },
      runtimes: {
        'replay-placeholder': { type: 'manual' },
      },
      routing,
      gates: {},
      prompts: {
        replay: promptPath,
      },
      rules: {
        challenge_required: true,
        max_turn_retries: 2,
        max_deadlock_cycles: 2,
      },
    };
    const state = {
      schema_version: '1.1',
      run_id: repoRun.run_id || null,
      status: repoRun.status || 'blocked',
      phase: defaultPhase,
      active_turns: {},
      turn_sequence: 0,
      retained_turns: {},
      budget_reservations: {},
      phase_gate_status: {},
    };

    mkdirSync(join(repoRoot, '.agentxchain', 'prompts'), { recursive: true });
    writeFileSync(join(repoRoot, 'agentxchain.json'), `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(join(repoRoot, '.agentxchain', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(join(repoRoot, '.agentxchain', 'history.jsonl'), '');
    writeFileSync(join(repoRoot, '.agentxchain', 'events.jsonl'), '');
    writeFileSync(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), '');
    writeFileSync(
      join(repoRoot, promptPath),
      '# Replay Placeholder\n\nThis repo export was unavailable in the coordinator artifact. Replay restores a placeholder so coordinator dashboards remain readable.\n',
    );
    restored += 6;
  }

  return restored;
}

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

    // Restore the real exported bytes for top-level files.
    let fileCount = restoreExportFiles(tempRoot, exportData.files, 'files');

    // Coordinator exports also need successful nested child repo exports
    // rehydrated under their declared repo paths for dashboard replay.
    if (exportData.export_kind === 'agentxchain_coordinator_export') {
      fileCount += restoreCoordinatorRepos(tempRoot, exportData.repos);
      fileCount += restoreFailedCoordinatorRepoStubs(tempRoot, exportData);
    }

    // Ensure agentxchain.json exists (needed by some dashboard endpoints)
    const configPath = join(tempRoot, 'agentxchain.json');
    if (exportData.export_kind !== 'agentxchain_coordinator_export' && !existsSync(configPath)) {
      // Synthesize a minimal config from export summary
      const minimalConfig = {
        protocol_version: exportData.summary?.protocol_version || null,
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
    if (err instanceof Error) {
      console.error(chalk.red(err.message));
      process.exit(2);
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
