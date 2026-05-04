/**
 * agentxchain serve — start the hosted runner HTTP server.
 *
 * Exposes control plane API routes for remote run management and dispatches
 * governed turns to cloud agent APIs via the execution worker.
 *
 * Usage:
 *   agentxchain serve [--port 4100] [--host 127.0.0.1] [--project <path>]
 */

import { resolve } from 'path';
import { findProjectRoot, loadProjectContext } from '../lib/config.js';
import { createHostedRunner } from '../lib/api/hosted-runner.js';

export async function serveCommand(opts) {
  const rootHint = opts.project || process.cwd();
  const root = findProjectRoot(resolve(rootHint));

  if (!root) {
    process.stderr.write(
      `[agentxchain serve] Error: no agentxchain.json found at or above ${rootHint}\n`
    );
    process.exitCode = 1;
    return;
  }

  const ctx = loadProjectContext(root);
  if (!ctx || !ctx.config) {
    process.stderr.write(
      `[agentxchain serve] Error: failed to load project configuration from ${root}\n`
    );
    process.exitCode = 1;
    return;
  }

  const port = parseInt(opts.port || '4100', 10);
  const host = opts.host || '127.0.0.1';

  const runner = createHostedRunner({
    root,
    config: ctx.config,
    port,
    host,
  });

  await runner.start();
  process.stderr.write(`[agentxchain serve] Hosted runner listening on http://${host}:${port}\n`);

  const shutdown = async () => {
    process.stderr.write('[agentxchain serve] Shutting down...\n');
    await runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
