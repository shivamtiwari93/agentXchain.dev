import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { generateSeedPrompt } from '../lib/seed-prompt.js';

export async function startCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const agentIds = Object.keys(config.agents || {});
  const agentCount = agentIds.length;
  const ide = opts.ide;

  if (agentCount === 0) {
    console.log(chalk.red('  No agents configured in agentxchain.json.'));
    console.log(chalk.dim('  Add an agent with: agentxchain config --add-agent'));
    process.exit(1);
  }

  if (opts.agent && !config.agents?.[opts.agent]) {
    console.log(chalk.red(`  Agent "${opts.agent}" not found in agentxchain.json.`));
    console.log(chalk.dim(`  Available: ${agentIds.join(', ')}`));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold(`  ${agentCount} agents configured for ${config.project}`));
  console.log('');

  if (opts.dryRun) {
    console.log(chalk.yellow('  DRY RUN — showing agents:'));
    console.log('');
    for (const [id, agent] of Object.entries(config.agents)) {
      if (opts.agent && opts.agent !== id) continue;
      console.log(`    ${chalk.cyan(id)} — ${agent.name}`);
      console.log(chalk.dim(`    ${agent.mandate.slice(0, 80)}...`));
      console.log('');
    }
    return;
  }

  switch (ide) {
    case 'vscode': {
      console.log(chalk.green('  Agents are set up as VS Code custom agents.'));
      console.log('');
      console.log(chalk.dim('  Your agents in .github/agents/:'));
      for (const [id, agent] of Object.entries(config.agents)) {
        console.log(`    ${chalk.cyan(id)}.agent.md — ${agent.name}`);
      }
      console.log('');
      console.log(`  ${chalk.bold('How to use:')}`);
      console.log(`    1. Open this project in VS Code / Cursor`);
      console.log(`    2. Open Chat (${chalk.bold('Cmd+L')})`);
      console.log(`    3. Select an agent from the Chat dropdown`);
      console.log(`    4. Run ${chalk.bold('agentxchain release')} to release the human lock`);
      console.log(`    5. Agents coordinate via hooks — Stop hook hands off automatically`);
      console.log('');
      console.log(chalk.dim('  If agents don\'t appear, run: agentxchain generate'));
      console.log('');
      break;
    }
    case 'claude-code': {
      const { launchClaudeCodeAgents } = await import('../adapters/claude-code.js');
      await launchClaudeCodeAgents(config, root, opts);
      break;
    }
    default:
      console.log(chalk.red(`  Unknown IDE: ${ide}. Supported: vscode, claude-code`));
      process.exit(1);
  }
}
