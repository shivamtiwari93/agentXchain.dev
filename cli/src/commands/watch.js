import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';
import { notifyHuman as sendNotification } from '../lib/notify.js';

export async function watchCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const interval = config.rules?.watch_interval_ms || 5000;
  const ttlMinutes = config.rules?.ttl_minutes || 10;
  const agentIds = Object.keys(config.agents);

  console.log('');
  console.log(chalk.bold('  AgentXchain Watch'));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log(chalk.dim(`  Agents:  ${agentIds.join(', ')}`));
  console.log(chalk.dim(`  Poll:    ${interval}ms`));
  console.log(chalk.dim(`  TTL:     ${ttlMinutes}min`));
  console.log('');
  console.log(chalk.cyan('  Watching lock.json... (Ctrl+C to stop)'));
  console.log('');

  let lastState = null;

  const tick = () => {
    try {
      const lock = loadLock(root);
      if (!lock) {
        log('warn', 'lock.json not found');
        return;
      }

      const stateKey = `${lock.holder}:${lock.turn_number}`;

      // Detect stale lock (TTL)
      if (lock.holder && lock.holder !== 'human' && lock.claimed_at) {
        const elapsed = Date.now() - new Date(lock.claimed_at).getTime();
        const ttlMs = ttlMinutes * 60 * 1000;

        if (elapsed > ttlMs) {
          const staleAgent = lock.holder;
          const minutes = Math.round(elapsed / 60000);
          log('ttl', `Lock held by ${staleAgent} for ${minutes}min (TTL: ${ttlMinutes}min). Force-releasing.`);

          forceRelease(root, lock, staleAgent, config);
          return;
        }
      }

      // Detect human holder
      if (lock.holder === 'human') {
        if (stateKey !== lastState) {
          log('human', 'Lock held by HUMAN. Waiting for `agentxchain release`...');
          lastState = stateKey;
          notifyHuman(root, config);
        }
        return;
      }

      // Lock is claimed by an agent — they're working
      if (lock.holder) {
        if (stateKey !== lastState) {
          const name = config.agents[lock.holder]?.name || lock.holder;
          log('claimed', `${lock.holder} (${name}) is working... (turn ${lock.turn_number})`);
          lastState = stateKey;
        }
        return;
      }

      // Lock is FREE — pick the next agent
      if (stateKey !== lastState) {
        const next = pickNextAgent(lock, config);
        log('free', `Lock released by ${lock.last_released_by || 'none'}. Next up: ${chalk.bold(next)}`);
        lastState = stateKey;

        writeTrigger(root, next, lock, config);
      }
    } catch (err) {
      log('error', err.message);
    }
  };

  tick();
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
  const maxConsecutive = config.rules?.max_consecutive_claims || 2;
  const lastAgent = lock.last_released_by;

  if (!lastAgent) return agentIds[0];

  const lastIndex = agentIds.indexOf(lastAgent);

  // Round-robin from the agent after the last one
  // but skip if max_consecutive_claims would be violated
  for (let i = 1; i <= agentIds.length; i++) {
    const candidate = agentIds[(lastIndex + i) % agentIds.length];
    return candidate;
  }

  return agentIds[0];
}

function forceRelease(root, lock, staleAgent, config) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: null,
    last_released_by: `system:ttl-expired:${staleAgent}`,
    turn_number: lock.turn_number,
    claimed_at: null
  };
  writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    const warning = `\n---\n\n### [system] (AgentXchain Watch) | Turn ${lock.turn_number}\n\n**Warning:** Lock held by \`${staleAgent}\` was force-released after TTL expired. The agent may have crashed or hung.\n\n`;
    appendFileSync(logPath, warning);
  }
}

function writeTrigger(root, agentId, lock, config) {
  const triggerPath = join(root, '.agentxchain-trigger.json');
  const trigger = {
    agent: agentId,
    turn_number: lock.turn_number,
    triggered_at: new Date().toISOString(),
    project: config.project
  };
  writeFileSync(triggerPath, JSON.stringify(trigger, null, 2) + '\n');
}

function notifyHuman(root, config) {
  sendNotification('An agent needs your help. Run: agentxchain release');
}

function log(type, msg) {
  const time = new Date().toLocaleTimeString();
  const prefix = {
    free: chalk.green('FREE'),
    claimed: chalk.yellow('WORK'),
    ttl: chalk.red(' TTL'),
    human: chalk.magenta('HUMAN'),
    warn: chalk.yellow('WARN'),
    error: chalk.red('ERR '),
    stop: chalk.dim('STOP'),
  }[type] || chalk.dim(type);

  console.log(`  ${chalk.dim(time)} ${prefix}  ${msg}`);
}
