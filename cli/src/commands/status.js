import chalk from 'chalk';
import { loadConfig, loadLock, loadState } from '../lib/config.js';
import { getAgentStatus, loadSession } from '../adapters/cursor.js';

export async function statusCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const lock = loadLock(root);
  const state = loadState(root);

  if (opts.json) {
    console.log(JSON.stringify({ config, lock, state }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  console.log(`  ${chalk.dim('Project:')}  ${config.project}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state ? formatPhase(state.phase) : chalk.dim('unknown')}`);
  if (state?.blocked) {
    console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red('YES')} — ${state.blocked_on || 'unknown reason'}`);
  }
  console.log('');

  // Lock
  if (lock) {
    if (lock.holder === 'human') {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.magenta('HUMAN')} — you hold the lock`);
    } else if (lock.holder) {
      const agentName = config.agents[lock.holder]?.name || lock.holder;
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.yellow('CLAIMED')} by ${chalk.bold(lock.holder)} (${agentName})`);
      if (lock.claimed_at) {
        console.log(`  ${chalk.dim('Claimed:')}  ${timeSince(lock.claimed_at)} ago`);
      }
    } else {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.green('FREE')} — any agent can claim`);
    }
    console.log(`  ${chalk.dim('Turn:')}     ${lock.turn_number}`);
    if (lock.last_released_by) {
      console.log(`  ${chalk.dim('Last:')}     ${lock.last_released_by}`);
    }
  }
  console.log('');

  // Cursor session info
  const session = loadSession(root);
  const apiKey = process.env.CURSOR_API_KEY;
  const hasCursor = session?.ide === 'cursor' && session?.launched?.length > 0;

  if (hasCursor) {
    console.log(`  ${chalk.dim('Cursor:')}   ${chalk.cyan('Active session')} (${session.launched.length} agents)`);
    console.log(`  ${chalk.dim('Started:')}  ${session.started_at}`);
    if (session.repo) console.log(`  ${chalk.dim('Repo:')}     ${session.repo}`);
    console.log('');
  }

  // Agents
  console.log(`  ${chalk.dim('Agents:')}   ${Object.keys(config.agents).length}`);

  for (const [id, agent] of Object.entries(config.agents)) {
    const isHolder = lock?.holder === id;
    const marker = isHolder ? chalk.yellow('●') : chalk.dim('○');
    const label = isHolder ? chalk.bold(id) : id;

    let cursorStatus = '';
    if (hasCursor && apiKey) {
      const cloudAgent = session.launched.find(a => a.id === id);
      if (cloudAgent) {
        try {
          const statusData = await getAgentStatus(apiKey, cloudAgent.cloudId);
          if (statusData?.status) {
            cursorStatus = ` ${formatCursorStatus(statusData.status)}`;
          }
        } catch {
          cursorStatus = chalk.dim(' [API error]');
        }
      }
    }

    console.log(`    ${marker} ${label} — ${agent.name}${cursorStatus}`);
  }

  if (lock?.holder === 'human') {
    console.log(`    ${chalk.magenta('●')} ${chalk.bold('human')} — You`);
  }

  console.log('');
}

function formatPhase(phase) {
  const colors = { discovery: chalk.blue, build: chalk.green, qa: chalk.yellow, deploy: chalk.magenta, blocked: chalk.red };
  return (colors[phase] || chalk.white)(phase);
}

function formatCursorStatus(status) {
  const map = {
    CREATING: chalk.dim('[creating]'),
    RUNNING: chalk.cyan('[running]'),
    FINISHED: chalk.green('[finished]'),
    STOPPED: chalk.yellow('[stopped]'),
    ERRORED: chalk.red('[errored]'),
  };
  return map[status] || chalk.dim(`[${status}]`);
}

function timeSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
