import { existsSync, readFileSync } from 'fs';
import { execFileSync, execSync } from 'child_process';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, findProjectRoot } from '../lib/config.js';
import { validateProject } from '../lib/validation.js';
import { getWatchPid } from './watch.js';
import { loadNormalizedConfig, detectConfigVersion } from '../lib/normalized-config.js';
import { readDaemonState, evaluateDaemonStatus } from '../lib/run-schedule.js';
import { getGovernedVersionSurface, formatGovernedVersionLabel } from '../lib/protocol-version.js';
import { PLUGIN_MANIFEST_FILE } from '../lib/plugins.js';

export async function doctorCommand(opts = {}) {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ error: 'No agentxchain.json found' }));
    } else {
      console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    }
    process.exit(1);
  }

  // Detect config version to dispatch
  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({ error: `agentxchain.json is invalid JSON: ${err.message}` }));
    } else {
      console.log(chalk.red(`agentxchain.json is invalid JSON: ${err.message}`));
    }
    process.exit(1);
  }

  const version = detectConfigVersion(rawConfig);

  if (version === 4) {
    return governedDoctor(root, rawConfig, opts);
  }

  // Legacy v3 path — existing behavior
  return legacyDoctor(root, opts);
}

// ── Governed (v4) Doctor ────────────────────────────────────────────────────

