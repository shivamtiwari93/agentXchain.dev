import { readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';
import { recordEvent } from '../lib/intake.js';
import { normalizeWatchEvent } from '../lib/watch-events.js';
import { safeWriteJson } from '../lib/safe-write.js';
import { notifyHuman as sendNotification } from '../lib/notify.js';
import { validateProject } from '../lib/validation.js';
import { resolveNextAgent, resolveExpectedClaimer } from '../lib/next-owner.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

const PID_FILE = '.agentxchain-watch.pid';

export async function watchCommand(opts) {
  if (opts.eventFile) {
    await ingestWatchEvent(opts);
    return;
  }

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
  writePidFile(root);

  console.log(chalk.cyan('  Watching lock.json... (Ctrl+C to stop)'));
  console.log(chalk.dim('  Note: In VS Code/Cursor, the Stop hook coordinates turns automatically.'));
  console.log(chalk.dim('  This watch process is a fallback for non-IDE environments.'));
  console.log('');

  let lastState = null;
  let lastClaimedState = null;

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
        // Validate claim ownership only once per new claimed state.
        // With handoff-driven routing, TALK.md may change during an active turn.
        // Re-validating every tick can produce false "illegal claim" alerts.
        if (stateKey !== lastClaimedState && lock.holder !== 'human') {
          const expected = pickNextAgent(root, lock, config);
          if (!isValidClaimer(root, lock, config)) {
            log('warn', `Illegal claim detected: holder=${lock.holder}, expected=${expected ?? 'none'}. Handing lock to HUMAN.`);
            blockOnIllegalClaim(root, lock, config, expected);
            sendNotification(`Illegal claim detected (${lock.holder}). Human intervention required.`);
            lastState = null;
            lastClaimedState = null;
            return;
          }
        }

        if (stateKey !== lastState) {
          const name = config.agents[lock.holder]?.name || lock.holder;
          log('claimed', `${lock.holder} (${name}) working... (turn ${lock.turn_number})`);
          lastState = stateKey;
        }
        lastClaimedState = stateKey;
        return;
      }

      if (stateKey !== lastState) {
        if (lock.last_released_by && config.agents?.[lock.last_released_by]) {
          const validation = validateProject(root, config, {
            mode: 'turn',
            expectedAgent: lock.last_released_by
          });
          if (!validation.ok) {
            log('warn', `Validation failed after ${lock.last_released_by}. Handing lock to HUMAN.`);
            blockOnValidation(root, lock, config, validation);
            sendNotification('Validation failed. Human action required: run agentxchain validate.');
            lastState = null;
            return;
          }
        }

        const resolved = resolveNextAgent(root, config, lock);
        const next = resolved.next;
        if (!next) {
          log('warn', `No next owner (${resolved.source}). strict_next_owner requires TALK.md handoff. Handing lock to HUMAN.`);
          blockOnMissingNext(root, lock, config, resolved.source);
          sendNotification('No next owner in TALK.md. Human action required.');
          lastState = null;
          return;
        }
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

  const cleanup = () => {
    clearInterval(timer);
    removePidFile(root);
    console.log('');
    log('stop', 'Watch stopped.');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function ingestWatchEvent(opts) {
  if (opts.daemon) {
    const message = '--daemon cannot be combined with --event-file';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.log(chalk.red(`  ${message}`));
    }
    process.exit(1);
  }

  const root = requireIntakeWorkspaceOrExit(opts);
  let raw;
  let parsed;
  try {
    raw = readFileSync(opts.eventFile, 'utf8');
  } catch (err) {
    const message = `failed to read event file: ${err.message}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.log(chalk.red(`  ${message}`));
    }
    process.exit(1);
  }

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = `event file is not valid JSON: ${err.message}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.log(chalk.red(`  ${message}`));
    }
    process.exit(1);
  }

  let payload;
  try {
    payload = normalizeWatchEvent(parsed);
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.log(chalk.red(`  ${err.message}`));
    }
    process.exit(1);
  }

  if (opts.dryRun) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, dry_run: true, payload }, null, 2));
    } else {
      console.log('');
      console.log(chalk.green('  Watch event normalized (dry run)'));
      console.log(JSON.stringify(payload, null, 2));
      console.log('');
    }
    process.exit(0);
  }

  const result = recordEvent(root, payload);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    if (result.deduplicated) {
      console.log(chalk.yellow(`  Watch event already recorded: ${result.event.event_id} (deduplicated)`));
      if (result.intent) {
        console.log(chalk.dim(`  Linked intent: ${result.intent.intent_id} (${result.intent.status})`));
      }
    } else {
      console.log(chalk.green(`  Recorded watch event ${result.event.event_id}`));
      console.log(chalk.green(`  Created intent ${result.intent.intent_id} (detected)`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }
  process.exit(result.exitCode);
}

function pickNextAgent(root, lock, config) {
  return resolveNextAgent(root, config, lock).next;
}

function isValidClaimer(root, lock, config) {
  if (!lock.holder || lock.holder === 'human') return true;
  if (!config.agents?.[lock.holder]) return false;
  const expected = resolveExpectedClaimer(root, config, lock).next;
  return lock.holder === expected;
}

function forceRelease(root, lock, staleAgent, config) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: null,
    last_released_by: `system:ttl:${staleAgent}`,
    turn_number: lock.turn_number + 1,
    claimed_at: null
  };
  safeWriteJson(lockPath, newLock);

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    appendFileSync(logPath, `\n---\n\n### [system] (Watch) | Turn ${lock.turn_number}\n\n**Warning:** Lock force-released from \`${staleAgent}\` (TTL expired).\n\n`);
  }
}

