import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { getWatchPid } from './watch.js';
import { cleanupDashboardFiles, getDashboardPid, getDashboardSession } from './dashboard.js';

const SESSION_FILE = '.agentxchain-session.json';
const WATCH_PID_FILE = '.agentxchain-watch.pid';
const DASHBOARD_PID_FILE = '.agentxchain-dashboard.pid';
const DASHBOARD_SESSION_FILE = '.agentxchain-dashboard.json';

export async function stopCommand() {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root } = result;
  const sessionPath = join(root, SESSION_FILE);
  const watchPidPath = join(root, WATCH_PID_FILE);
  const dashboardPidPath = join(root, DASHBOARD_PID_FILE);
  const dashboardSessionPath = join(root, DASHBOARD_SESSION_FILE);
  const watchPid = getWatchPid(root);
  const hadDashboardArtifacts = existsSync(dashboardPidPath) || existsSync(dashboardSessionPath);
  const dashboardPid = getDashboardPid(root);
  const dashboardSession = getDashboardSession(root);
  let didStopAnything = false;

  if (watchPid) {
    try {
      process.kill(watchPid, 'SIGTERM');
      didStopAnything = true;
      console.log('');
      console.log(chalk.green(`  ✓ Stopped watch process (PID: ${watchPid})`));
      console.log('');
    } catch (err) {
      if (err.code === 'ESRCH') {
        if (existsSync(watchPidPath)) {
          try { unlinkSync(watchPidPath); } catch {}
        }
      } else {
        console.log(chalk.red(`  ✗ Could not stop watch process (PID: ${watchPid}): ${err.message}`));
      }
    }
  } else if (existsSync(watchPidPath)) {
    // Stale PID file from an unexpected shutdown.
    try {
      unlinkSync(watchPidPath);
      console.log(chalk.dim('  Removed stale watch PID file.'));
    } catch {}
  }

  if (dashboardPid) {
    try {
      process.kill(dashboardPid, 'SIGTERM');
      cleanupDashboardFiles(root);
      didStopAnything = true;
      console.log('');
      console.log(chalk.green(`  ✓ Stopped dashboard process (PID: ${dashboardPid})${dashboardSession?.url ? ` at ${dashboardSession.url}` : ''}`));
      console.log('');
    } catch (err) {
      if (err.code === 'ESRCH') {
        cleanupDashboardFiles(root);
      } else {
        console.log(chalk.red(`  ✗ Could not stop dashboard process (PID: ${dashboardPid}): ${err.message}`));
      }
    }
  } else if (hadDashboardArtifacts) {
    cleanupDashboardFiles(root);
    console.log(chalk.dim('  Removed stale dashboard session files.'));
  }

  if (existsSync(sessionPath)) {
    let session;
    try {
      session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    } catch {
      console.log(chalk.yellow('  Could not read session file.'));
      return;
    }

    console.log('');
    console.log(chalk.bold(`  Stopping ${session.launched?.length || 0} agents (${session.ide || 'unknown'})`));
    console.log('');

    if (session.ide === 'claude-code') {
      for (const agent of (session.launched || [])) {
        if (agent.pid) {
          try {
            process.kill(agent.pid, 'SIGTERM');
            didStopAnything = true;
            console.log(chalk.green(`  ✓ Sent SIGTERM to ${agent.id} (PID: ${agent.pid})`));
          } catch (err) {
            if (err.code === 'ESRCH') {
              console.log(chalk.dim(`  ${agent.id} (PID: ${agent.pid}) — already stopped`));
            } else {
              console.log(chalk.red(`  ✗ ${agent.id}: ${err.message}`));
            }
          }
        }
      }
    } else {
      console.log(chalk.dim('  For VS Code / Cursor agents, close the chat sessions manually.'));
    }

    unlinkSync(sessionPath);
    console.log('');
    console.log(chalk.dim('  Session file removed.'));
    console.log(chalk.green('  Done.'));
    console.log('');
    return;
  }

  if (!didStopAnything) {
    console.log(chalk.yellow('  No active session found.'));
    console.log(chalk.dim('  If agents are running in VS Code / Cursor, close their chat sessions manually.'));
  }
}
