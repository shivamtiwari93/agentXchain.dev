import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock } from '../lib/config.js';
import { validateProject } from '../lib/validation.js';

export async function doctorCommand() {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const lock = loadLock(root);
  const checks = [];

  checks.push(checkFile('agentxchain.json', existsSync(join(root, 'agentxchain.json')), 'Project config exists'));
  checks.push(checkFile('lock.json', !!lock, 'Lock file exists'));
  checks.push(checkBinary('cursor', 'Cursor CLI available (optional for non-macOS launch)'));
  checks.push(checkBinary('jq', 'jq installed (required for auto-nudge)'));
  checks.push(checkBinary('osascript', 'osascript available (required for auto-nudge, macOS)'));
  checks.push(checkPm(config));
  checks.push(checkValidation(root, config));
  checks.push(checkWatchProcess());
  checks.push(checkTrigger(root));
  checks.push(checkAccessibility());

  console.log('');
  console.log(chalk.bold('  AgentXchain Doctor'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(chalk.dim(`  Project root: ${root}`));
  console.log('');

  for (const c of checks) {
    const badge = c.level === 'pass'
      ? chalk.green('PASS')
      : c.level === 'warn'
        ? chalk.yellow('WARN')
        : chalk.red('FAIL');
    console.log(`  ${badge}  ${c.name}`);
    if (c.detail) console.log(`        ${chalk.dim(c.detail)}`);
  }

  const failCount = checks.filter(c => c.level === 'fail').length;
  const warnCount = checks.filter(c => c.level === 'warn').length;

  console.log('');
  if (failCount === 0 && warnCount === 0) {
    console.log(chalk.green('  ✓ Environment looks ready.'));
  } else if (failCount === 0) {
    console.log(chalk.yellow(`  Ready with warnings (${warnCount}).`));
  } else {
    console.log(chalk.red(`  Not ready: ${failCount} blocking issue(s).`));
  }
  console.log('');
}

function checkFile(name, ok, detail) {
  return {
    name,
    level: ok ? 'pass' : 'fail',
    detail: ok ? detail : `${name} is missing`
  };
}

function checkBinary(cmd, detail) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return { name: cmd, level: 'pass', detail };
  } catch {
    return { name: cmd, level: 'warn', detail: `${cmd} not found in PATH` };
  }
}

function checkPm(config) {
  if (config.agents?.pm) {
    return { name: 'PM agent', level: 'pass', detail: 'pm exists in agentxchain.json' };
  }
  const hasPmLike = Object.values(config.agents || {}).some(a => String(a?.name || '').toLowerCase().includes('product manager'));
  if (hasPmLike) {
    return { name: 'PM agent', level: 'pass', detail: 'Product Manager role detected' };
  }
  return { name: 'PM agent', level: 'warn', detail: 'No explicit PM agent. PM-first onboarding will be less clear.' };
}

function checkWatchProcess() {
  try {
    execSync('pgrep -f "agentxchain.*watch" >/dev/null', { stdio: 'ignore' });
    return { name: 'watch process', level: 'pass', detail: 'watch appears to be running' };
  } catch {
    return { name: 'watch process', level: 'warn', detail: 'watch not running (start with `agentxchain watch` or `agentxchain supervise --autonudge`)' };
  }
}

function checkTrigger(root) {
  const triggerPath = join(root, '.agentxchain-trigger.json');
  if (!existsSync(triggerPath)) {
    return { name: 'trigger file', level: 'warn', detail: '.agentxchain-trigger.json not found yet' };
  }

  try {
    const raw = JSON.parse(readFileSync(triggerPath, 'utf8'));
    const triggeredAt = new Date(raw.triggered_at).getTime();
    const ageMs = Date.now() - triggeredAt;
    if (Number.isFinite(triggeredAt) && ageMs <= 120000) {
      return { name: 'trigger file', level: 'pass', detail: `fresh trigger (${Math.round(ageMs / 1000)}s ago)` };
    }
    return { name: 'trigger file', level: 'warn', detail: 'trigger file is stale; lock may not be advancing' };
  } catch {
    return { name: 'trigger file', level: 'warn', detail: 'trigger file exists but is invalid JSON' };
  }
}

function checkAccessibility() {
  if (process.platform !== 'darwin') {
    return { name: 'macOS Accessibility', level: 'warn', detail: 'only checked on macOS' };
  }

  try {
    execSync(
      'osascript -e \'tell application "System Events" to get name of first process\'',
      { stdio: 'pipe' }
    );
    return { name: 'macOS Accessibility', level: 'pass', detail: 'System Events access available' };
  } catch {
    return {
      name: 'macOS Accessibility',
      level: 'warn',
      detail: 'Grant Accessibility to Terminal and Cursor in System Settings.'
    };
  }
}

function checkValidation(root, config) {
  const validation = validateProject(root, config, { mode: 'kickoff' });
  if (validation.ok) {
    return { name: 'kickoff validation', level: 'pass', detail: 'PM signoff + waves/phases look ready' };
  }
  return {
    name: 'kickoff validation',
    level: 'warn',
    detail: `Run \`agentxchain validate --mode kickoff\` (${validation.errors.length} issue(s))`
  };
}
