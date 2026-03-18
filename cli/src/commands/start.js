import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { generateSeedPrompt } from '../lib/seed-prompt.js';
import { getCursorApiKey, printCursorApiKeyRequired } from '../lib/cursor-api-key.js';

export async function startCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const agentCount = Object.keys(config.agents).length;
  const ide = opts.ide;

  console.log('');
  console.log(chalk.bold(`  Launching ${agentCount} agents via ${ide}`));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log('');

  if (opts.dryRun) {
    console.log(chalk.yellow('  DRY RUN — showing what would be launched:'));
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
    case 'cursor': {
      const apiKey = getCursorApiKey(root);
      if (!apiKey) {
        printCursorApiKeyRequired('`agentxchain start --ide cursor`');
        process.exit(1);
      }
      const { launchCursorAgents } = await import('../adapters/cursor.js');
      await launchCursorAgents(config, root, opts);
      break;
    }
    case 'claude-code': {
      const { launchClaudeCodeAgents } = await import('../adapters/claude-code.js');
      await launchClaudeCodeAgents(config, root, opts);
      break;
    }
    case 'vscode': {
      console.log(chalk.yellow('  VS Code adapter coming soon.'));
      console.log(chalk.dim('  For now, use the seed prompts below in VS Code chat panels.'));
      console.log('');
      printPrompts(config, opts);
      break;
    }
    default:
      console.log(chalk.red(`  Unknown IDE: ${ide}. Supported: cursor, vscode, claude-code`));
      process.exit(1);
  }
}

function printPrompts(config, opts) {
  const agents = opts.agent
    ? { [opts.agent]: config.agents[opts.agent] }
    : config.agents;

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log(chalk.cyan(`  Agent: ${chalk.bold(id)} (${agent.name})`));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log('');
    console.log(prompt);
    console.log('');
  }
}
