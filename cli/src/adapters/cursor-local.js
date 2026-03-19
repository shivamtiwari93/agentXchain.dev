import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { generatePollingPrompt } from '../lib/seed-prompt-polling.js';

export async function launchCursorLocal(config, root, opts) {
  const agents = filterAgents(config, opts.agent);
  const agentEntries = Object.entries(agents);
  const total = agentEntries.length;

  console.log(chalk.bold(`  Opening ${total} Cursor windows for: ${Object.keys(agents).join(', ')}`));
  console.log('');

  const promptDir = join(root, '.agentxchain-prompts');
  try { execSync(`mkdir -p "${promptDir}"`); } catch {}

  for (let i = 0; i < agentEntries.length; i++) {
    const [id, agent] = agentEntries[i];
    const prompt = generatePollingPrompt(id, agent, config);
    const promptFile = join(promptDir, `${id}.prompt.md`);
    writeFileSync(promptFile, prompt);

    console.log(`  ${chalk.cyan(`Window ${i + 1}/${total}:`)} ${chalk.bold(id)} — ${agent.name}`);

    copyToClipboard(prompt);
    console.log(chalk.green(`    Prompt copied to clipboard.`));
    console.log(chalk.dim(`    Also saved to: .agentxchain-prompts/${id}.prompt.md`));

    tryOpenCursor(root);

    if (i < agentEntries.length - 1) {
      console.log('');
      await inquirer.prompt([{
        type: 'input',
        name: 'ready',
        message: chalk.dim(`    Paste prompt in Cursor chat (Cmd+V), send it, then press Enter here for the next agent...`)
      }]);
    } else {
      console.log('');
      console.log(chalk.dim(`    Paste this last prompt in Cursor chat (Cmd+V) and send it.`));
    }
  }

  console.log('');
  console.log(chalk.green('  All agent prompts ready.'));
  console.log('');
  console.log(`  ${chalk.cyan('Next:')}`);
  console.log(`    ${chalk.bold('agentxchain release')}  ${chalk.dim('# release human lock — agents start claiming turns')}`);
  console.log(`    ${chalk.bold('agentxchain watch')}    ${chalk.dim('# optional: TTL safety net + status logging')}`);
  console.log(`    ${chalk.bold('agentxchain status')}   ${chalk.dim('# check who holds the lock')}`);
  console.log(`    ${chalk.bold('agentxchain claim')}    ${chalk.dim('# pause agents and take control')}`);
  console.log('');
  console.log(chalk.dim('  Agents self-coordinate via lock.json polling (sleep 60s between checks).'));
  console.log(chalk.dim('  Prompts saved in .agentxchain-prompts/ if you need to re-paste.'));
  console.log('');
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

function copyToClipboard(text) {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text, encoding: 'utf8' });
      return true;
    }
    if (process.platform === 'linux') {
      execSync('xclip -selection clipboard', { input: text, encoding: 'utf8' });
      return true;
    }
  } catch {}
  return false;
}

function tryOpenCursor(root) {
  try {
    if (process.platform === 'darwin') {
      execSync(`open -na "Cursor" --args "${root}"`, { stdio: 'ignore' });
      return;
    }
    execSync(`cursor "${root}"`, { stdio: 'ignore' });
  } catch {
    // Cursor not found or can't open — user will open manually
  }
}
