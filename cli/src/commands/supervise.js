import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';

export async function superviseCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root } = result;

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const cliBin = join(currentDir, '../../bin/agentxchain.js');
  const runNudgeScript = join(currentDir, '../../scripts/run-autonudge.sh');
  const interval = Number(opts.interval || 3);

  if (opts.autonudge) {
    if (process.platform !== 'darwin') {
      console.log(chalk.red('  --autonudge currently supports macOS only.'));
      process.exit(1);
    }
    if (!existsSync(runNudgeScript)) {
      console.log(chalk.red(`  Auto-nudge script not found: ${runNudgeScript}`));
      process.exit(1);
    }
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Supervisor'));
  console.log(chalk.dim(`  Project: ${root}`));
  console.log(chalk.dim(`  Mode: ${opts.autonudge ? 'watch + auto-nudge' : 'watch only'}`));
  if (opts.autonudge) {
    console.log(chalk.dim(`  Auto-send: ${opts.send ? 'enabled' : 'disabled (paste-only)'}`));
    console.log(chalk.dim(`  Nudge poll: ${interval}s`));
  }
  console.log('');

  const children = [];

  const watchChild = spawn(process.execPath, [cliBin, 'watch'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, AGENTXCHAIN_WATCH_DAEMON: '0' }
  });
  children.push(watchChild);

  let nudgeChild = null;
  if (opts.autonudge) {
    const nudgeArgs = [runNudgeScript, '--project', root, '--interval', String(interval)];
    nudgeArgs.push(opts.send ? '--send' : '--paste-only');
    nudgeChild = spawn('bash', nudgeArgs, {
      cwd: root,
      stdio: 'inherit'
    });
    children.push(nudgeChild);
  }

  console.log(chalk.green(`  ✓ Watch PID: ${watchChild.pid}`));
  if (nudgeChild) console.log(chalk.green(`  ✓ Auto-nudge PID: ${nudgeChild.pid}`));
  console.log(chalk.dim('  Press Ctrl+C to stop supervisor and child processes.'));
  console.log('');

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch {}
      }
    }
    setTimeout(() => process.exit(0), 200);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  watchChild.on('exit', code => {
    if (!shuttingDown) {
      console.log('');
      console.log(chalk.red(`  Watch process exited unexpectedly (code ${code ?? 'unknown'}).`));
      shutdown();
    }
  });

  if (nudgeChild) {
    nudgeChild.on('exit', code => {
      if (!shuttingDown) {
        console.log('');
        console.log(chalk.red(`  Auto-nudge exited unexpectedly (code ${code ?? 'unknown'}).`));
        shutdown();
      }
    });
  }
}
