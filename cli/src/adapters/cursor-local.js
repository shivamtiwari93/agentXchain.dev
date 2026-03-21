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
  const selectedAgent = opts.agent ? agents[opts.agent] : null;
  const isPmKickoff = !!selectedAgent && isPmLike(opts.agent, selectedAgent) && !opts.remaining;

  console.log(chalk.bold(`  Setting up ${total} agents: ${Object.keys(agents).join(', ')}`));
  if (isPmKickoff) {
    console.log(chalk.dim('  PM kickoff mode: start with human-PM planning before launching the full team.'));
  }
  console.log('');

  const promptDir = join(root, '.agentxchain-prompts');
  mkdirSync(promptDir, { recursive: true });

  // Save all prompts first
  for (const [id, agent] of agentEntries) {
    const prompt = isPmKickoff
      ? generateKickoffPrompt(id, agent, config)
      : generatePollingPrompt(id, agent, config);
    writeFileSync(join(promptDir, `${id}.prompt.md`), prompt);
  }

  // Create per-agent symlinked workspace folders so Cursor opens separate windows
  const workspacesDir = join(root, '.agentxchain-workspaces');
  mkdirSync(workspacesDir, { recursive: true });

  for (let i = 0; i < agentEntries.length; i++) {
    const [id, agent] = agentEntries[i];
    const prompt = isPmKickoff
      ? generateKickoffPrompt(id, agent, config)
      : generatePollingPrompt(id, agent, config);

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
    if (isPmKickoff) {
      console.log(`    3. ${chalk.bold('Select Agent mode')} and discuss requirements with PM`);
      console.log(`    4. Update planning docs together (PROJECT / REQUIREMENTS / ROADMAP)`);
    } else {
      console.log(`    3. ${chalk.bold('Select Agent mode')} (not Ask/Edit)`);
      console.log(`    4. Send it (${chalk.bold('Enter')})`);
    }

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
  if (isPmKickoff) {
    console.log(`    ${chalk.bold('agentxchain start --remaining')} ${chalk.dim('# launch the rest of the team when PM plan is ready')}`);
    console.log(`    ${chalk.bold('agentxchain supervise --autonudge')} ${chalk.dim('# start watch + auto-nudge')}`);
    console.log(`    ${chalk.bold('agentxchain release')} ${chalk.dim('# release human lock to begin team turns')}`);
  } else {
    console.log(`    ${chalk.bold('agentxchain supervise --autonudge')} ${chalk.dim('# recommended: watch + auto-nudge in one command')}`);
    console.log(`    ${chalk.bold('agentxchain release')} ${chalk.dim('# release human lock — agents start claiming turns')}`);
  }
  console.log('');
  console.log(`  ${chalk.dim('Other commands:')}`);
  console.log(`    ${chalk.bold('agentxchain status')}   ${chalk.dim('# check who holds the lock')}`);
  console.log(`    ${chalk.bold('agentxchain claim')}    ${chalk.dim('# pause agents and take control')}`);
  console.log(`    ${chalk.bold('agentxchain watch')}    ${chalk.dim('# watcher / trigger writer')}`);
  console.log(`    ${chalk.bold('agentxchain doctor')}   ${chalk.dim('# check local setup + trigger health')}`);
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

function isPmLike(agentId, agentDef) {
  if (agentId === 'pm') return true;
  const name = String(agentDef?.name || '').toLowerCase();
  return name.includes('product manager');
}

function generateKickoffPrompt(agentId, agentDef, config) {
  return `You are "${agentId}" — ${agentDef.name}.

This is PM kickoff mode. Your job now is to collaborate with the human and finalize scope before autonomous turns begin.

Actions:
1) Read:
- .planning/PROJECT.md
- .planning/REQUIREMENTS.md
- .planning/ROADMAP.md
- state.md
- lock.json
2) Ask the human focused product questions until scope is clear:
- target user
- top pain point
- core workflow
- MVP boundary
- success metric
3) Update planning docs with concrete acceptance criteria and Get Shit Done structure:
- .planning/ROADMAP.md must define Waves and Phases.
- Create .planning/phases/phase-1/PLAN.md and TESTS.md.
4) Update .planning/PM_SIGNOFF.md:
- Set "Approved: YES" only when human agrees kickoff is complete.
5) Do NOT start round-robin agent handoffs yet.

Context:
- Project: ${config.project}
- Human currently holds lock.
- Once planning is approved, human will launch remaining agents and run release.`;
}
