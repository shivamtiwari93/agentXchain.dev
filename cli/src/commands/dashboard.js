/**
 * CLI command: agentxchain dashboard
 *
 * Starts the local dashboard bridge server and opens a browser.
 * The dashboard remains mostly observational, but can approve pending gates.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createBridgeServer } from '../lib/dashboard/bridge-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3847;
const DASHBOARD_PID_FILE = '.agentxchain-dashboard.pid';
const DASHBOARD_SESSION_FILE = '.agentxchain-dashboard.json';
const DASHBOARD_DAEMON_CHILD_ENV = 'AGENTXCHAIN_DASHBOARD_DAEMON_CHILD';

export async function dashboardCommand(options) {
  const cwd = process.cwd();
  const agentxchainDir = join(cwd, '.agentxchain');
  const dashboardDir = join(__dirname, '..', '..', 'dashboard');

  if (!existsSync(agentxchainDir)) {
    console.error('Error: No .agentxchain/ directory found in the current directory.');
    console.error('Run "agentxchain init --governed" first to create a governed project.');
    process.exit(1);
  }

  if (!existsSync(dashboardDir)) {
    console.error('Error: Dashboard assets not found at', dashboardDir);
    process.exit(1);
  }

  if (options.daemon && process.env[DASHBOARD_DAEMON_CHILD_ENV] !== '1') {
    await startDashboardDaemon({ cwd, port: parseDashboardPort(options.port) });
    return;
  }

  cleanupDashboardFiles(cwd);

  const port = parseDashboardPort(options.port);
  const bridge = createBridgeServer({ agentxchainDir, dashboardDir, port });

  try {
    const { port: actualPort } = await bridge.start();
    const url = `http://localhost:${actualPort}`;
    writeDashboardSession(cwd, {
      pid: process.pid,
      port: actualPort,
      url,
      started_at: new Date().toISOString(),
    });

    console.log(`Dashboard running at ${url}`);
    console.log('Press Ctrl+C to stop.\n');

    if (options.open !== false) {
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
      console.log('\nShutting down dashboard...');
      cleanupDashboardFiles(cwd);
      await bridge.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    cleanupDashboardFiles(cwd);
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${port} is already in use. Try --port <number>.`);
      process.exit(1);
    }
    throw err;
  }
}

export function getDashboardPid(root) {
  const pidPath = join(root, DASHBOARD_PID_FILE);
  if (!existsSync(pidPath)) return null;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return null;
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    if (err?.code === 'ESRCH') {
      cleanupDashboardFiles(root);
      return null;
    }
    return null;
  }
}

export function getDashboardSession(root) {
  const sessionPath = join(root, DASHBOARD_SESSION_FILE);
  if (!existsSync(sessionPath)) return null;
  try {
    return JSON.parse(readFileSync(sessionPath, 'utf8'));
  } catch {
    return null;
  }
}

export function cleanupDashboardFiles(root) {
  const paths = [
    join(root, DASHBOARD_PID_FILE),
    join(root, DASHBOARD_SESSION_FILE),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try { unlinkSync(path); } catch {}
  }
}

function parseDashboardPort(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function writeDashboardSession(root, session) {
  writeFileSync(join(root, DASHBOARD_PID_FILE), `${session.pid}\n`);
  writeFileSync(join(root, DASHBOARD_SESSION_FILE), `${JSON.stringify(session, null, 2)}\n`);
}

async function startDashboardDaemon({ cwd, port }) {
  const existingPid = getDashboardPid(cwd);
  if (existingPid) {
    const existingSession = getDashboardSession(cwd);
    const existingUrl = existingSession?.url || `http://localhost:${existingSession?.port || port}`;
    console.error(`Error: Dashboard already running at ${existingUrl} (PID: ${existingPid}). Stop it first with "agentxchain stop".`);
    process.exit(1);
  }

  cleanupDashboardFiles(cwd);

  const cliBin = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
  const child = spawn(process.execPath, [cliBin, 'dashboard', '--port', String(port), '--no-open'], {
    cwd,
    env: {
      ...process.env,
      [DASHBOARD_DAEMON_CHILD_ENV]: '1',
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  try {
    const session = await waitForDashboardSession(cwd, child.pid);
    console.log(`Dashboard started in daemon mode at ${session.url}`);
    console.log(`PID: ${session.pid}`);
  } catch (err) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    cleanupDashboardFiles(cwd);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function waitForDashboardSession(root, expectedPid, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const poll = () => {
      const pid = getDashboardPid(root);
      const session = getDashboardSession(root);

      if (pid === expectedPid && session?.pid === expectedPid && typeof session?.url === 'string') {
        resolve(session);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Dashboard daemon did not report a live session within 8s.'));
        return;
      }

      setTimeout(poll, 100);
    };

    poll();
  });
}
