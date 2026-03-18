import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { deleteAgent, stopAgent, loadSession } from '../adapters/cursor.js';

const SESSION_FILE = '.agentxchain-session.json';

export async function stopCommand() {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root } = result;
  const session = loadSession(root);

  if (!session) {
    console.log(chalk.yellow('  No active session found.'));
    console.log(chalk.dim('  If agents are running, stop them manually.'));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  Stopping ${session.launched.length} agents (${session.ide})`));
  console.log('');

  if (session.ide === 'cursor') {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      console.log(chalk.yellow('  CURSOR_API_KEY not set. Cannot stop agents via API.'));
      console.log(chalk.dim('  Stop them manually at cursor.com/agents'));
    } else {
      for (const agent of session.launched) {
        try {
          const deleted = await deleteAgent(apiKey, agent.cloudId);
          if (deleted) {
            console.log(chalk.green(`  ✓ Deleted ${chalk.bold(agent.id)} (${agent.cloudId})`));
          } else {
            console.log(chalk.yellow(`  ⚠ Could not delete ${agent.id} — may already be gone`));
          }
        } catch (err) {
          console.log(chalk.red(`  ✗ ${agent.id}: ${err.message}`));
        }
      }
    }
  } else if (session.ide === 'claude-code') {
    for (const agent of session.launched) {
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
  }

  // Remove session file
  const sessionPath = join(root, SESSION_FILE);
  if (existsSync(sessionPath)) unlinkSync(sessionPath);

  console.log('');
  console.log(chalk.dim('  Session file removed.'));
  console.log(chalk.green('  All agents stopped.'));
  console.log('');
}
