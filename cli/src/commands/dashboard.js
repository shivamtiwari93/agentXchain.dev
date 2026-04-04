/**
 * CLI command: agentxchain dashboard
 *
 * Starts the local dashboard bridge server and opens a browser.
 * The dashboard remains mostly observational, but can approve pending gates.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createBridgeServer } from '../lib/dashboard/bridge-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3847;

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

  const port = parseInt(options.port, 10) || DEFAULT_PORT;
  const bridge = createBridgeServer({ agentxchainDir, dashboardDir, port });

  try {
    const { port: actualPort } = await bridge.start();
    const url = `http://localhost:${actualPort}`;

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

    // Keep running until interrupted
    const shutdown = async () => {
      console.log('\nShutting down dashboard...');
      await bridge.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${port} is already in use. Try --port <number>.`);
      process.exit(1);
    }
    throw err;
  }
}
