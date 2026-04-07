import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { validateProject } from '../lib/validation.js';

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

  if (opts.agent && opts.remaining) {
    console.log(chalk.red('  --agent and --remaining cannot be used together.'));
    process.exit(1);
  }

  if (opts.remaining) {
    const kickoffValidation = validateProject(root, config, { mode: 'kickoff' });
    if (!kickoffValidation.ok) {
      console.log(chalk.red('  PM kickoff is incomplete. Cannot run --remaining yet.'));
      console.log(chalk.dim('  Fix these first:'));
      for (const e of kickoffValidation.errors) {
        console.log(chalk.dim(`   - ${e}`));
      }
      console.log('');
      console.log(chalk.dim('  Suggested next step: complete .planning/PM_SIGNOFF.md and roadmap waves/phases.'));
      console.log(chalk.dim('  Fresh governed scaffolds start at `Approved: NO`; flip that line to `Approved: YES` only after human kickoff approval, then run:'));
      console.log(chalk.bold('    agentxchain validate --mode kickoff'));
      console.log('');
      process.exit(1);
    }
  }

  const launchConfig = buildLaunchConfig(config, opts);
  const launchAgentIds = Object.keys(launchConfig.agents || {});
  const launchCount = launchAgentIds.length;

  if (launchCount === 0) {
    console.log(chalk.red('  No agents selected to launch.'));
    if (opts.remaining) {
      console.log(chalk.dim('  Tip: this usually means only PM exists.'));
    }
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold(`  ${agentCount} agents configured for ${config.project}`));
  if (opts.remaining) {
    console.log(chalk.cyan(`  Launch mode: remaining agents (${launchCount})`));
  } else if (opts.agent) {
    console.log(chalk.cyan(`  Launch mode: single agent (${opts.agent})`));
  }
  console.log('');

  if (opts.dryRun) {
    console.log(chalk.yellow('  DRY RUN — showing agents:'));
    console.log('');
    for (const [id, agent] of Object.entries(launchConfig.agents)) {
      console.log(`    ${chalk.cyan(id)} — ${agent.name}`);
      console.log(chalk.dim(`    ${agent.mandate.slice(0, 80)}...`));
      console.log('');
    }
    return;
  }

  if (!opts.agent && !opts.remaining) {
    const kickoffId = pickPmAgentId(config);
    if (kickoffId) {
      console.log(chalk.yellow(`  Tip: for first run, start with ${chalk.bold(`agentxchain start --agent ${kickoffId}`)}.`));
      console.log(chalk.dim('  Then use `agentxchain start --remaining` once PM planning is complete.'));
      console.log('');
    }
  }

  switch (ide) {
    case 'vscode': {
      console.log(chalk.green('  Agents are set up as VS Code custom agents.'));
      console.log('');
      console.log(chalk.dim('  Your agents in .github/agents/:'));
      for (const [id, agent] of Object.entries(launchConfig.agents)) {
        console.log(`    ${chalk.cyan(id)}.agent.md — ${agent.name}`);
      }
      console.log('');
      console.log(`  ${chalk.bold('How to use:')}`);
      console.log(`    1. Open project: ${chalk.bold('cursor .')} or ${chalk.bold('code .')}`);
      console.log(chalk.dim(`       (If "command not found": open IDE → Cmd+Shift+P → "Shell Command: Install")`));
      console.log(`    2. Open Chat (${chalk.bold('Cmd+L')})`);
      console.log(`    3. Select an agent from the Chat dropdown`);
      console.log(`    4. Run ${chalk.bold('agentxchain release')} to release the human lock`);
      console.log(`    5. Agents coordinate via hooks — Stop hook hands off automatically`);
      console.log('');
      console.log(chalk.dim('  If agents don\'t appear, run: agentxchain generate'));
      console.log('');
      break;
    }
    case 'cursor': {
      const { launchCursorLocal } = await import('../adapters/cursor-local.js');
      await launchCursorLocal(launchConfig, root, opts);
      break;
    }
    case 'claude-code': {
      const { launchClaudeCodeAgents } = await import('../adapters/claude-code.js');
      await launchClaudeCodeAgents(launchConfig, root, opts);
      break;
    }
    default:
      console.log(chalk.red(`  Unknown IDE: ${ide}. Supported: vscode, cursor, claude-code`));
      process.exit(1);
  }
}

function buildLaunchConfig(config, opts) {
  if (opts.agent) {
    return {
      ...config,
      agents: { [opts.agent]: config.agents[opts.agent] }
    };
  }

  if (opts.remaining) {
    const pmId = pickPmAgentId(config);
    const agents = { ...config.agents };

    if (pmId && agents[pmId]) {
      delete agents[pmId];
    } else {
      const firstId = Object.keys(agents)[0];
      if (firstId) delete agents[firstId];
    }

    return { ...config, agents };
  }

  return config;
}

function pickPmAgentId(config) {
  if (config.agents.pm) return 'pm';

  for (const [id, def] of Object.entries(config.agents || {})) {
    const name = String(def?.name || '').toLowerCase();
    if (name.includes('product manager')) return id;
  }
  return null;
}
