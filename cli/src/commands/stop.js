import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';

const SESSION_FILE = '.agentxchain-session.json';

export async function stopCommand() {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found.'));
    process.exit(1);
  }

  const { root } = result;
  const sessionPath = join(root, SESSION_FILE);

  if (!existsSync(sessionPath)) {
    console.log(chalk.yellow('  No active session found (.agentxchain-session.json missing).'));
    console.log(chalk.dim('  If agents are running, stop them manually in the IDE.'));
    return;
  }

  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  console.log('');
  console.log(chalk.bold(`  Stopping ${session.launched.length} agents (${session.ide})`));
  console.log('');

  switch (session.ide) {
    case 'cursor':
      await stopCursorAgents(session);
      break;
    case 'claude-code':
      stopClaudeCodeAgents(session);
      break;
    default:
      console.log(chalk.yellow(`  IDE "${session.ide}" — manual stop required.`));
  }

  unlinkSync(sessionPath);
  console.log('');
  console.log(chalk.dim('  Session file removed.'));
  console.log(chalk.green('  All agents stopped.'));
  console.log('');
}

async function stopCursorAgents(session) {
  const apiKey = process.env.CURSOR_API_KEY;

  for (const agent of session.launched) {
    if (agent.cloudId && apiKey) {
      try {
        const res = await fetch(`https://api.cursor.com/v0/agents/${agent.cloudId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Basic ${btoa(apiKey + ':')}` }
        });
        if (res.ok) {
          console.log(chalk.green(`  ✓ Stopped ${agent.id} (cloud ID: ${agent.cloudId})`));
        } else {
          console.log(chalk.yellow(`  ⚠ Could not stop ${agent.id}: ${res.status}`));
        }
      } catch (err) {
        console.log(chalk.red(`  ✗ Error stopping ${agent.id}: ${err.message}`));
      }
    } else {
      console.log(chalk.dim(`  ${agent.id} — no cloud ID or API key; stop manually in Cursor.`));
    }
  }
}

function stopClaudeCodeAgents(session) {
  for (const agent of session.launched) {
    if (agent.pid) {
      try {
        process.kill(agent.pid, 'SIGTERM');
        console.log(chalk.green(`  ✓ Sent SIGTERM to ${agent.id} (PID: ${agent.pid})`));
      } catch (err) {
        if (err.code === 'ESRCH') {
          console.log(chalk.dim(`  ${agent.id} (PID: ${agent.pid}) — already stopped.`));
        } else {
          console.log(chalk.red(`  ✗ Error stopping ${agent.id}: ${err.message}`));
        }
      }
    }
  }
}
