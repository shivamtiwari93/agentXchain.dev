import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, symlinkSync, lstatSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { generatePollingPrompt } from '../lib/seed-prompt-polling.js';

export async function launchCursorLocal(config, root, opts) {
  const agents = filterAgents(config, opts.agent);
  const agentEntries = Object.entries(agents);
  const total = agentEntries.length;

  console.log(chalk.bold(`  Setting up ${total} agents: ${Object.keys(agents).join(', ')}`));
  console.log('');

  const promptDir = join(root, '.agentxchain-prompts');
  mkdirSync(promptDir, { recursive: true });

  // Save all prompts first
  for (const [id, agent] of agentEntries) {
    const prompt = generatePollingPrompt(id, agent, config);
    writeFileSync(join(promptDir, `${id}.prompt.md`), prompt);
  }

  // Create per-agent symlinked workspace folders so Cursor opens separate windows
  const workspacesDir = join(root, '.agentxchain-workspaces');
  mkdirSync(workspacesDir, { recursive: true });

  for (let i = 0; i < agentEntries.length; i++) {
    const [id, agent] = agentEntries[i];
    const prompt = generatePollingPrompt(id, agent, config);

    // Create symlink: .agentxchain-workspaces/<id> -> project root
    const agentWorkspace = join(workspacesDir, id);
    try {
      if (existsSync(agentWorkspace)) {
        const stat = lstatSync(agentWorkspace);
        if (stat.isSymbolicLink()) unlinkSync(agentWorkspace);
      }
      if (!existsSync(agentWorkspace)) {
        symlinkSync(root, agentWorkspace, 'dir');
      }
    } catch {}

    console.log(chalk.cyan(`  ─── Agent ${i + 1}/${total}: ${chalk.bold(id)} — ${agent.name} ───`));
    console.log('');

    copyToClipboard(prompt);
    console.log(chalk.green(`  ✓ Prompt copied to clipboard.`));
    console.log(chalk.dim(`    Saved to: .agentxchain-prompts/${id}.prompt.md`));

    // Open a separate Cursor window using the symlinked path
    openCursorWindow(agentWorkspace);
    console.log(chalk.dim(`    Cursor window opened for ${id}.`));

    console.log('');
    console.log(`  ${chalk.bold('In the new Cursor window:')}`);
    console.log(`    1. Open chat (${chalk.bold('Cmd+L')})`);
    console.log(`    2. Paste the prompt (${chalk.bold('Cmd+V')})`);
    console.log(`    3. ${chalk.bold('Select Agent mode')} (not Ask/Edit)`);
    console.log(`    4. Send it (${chalk.bold('Enter')})`);

    if (i < agentEntries.length - 1) {
      console.log('');
      await inquirer.prompt([{
        type: 'input',
        name: 'ready',
        message: `  Done? Press Enter to open next window (${agentEntries[i + 1][0]})...`
      }]);
      console.log('');
    } else {
      console.log('');
      console.log(chalk.dim(`  Last agent. Paste and send, then come back here.`));
      console.log('');
    }
  }

  console.log(chalk.green(`  ✓ All ${total} agents launched in separate Cursor windows.`));
  console.log('');
  console.log(`  ${chalk.cyan('Now run:')}`);
  console.log(`    ${chalk.bold('agentxchain release')}  ${chalk.dim('# release human lock — agents start claiming turns')}`);
  console.log('');
  console.log(`  ${chalk.dim('Other commands:')}`);
  console.log(`    ${chalk.bold('agentxchain status')}   ${chalk.dim('# check who holds the lock')}`);
  console.log(`    ${chalk.bold('agentxchain claim')}    ${chalk.dim('# pause agents and take control')}`);
  console.log(`    ${chalk.bold('agentxchain watch')}    ${chalk.dim('# optional: TTL safety net')}`);
  console.log('');
  console.log(chalk.dim('  Agents self-coordinate via lock.json polling (sleep 60s between checks).'));
  console.log(chalk.dim('  Re-paste a prompt: cat .agentxchain-prompts/<agent>.prompt.md | pbcopy'));
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

function openCursorWindow(folderPath) {
  try {
    if (process.platform === 'darwin') {
      execSync(`open -na "Cursor" --args "${folderPath}"`, { stdio: 'ignore' });
      return;
    }
    execSync(`cursor --new-window "${folderPath}"`, { stdio: 'ignore' });
  } catch {}
}