function writeTrigger(root, agentId, lock, config) {
  if (!agentId) return;
  const triggerPath = join(root, '.agentxchain-trigger.json');
  safeWriteJson(triggerPath, {
    agent: agentId,
    turn_number: lock.turn_number,
    triggered_at: new Date().toISOString(),
    project: config.project
  });
}

function blockOnValidation(root, lock, config, validation) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: 'human',
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  safeWriteJson(lockPath, newLock);

  const statePath = join(root, 'state.json');
  if (existsSync(statePath)) {
    try {
      const current = JSON.parse(readFileSync(statePath, 'utf8'));
      const message = validation.errors[0] || 'Validation failed';
      const nextState = {
        ...current,
        blocked: true,
        blocked_on: `validation: ${message}`
      };
      safeWriteJson(statePath, nextState);
    } catch {}
  }

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    const summary = validation.errors.map(e => `- ${e}`).join('\n');
    appendFileSync(
      logPath,
      `\n---\n\n### [system] (Watch Validation) | Turn ${lock.turn_number}\n\n**Status:** Validation failed after ${lock.last_released_by}.\n\n**Action:** Lock assigned to human for intervention.\n\n**Errors:**\n${summary}\n\n`
    );
  }
}

function blockOnMissingNext(root, lock, config, source) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: 'human',
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  safeWriteJson(lockPath, newLock);

  const statePath = join(root, 'state.json');
  if (existsSync(statePath)) {
    try {
      const current = JSON.parse(readFileSync(statePath, 'utf8'));
      const nextState = {
        ...current,
        blocked: true,
        blocked_on: `missing-next-owner: ${source}`
      };
      safeWriteJson(statePath, nextState);
    } catch {}
  }

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    appendFileSync(
      logPath,
      `\n---\n\n### [system] (Watch) | Turn ${lock.turn_number}\n\n**Status:** Could not resolve next agent (${source}).\n\n**Action:** Add \`Next owner: <agent_id>\` to ${config.talk_file || 'TALK.md'}, or set \`rules.strict_next_owner\` to false for cyclic fallback.\n\n`
    );
  }
}

function blockOnIllegalClaim(root, lock, config, expected) {
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: 'human',
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  safeWriteJson(lockPath, newLock);

  const statePath = join(root, 'state.json');
  if (existsSync(statePath)) {
    try {
      const current = JSON.parse(readFileSync(statePath, 'utf8'));
      const nextState = {
        ...current,
        blocked: true,
        blocked_on: `illegal-claim: expected ${expected}, got ${lock.holder}`
      };
      safeWriteJson(statePath, nextState);
    } catch {}
  }

  const logFile = config.log || 'log.md';
  const logPath = join(root, logFile);
  if (existsSync(logPath)) {
    appendFileSync(
      logPath,
      `\n---\n\n### [system] (Watch Guard) | Turn ${lock.turn_number}\n\n**Status:** Illegal out-of-turn lock claim detected.\n\n**Action:** Lock assigned to human for intervention.\n\n**Details:** expected \`${expected}\`, got \`${lock.holder}\`.\n\n`
    );
  }
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

  const result = loadConfig();
  if (result) {
    writeFileSync(join(result.root, PID_FILE), String(child.pid));
  }

  console.log('');
  console.log(chalk.green(`  ✓ Watch started in daemon mode (PID: ${child.pid})`));
  console.log(chalk.dim('  Use `agentxchain stop` or kill the PID to stop it.'));
  console.log('');
}

function writePidFile(root) {
  try {
    writeFileSync(join(root, PID_FILE), String(process.pid));
  } catch {}
}

function removePidFile(root) {
  try {
    const pidPath = join(root, PID_FILE);
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch {}
}

export function getWatchPid(root) {
  try {
    const pidPath = join(root, PID_FILE);
    if (!existsSync(pidPath)) return null;
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
