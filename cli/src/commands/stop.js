import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';

const SESSION_FILE = '.agentxchain-session.json';

export async function stopCommand() {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root } = result;
  const sessionPath = join(root, SESSION_FILE);

  if (!existsSync(sessionPath)) {
    console.log(chalk.yellow('  No active session found.'));
    console.log(chalk.dim('  If agents are running in VS Code / Cursor, close their chat sessions manually.'));
    return;
  }

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
}
