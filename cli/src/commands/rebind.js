import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { generatePollingPrompt } from '../lib/seed-prompt-polling.js';

export async function rebindCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const agentEntries = Object.entries(config.agents || {});
  if (agentEntries.length === 0) {
    console.log(chalk.red('No agents configured in agentxchain.json.'));
    process.exit(1);
  }

  const selected = opts.agent
    ? agentEntries.filter(([id]) => id === opts.agent)
    : agentEntries;

  if (opts.agent && selected.length === 0) {
    console.log(chalk.red(`Agent "${opts.agent}" not found in agentxchain.json.`));
    process.exit(1);
  }

  const promptDir = join(root, '.agentxchain-prompts');
  const workspacesDir = join(root, '.agentxchain-workspaces');
  mkdirSync(promptDir, { recursive: true });
  mkdirSync(workspacesDir, { recursive: true });

  for (const [id, def] of selected) {
    const prompt = generatePollingPrompt(id, def, config, root);
    writeFileSync(join(promptDir, `${id}.prompt.md`), prompt);

    const wsPath = join(workspacesDir, `${id}.code-workspace`);
    const workspaceJson = {
      folders: [{ path: root }],
      settings: { 'agentxchain.agentId': id }
    };
    writeFileSync(wsPath, JSON.stringify(workspaceJson, null, 2) + '\n');

    if (opts.open) {
      openCursorWindow(wsPath);
    }
  }

  const statePath = join(root, '.agentxchain-autonudge.state');
  if (existsSync(statePath)) {
    rmSync(statePath, { force: true });
  }

  console.log('');
  console.log(chalk.green(`  ✓ Rebound ${selected.length} agent session(s).`));
  console.log(chalk.dim(`  Prompts:     ${join('.agentxchain-prompts', opts.agent ? `${opts.agent}.prompt.md` : '')}`));
  console.log(chalk.dim(`  Workspaces:  ${join('.agentxchain-workspaces', opts.agent ? `${opts.agent}.code-workspace` : '')}`));
  console.log(chalk.dim('  Auto-nudge dispatch state reset.'));
  if (!opts.open) {
    console.log(chalk.dim('  Use `agentxchain rebind --open` to reopen agent windows now.'));
  }
  console.log('');
}

function openCursorWindow(targetPath) {
  try {
    if (process.platform === 'darwin') {
      execSync(`open -na "Cursor" --args "${targetPath}"`, { stdio: 'ignore' });
      return;
    }
    execSync(`cursor --new-window "${targetPath}"`, { stdio: 'ignore' });
  } catch {}
}

