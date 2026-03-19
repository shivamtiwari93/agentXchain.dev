import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { generateVSCodeFiles } from '../lib/generate-vscode.js';

export async function generateCommand() {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const agentIds = Object.keys(config.agents || {});

  if (agentIds.length === 0) {
    console.log(chalk.red('  No agents configured in agentxchain.json.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('  Generating VS Code agent files...'));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log('');

  const vsResult = generateVSCodeFiles(root, config);

  console.log(chalk.green(`  ✓ Generated ${vsResult.agentCount} agent files`));
  console.log('');

  for (const id of agentIds) {
    const name = config.agents[id].name;
    console.log(`    ${chalk.cyan(id)}.agent.md — ${name}`);
  }

  console.log('');
  console.log(chalk.dim('  Files written:'));
  console.log(`    .github/agents/  ${chalk.dim(`(${vsResult.agentCount} .agent.md files)`)}`);
  console.log(`    .github/hooks/   ${chalk.dim('agentxchain.json')}`);
  console.log(`    scripts/         ${chalk.dim('session-start, stop, pre-tool hooks')}`);
  console.log('');
  console.log(chalk.dim('  VS Code will auto-discover agents from .github/agents/.'));
  console.log(chalk.dim('  Select an agent from the Chat dropdown to start a turn.'));
  console.log('');
}
