import chalk from 'chalk';
import { generateSeedPrompt } from '../lib/seed-prompt.js';

const API_BASE = 'https://api.cursor.com/v0';

export async function launchCursorAgents(config, root, opts) {
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    console.log('');
    console.log(chalk.yellow('  Cursor Cloud Agents API key not found.'));
    console.log('');
    console.log('  To launch agents via Cursor Cloud API:');
    console.log(`    1. Go to ${chalk.cyan('cursor.com/dashboard')} → Cloud Agents`);
    console.log('    2. Create an API key');
    console.log(`    3. Set: ${chalk.bold('export CURSOR_API_KEY=your_key')}`);
    console.log(`    4. Run: ${chalk.bold('agentxchain start --ide cursor')}`);
    console.log('');
    console.log(chalk.dim('  Falling back to seed prompt output...'));
    console.log('');
    return fallbackPromptOutput(config, opts);
  }

  const agents = filterAgents(config, opts.agent);
  const launched = [];

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);

    try {
      const res = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(apiKey + ':')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          repository: root,
          name: `agentxchain-${id}`
        })
      });

      if (!res.ok) {
        const body = await res.text();
        console.log(chalk.red(`  Failed to launch ${id}: ${res.status} ${body}`));
        continue;
      }

      const data = await res.json();
      launched.push({ id, name: agent.name, cloudId: data.id || 'unknown' });
      console.log(chalk.green(`  ✓ Launched ${chalk.bold(id)} (${agent.name}) — cloud ID: ${data.id || '?'}`));
    } catch (err) {
      console.log(chalk.red(`  Failed to launch ${id}: ${err.message}`));
    }
  }

  if (launched.length > 0) {
    const sessionFile = JSON.stringify({ launched, started_at: new Date().toISOString(), ide: 'cursor' }, null, 2);
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');
    writeFileSync(join(root, '.agentxchain-session.json'), sessionFile + '\n');
    console.log('');
    console.log(chalk.dim(`  Session saved to .agentxchain-session.json`));
  }

  return launched;
}

function fallbackPromptOutput(config, opts) {
  const agents = filterAgents(config, opts.agent);

  console.log(chalk.bold('  Copy-paste these prompts into separate Cursor sessions:'));
  console.log('');

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log(chalk.cyan(`  Agent: ${chalk.bold(id)} (${agent.name})`));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log('');
    console.log(prompt);
    console.log('');
  }

  return [];
}

function filterAgents(config, specificId) {
  if (specificId) {
    if (!config.agents[specificId]) {
      console.log(chalk.red(`  Agent "${specificId}" not found in agentxchain.json`));
      process.exit(1);
    }
    return { [specificId]: config.agents[specificId] };
  }
  return config.agents;
}