function governedDoctor(root, rawConfig, opts) {
  const checks = [];

  // 1. Config validation
  const configResult = loadNormalizedConfig(rawConfig, root);
  if (configResult.ok) {
    checks.push({ id: 'config_valid', name: 'Config validation', level: 'pass', detail: 'Config loads and validates' });
  } else {
    const errorSummary = configResult.errors.slice(0, 3).join('; ');
    checks.push({ id: 'config_valid', name: 'Config validation', level: 'fail', detail: errorSummary });
  }

  const normalized = configResult.normalized;

  // 2. Roles defined
  const roles = normalized ? Object.keys(normalized.roles || {}) : [];
  if (roles.length > 0) {
    checks.push({ id: 'roles_defined', name: 'Roles defined', level: 'pass', detail: `${roles.length} role${roles.length > 1 ? 's' : ''}: ${roles.join(', ')}` });
  } else {
    checks.push({ id: 'roles_defined', name: 'Roles defined', level: 'fail', detail: 'No roles defined' });
  }

  // 3. Runtime reachable — one sub-check per runtime
  // Use normalized runtimes if available, otherwise fall back to raw config
  const runtimes = (normalized && normalized.runtimes) || rawConfig.runtimes || {};
  for (const [rtId, rt] of Object.entries(runtimes)) {
    const check = checkRuntimeReachable(rtId, rt);
    checks.push(check);
  }
  const connectorProbe = getConnectorProbeRecommendation(runtimes);

  // 4. State directory
  const stateDir = join(root, '.agentxchain');
  if (existsSync(stateDir)) {
    checks.push({ id: 'state_dir', name: 'State directory', level: 'pass', detail: '.agentxchain/ exists' });
  } else {
    checks.push({ id: 'state_dir', name: 'State directory', level: 'warn', detail: '.agentxchain/ missing (created on first run)' });
  }

  // 5. State health
  const statePath = join(root, '.agentxchain', 'state.json');
  if (existsSync(statePath)) {
    try {
      const stateData = JSON.parse(readFileSync(statePath, 'utf8'));
      if (stateData.schema_version) {
        checks.push({ id: 'state_health', name: 'State health', level: 'pass', detail: `schema_version: ${stateData.schema_version}, status: ${stateData.status || 'unknown'}` });
      } else {
        checks.push({ id: 'state_health', name: 'State health', level: 'fail', detail: 'State file missing schema_version' });
      }
    } catch {
      checks.push({ id: 'state_health', name: 'State health', level: 'fail', detail: 'State file is malformed JSON' });
    }
  } else {
    checks.push({ id: 'state_health', name: 'State health', level: 'warn', detail: 'No state file yet (first run pending)' });
  }

  // 6. Schedule health (only when schedules configured)
  const schedules = normalized?.schedules;
  const hasSchedules = schedules && typeof schedules === 'object' && Object.keys(schedules).length > 0;
  if (hasSchedules) {
    const daemonState = readDaemonState(root);
    const daemonEval = evaluateDaemonStatus(daemonState);
    if (daemonEval.status === 'running') {
      const detail = `Daemon running (last heartbeat ${daemonEval.heartbeat_age_seconds}s ago)`;
      checks.push({ id: 'schedule_health', name: 'Schedule health', level: 'pass', detail });
    } else {
      const detail = `Daemon ${daemonEval.status}${daemonEval.warning ? `: ${daemonEval.warning}` : ''}`;
      checks.push({ id: 'schedule_health', name: 'Schedule health', level: 'warn', detail });
    }
  }

  // 7. Workflow-kit artifacts (current phase)
  if (normalized?.workflow_kit?.phases) {
    const currentPhase = getCurrentPhase(root) || Object.keys(normalized.routing || {})[0] || 'planning';
    const phaseKit = normalized.workflow_kit.phases[currentPhase];
    if (phaseKit?.artifacts?.length > 0) {
      const required = phaseKit.artifacts.filter(a => a.required !== false);
      const missing = required.filter(a => !existsSync(join(root, a.path)));
      if (missing.length === 0) {
        checks.push({ id: 'workflow_kit', name: 'Workflow-kit artifacts', level: 'pass', detail: `All ${required.length} required artifacts present for ${currentPhase}` });
      } else {
        checks.push({ id: 'workflow_kit', name: 'Workflow-kit artifacts', level: 'warn', detail: `${missing.length}/${required.length} required artifacts missing for ${currentPhase}` });
      }
    }
  }

  // 8. Installed plugin health (only when plugins are installed)
  const installedPlugins = rawConfig.plugins || {};
  const pluginNames = Object.keys(installedPlugins);
  if (pluginNames.length > 0) {
    for (const pluginName of pluginNames) {
      const meta = installedPlugins[pluginName];
      const checkId = `plugin_${pluginName.replace(/[^a-z0-9_-]/gi, '_')}`;

      // Check install path exists
      if (!meta.install_path) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'fail', detail: 'No install_path recorded', plugin_name: pluginName });
        continue;
      }
      const installAbsPath = join(root, meta.install_path);
      if (!existsSync(installAbsPath)) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'fail', detail: `Install path missing: ${meta.install_path}`, plugin_name: pluginName });
        continue;
      }

      // Check manifest exists and is valid
      const manifestPath = join(installAbsPath, PLUGIN_MANIFEST_FILE);
      if (!existsSync(manifestPath)) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'fail', detail: 'Manifest file missing', plugin_name: pluginName });
        continue;
      }
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (err) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'fail', detail: `Manifest is corrupt JSON: ${err.message}`, plugin_name: pluginName });
        continue;
      }

      // Check hook files exist
      const hookErrors = [];
      if (manifest.hooks && typeof manifest.hooks === 'object') {
        for (const [hookName, hookDef] of Object.entries(manifest.hooks)) {
          if (!hookDef) continue;
          const commands = Array.isArray(hookDef) ? hookDef : (hookDef.command ? [hookDef] : []);
          for (const cmd of commands) {
            const cmdArgs = cmd.command || cmd;
            if (Array.isArray(cmdArgs) && cmdArgs.length > 0) {
              const firstArg = cmdArgs[0];
              if (typeof firstArg === 'string' && (firstArg.startsWith('./') || firstArg.startsWith('../'))) {
                const hookFilePath = join(installAbsPath, firstArg);
                if (!existsSync(hookFilePath)) {
                  hookErrors.push(`${hookName}: ${firstArg}`);
                }
              }
            }
          }
        }
      }
      if (hookErrors.length > 0) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'fail', detail: `Missing hook files: ${hookErrors.join(', ')}`, plugin_name: pluginName });
        continue;
      }

      // Check config env vars (warn only)
      const envWarnings = [];
      const pluginConfig = meta.config || {};
      for (const [key, value] of Object.entries(pluginConfig)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          const envVar = value.slice(1);
          if (!process.env[envVar]) {
            envWarnings.push(envVar);
          }
        }
      }
      // Also check webhook_env pattern from config
      if (pluginConfig.webhook_env && !process.env[pluginConfig.webhook_env]) {
        if (!envWarnings.includes(pluginConfig.webhook_env)) {
          envWarnings.push(pluginConfig.webhook_env);
        }
      }

      if (envWarnings.length > 0) {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'warn', detail: `Env var(s) not set: ${envWarnings.join(', ')}`, plugin_name: pluginName });
      } else {
        checks.push({ id: checkId, name: `Plugin: ${pluginName}`, level: 'pass', detail: `v${manifest.version || '?'}, ${Object.keys(manifest.hooks || {}).length} hooks`, plugin_name: pluginName });
      }
    }
  }

  // Compute summary
  const failCount = checks.filter(c => c.level === 'fail').length;
  const warnCount = checks.filter(c => c.level === 'warn').length;
  const overall = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

  if (opts.json) {
    const projectId = rawConfig?.project?.id || rawConfig?.project?.name || 'unknown';
    const versionSurface = getGovernedVersionSurface(rawConfig);
    console.log(JSON.stringify({
      project: projectId,
      ...versionSurface,
      config_version: versionSurface.config_generation,
      overall,
      connector_probe_recommended: connectorProbe.recommended,
      connector_probe_runtime_ids: connectorProbe.runtimeIds,
      connector_probe_detail: connectorProbe.detail,
      checks,
      fail_count: failCount,
      warn_count: warnCount,
    }, null, 2));
  } else {
    const projectId = rawConfig?.project?.id || rawConfig?.project?.name || 'unknown';
    console.log('');
    console.log(chalk.bold('  AgentXchain Governed Doctor'));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log(chalk.dim(`  Project: ${projectId}`));
    console.log(chalk.dim(`  Versioning: ${formatGovernedVersionLabel(rawConfig)}`));
    console.log('');

    for (const c of checks) {
      const badge = c.level === 'pass'
        ? chalk.green('PASS')
        : c.level === 'warn'
          ? chalk.yellow('WARN')
          : chalk.red('FAIL');
      console.log(`  ${badge}  ${c.name.padEnd(24)} ${chalk.dim(c.detail)}`);
    }

    console.log('');
    if (failCount === 0 && warnCount === 0) {
      console.log(chalk.green('  ✓ Governed project is ready.'));
    } else if (failCount === 0) {
      console.log(chalk.yellow(`  Ready with ${warnCount} warning${warnCount > 1 ? 's' : ''}.`));
    } else {
      console.log(chalk.red(`  Not ready: ${failCount} failure${failCount > 1 ? 's' : ''}, ${warnCount} warning${warnCount > 1 ? 's' : ''}.`));
    }
    if (failCount === 0 && connectorProbe.recommended) {
      console.log(chalk.dim(`  Next: ${connectorProbe.detail}`));
    }
    console.log('');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

function checkRuntimeReachable(rtId, rt) {
  const base = { id: `runtime_${rtId}`, name: `Runtime: ${rtId}` };

  if (!rt || !rt.type) {
    return { ...base, level: 'warn', detail: 'No runtime type specified' };
  }

  switch (rt.type) {
    case 'manual':
      return { ...base, level: 'pass', detail: 'Manual runtime (no binary needed)' };

    case 'local_cli': {
      const cmd = Array.isArray(rt.command) ? rt.command[0] : (typeof rt.command === 'string' ? rt.command.split(/\s+/)[0] : null);
      if (!cmd) return { ...base, level: 'warn', detail: 'No command configured' };
      try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return { ...base, level: 'pass', detail: `${cmd} binary found` };
      } catch {
        return { ...base, level: 'fail', detail: `${cmd} not found in PATH` };
      }
    }

    case 'api_proxy': {
      const envVar = rt.auth_env;
      if (!envVar) {
        // ollama and similar providers may not require auth
        return { ...base, level: 'pass', detail: `${rt.provider || 'unknown'} provider (no auth required)` };
      }
      if (process.env[envVar]) {
        return { ...base, level: 'pass', detail: `${envVar} is set` };
      }
      return { ...base, level: 'fail', detail: `${envVar} not set` };
    }

    case 'mcp': {
      const transport = rt.transport || 'stdio';
      if (transport === 'streamable_http') {
        return { ...base, level: 'warn', detail: 'Remote MCP endpoint (cannot verify at doctor time)' };
      }
      const cmd = Array.isArray(rt.command) ? rt.command[0] : (typeof rt.command === 'string' ? rt.command.split(/\s+/)[0] : null);
      if (!cmd) return { ...base, level: 'warn', detail: 'No MCP command configured' };
      try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return { ...base, level: 'pass', detail: `${cmd} binary found` };
      } catch {
        return { ...base, level: 'fail', detail: `${cmd} not found in PATH` };
      }
    }

    case 'remote_agent':
      return { ...base, level: 'warn', detail: 'Remote agent endpoint (cannot verify at doctor time)' };

    default:
      return { ...base, level: 'warn', detail: `Unknown runtime type: ${rt.type}` };
  }
}

