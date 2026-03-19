import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';
import { notifyHuman as sendNotification } from '../lib/notify.js';

export async function watchCommand(opts) {
  if (opts.daemon && process.env.AGENTXCHAIN_WATCH_DAEMON !== '1') {
    startWatchDaemon();
    return;
  }

  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const interval = config.rules?.watch_interval_ms || 5000;
  const ttlMinutes = config.rules?.ttl_minutes || 10;
  const agentIds = Object.keys(config.agents);

  if (agentIds.length === 0) {
    console.log(chalk.red('  No agents configured in agentxchain.json.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Watch'));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log(chalk.dim(`  Agents:  ${agentIds.join(', ')}`));
  console.log(chalk.dim(`  Poll:    ${interval}ms | TTL: ${ttlMinutes}min`));
  console.log(chalk.dim(`  Mode:    Local file watcher + trigger file`));
  console.log('');
  console.log(chalk.cyan('  Watching lock.json... (Ctrl+C to stop)'));
  console.log(chalk.dim('  Note: In VS Code/Cursor, the Stop hook coordinates turns automatically.'));
  console.log(chalk.dim('  This watch process is a fallback for non-IDE environments.'));
  console.log('');

  let lastState = null;

  const tick = async () => {
    try {
      const lock = loadLock(root);
      if (!lock) { log('warn', 'lock.json not found'); return; }

      const stateKey = `${lock.holder}:${lock.turn_number}`;

      if (lock.holder && lock.holder !== 'human' && lock.claimed_at) {
        const elapsed = Date.now() - new Date(lock.claimed_at).getTime();
        const ttlMs = ttlMinutes * 60 * 1000;

        if (elapsed > ttlMs) {
          const staleAgent = lock.holder;
          const minutes = Math.round(elapsed / 60000);
          log('ttl', `Lock held by ${staleAgent} for ${minutes}min. Force-releasing.`);
          forceRelease(root, lock, staleAgent, config);
          lastState = null;
          return;
        }
      }

      if (lock.holder === 'human') {
        if (stateKey !== lastState) {
          log('human', 'Lock held by HUMAN. Run `agentxchain release` when done.');
          sendNotification('An agent needs your help. Run: agentxchain release');
          lastState = stateKey;
        }
        return;
      }

      if (lock.holder) {
        if (stateKey !== lastState) {
          const name = config.agents[lock.holder]?.name || lock.holder;
          log('claimed', `${lock.holder} (${name}) working... (turn ${lock.turn_number})`);
          lastState = stateKey;
        }
        return;
      }

      if (stateKey !== lastState) {
        const next = pickNextAgent(lock, config);
        log('free', `Lock free (released by ${lock.last_released_by || 'none'}). Next: ${chalk.bold(next)}.`);
        writeTrigger(root, next, lock, config);
        lastState = stateKey;
      }
    } catch (err) {
      log('error', err.message);
    }
  };

  await tick();
  const timer = setInterval(tick, interval);

  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('');
    log('stop', 'Watch stopped.');
    process.exit(0);
  });
}

function pickNextAgent(lock, config) {
  const agentIds = Object.keys(config.agents);
  if (agentIds.length === 0) return null;
  const lastAgent = lock.last_released_by;

  if (!lastAgent || !agentIds.includes(lastAgent)) return agentIds[0];

  const lastIndex = agentIds.indexOf(lastAgent);
  return agentIds[(lastIndex + 1) % agentIds.length];
}

function forceRelease(root, lock, staleAgent, config) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: null,
    last_released_by: `system:ttl:${staleAgent}`,
    turn_number: lock.turn_number,
    claimed_at: null
  };
  writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    appendFileSync(logPath, `\n---\n\n### [system] (Watch) | Turn ${lock.turn_number}\n\n**Warning:** Lock force-released from \`${staleAgent}\` (TTL expired).\n\n`);
  }
}

function writeTrigger(root, agentId, lock, config) {
  if (!agentId) return;
  const triggerPath = join(root, '.agentxchain-trigger.json');
  writeFileSync(triggerPath, JSON.stringify({
    agent: agentId,
    turn_number: lock.turn_number,
    triggered_at: new Date().toISOString(),
    project: config.project
  }, null, 2) + '\n');
}

function log(type, msg) {
  const time = new Date().toLocaleTimeString();
  const tags = {
    free: chalk.green('FREE '),
    claimed: chalk.yellow('WORK '),
    ttl: chalk.red(' TTL '),
    human: chalk.magenta('HUMAN'),
    warn: chalk.yellow('WARN '),
    error: chalk.red('ERR  '),
    stop: chalk.dim('STOP '),
  };
  console.log(`  ${chalk.dim(time)} ${tags[type] || chalk.dim(type)}  ${msg}`);
}

function startWatchDaemon() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const cliBin = join(currentDir, '../../bin/agentxchain.js');
  const child = spawn(process.execPath, [cliBin, 'watch'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AGENTXCHAIN_WATCH_DAEMON: '1' }
  });
  child.unref();

  console.log('');
  console.log(chalk.green(`  ✓ Watch started in daemon mode (PID: ${child.pid})`));
  console.log(chalk.dim('  Use `agentxchain stop` or kill the PID to stop it.'));
  console.log('');
}
