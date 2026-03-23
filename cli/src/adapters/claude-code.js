import { spawn } from 'child_process';
import chalk from 'chalk';
import { generateSeedPrompt } from '../lib/seed-prompt.js';
import { join } from 'path';
import { safeWriteJson } from '../lib/safe-write.js';
import { filterAgents } from '../lib/filter-agents.js';

export async function launchClaudeCodeAgents(config, root, opts) {
  const agents = filterAgents(config, opts.agent);
  const launched = [];

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);

    try {
      const child = spawn('claude', ['--system-prompt', prompt], {
        cwd: root,
        stdio: 'ignore',
        detached: true
      });
      child.unref();

      launched.push({ id, name: agent.name, pid: child.pid });
      console.log(chalk.green(`  ✓ Launched ${chalk.bold(id)} (${agent.name}) — PID: ${child.pid}`));
    } catch (err) {
      console.log(chalk.red(`  Failed to launch ${id}: ${err.message}`));
      console.log(chalk.dim(`  Make sure 'claude' CLI is installed and in your PATH.`));
    }
  }

  if (launched.length > 0) {
    safeWriteJson(join(root, '.agentxchain-session.json'), {
      launched,
      started_at: new Date().toISOString(),
      ide: 'claude-code'
    });
    console.log('');
    console.log(chalk.dim(`  Session saved to .agentxchain-session.json`));
  }

  return launched;
}