function getConnectorProbeRecommendation(runtimes) {
  const runtimeIds = [];

  for (const [rtId, rt] of Object.entries(runtimes || {})) {
    if (!rt || typeof rt !== 'object') continue;
    if (rt.type === 'api_proxy' || rt.type === 'remote_agent') {
      runtimeIds.push(rtId);
      continue;
    }
    if (rt.type === 'mcp' && (rt.transport || 'stdio') === 'streamable_http') {
      runtimeIds.push(rtId);
    }
  }

  if (runtimeIds.length === 0) {
    return {
      recommended: false,
      runtimeIds: [],
      detail: null,
    };
  }

  return {
    recommended: true,
    runtimeIds,
    detail: 'run `agentxchain connector check` to live-probe api / remote HTTP runtimes before the first governed turn.',
  };
}

function getCurrentPhase(root) {
  const statePath = join(root, '.agentxchain', 'state.json');
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.current_phase || null;
  } catch {
    return null;
  }
}

// ── Legacy (v3) Doctor ──────────────────────────────────────────────────────

function legacyDoctor(root, opts) {
  const result = loadConfig(root);
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { config } = result;
  const lock = loadLock(root);
  const checks = [];

  checks.push(checkFile('agentxchain.json', existsSync(join(root, 'agentxchain.json')), 'Project config exists'));
  checks.push(checkFile('lock.json', !!lock, 'Lock file exists'));
  checks.push(checkBinary('cursor', 'Cursor CLI available (optional for non-macOS launch)'));
  checks.push(checkBinary('jq', 'jq installed (required for auto-nudge)'));
  checks.push(checkBinary('osascript', 'osascript available (required for auto-nudge, macOS)'));
  checks.push(checkPm(config));
  checks.push(checkValidation(root, config));
  checks.push(checkWatchProcess(root));
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

function checkWatchProcess(root) {
  const pid = getWatchPid(root);
  if (pid) {
    return { name: 'watch process', level: 'pass', detail: `watch running (PID: ${pid})` };
  }
  try {
    execSync('pgrep -f "agentxchain.*watch" >/dev/null', { stdio: 'ignore' });
    return { name: 'watch process', level: 'pass', detail: 'watch appears to be running (no PID file)' };
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
    execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first process'],
      {
        stdio: 'pipe',
        timeout: 1500,
        killSignal: 'SIGKILL',
      },
    );
    return { name: 'macOS Accessibility', level: 'pass', detail: 'System Events access available' };
  } catch (err) {
    if (err?.signal === 'SIGKILL' || err?.message?.includes('ETIMEDOUT')) {
      return {
        name: 'macOS Accessibility',
        level: 'warn',
        detail: 'Accessibility probe timed out. Grant Accessibility to Terminal and Cursor in System Settings.',
      };
    }
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
