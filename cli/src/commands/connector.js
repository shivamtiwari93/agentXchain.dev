import chalk from 'chalk';

import { loadProjectContext } from '../lib/config.js';
import { DEFAULT_VALIDATE_TIMEOUT_MS, validateConfiguredConnector } from '../lib/connector-validate.js';
import { DEFAULT_TIMEOUT_MS, probeConfiguredConnectors } from '../lib/connector-probe.js';

function printJson(result, exitCode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

function printText(result, exitCode) {
  if (result.connectors.length === 0) {
    console.log('');
    console.log(chalk.bold('  AgentXchain Connector Check'));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log('');
    console.log(`  ${chalk.green('PASS')}  No non-manual runtimes are configured`);
    console.log('');
    process.exit(exitCode);
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Connector Check'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim(`Timeout: ${result.timeout_ms}ms per connector`)}`);
  console.log('');

  for (const connector of result.connectors) {
    const badge = connector.level === 'pass'
      ? chalk.green('PASS')
      : connector.level === 'warn'
        ? chalk.yellow('WARN')
        : chalk.red('FAIL');
    console.log(`  ${badge}  ${connector.runtime_id} (${connector.type})`);
    console.log(`        ${chalk.dim('Target:')} ${connector.target}`);
    console.log(`        ${chalk.dim('Probe:')}  ${connector.probe_kind}`);
    if (connector.endpoint) {
      console.log(`        ${chalk.dim('URL:')}    ${connector.endpoint}`);
    }
    if (connector.status_code != null) {
      console.log(`        ${chalk.dim('HTTP:')}   ${connector.status_code}`);
    }
    if (connector.auth_env) {
      console.log(`        ${chalk.dim('Auth:')}   ${connector.auth_env}`);
    }
    if (connector.latency_ms != null) {
      console.log(`        ${chalk.dim('Time:')}   ${connector.latency_ms}ms`);
    }
    console.log(`        ${chalk.dim('Detail:')} ${connector.detail}`);
    if (Array.isArray(connector.authority_warnings) && connector.authority_warnings.length > 0) {
      for (const warning of connector.authority_warnings) {
        console.log(`        ${chalk.yellow('⚠')} ${warning.detail}`);
        if (warning.fix) {
          console.log(`          ${chalk.dim('Fix:')} ${warning.fix}`);
        }
      }
    }
  }

  console.log('');
  const summary = result.overall === 'pass'
    ? chalk.green(`  ✓ ${result.pass_count}/${result.connectors.length} connectors passed`)
    : result.overall === 'warn'
      ? chalk.yellow(`  ⚠ ${result.warn_count} connector warning(s), ${result.pass_count} passed`)
      : chalk.red(`  ${result.fail_count} connector failure(s), ${result.pass_count} passed`);
  console.log(summary);
  console.log('');
  process.exit(exitCode);
}

export async function connectorCheckCommand(runtimeId, options = {}) {
  const context = loadProjectContext();
  if (!context) {
    const payload = { overall: 'error', error: 'No governed agentxchain.json found.' };
    if (options.json) {
      printJson(payload, 2);
      return;
    }
    console.error(chalk.red('No governed agentxchain.json found. Run this inside a governed project.'));
    process.exit(2);
  }

  if (context.config.protocol_mode !== 'governed') {
    const payload = { overall: 'error', error: 'connector check only supports governed projects.' };
    if (options.json) {
      printJson(payload, 2);
      return;
    }
    console.error(chalk.red('connector check only supports governed projects.'));
    process.exit(2);
  }

  const timeoutMs = Number.parseInt(options.timeout || DEFAULT_TIMEOUT_MS, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const payload = { overall: 'error', error: 'Timeout must be a positive integer.' };
    if (options.json) {
      printJson(payload, 2);
      return;
    }
    console.error(chalk.red('Timeout must be a positive integer.'));
    process.exit(2);
  }

  const result = await probeConfiguredConnectors(context.config, {
    runtimeId: runtimeId || null,
    timeoutMs,
    onProbeStart: options.json ? null : (probeRuntimeId, runtime) => {
      console.log(`  ${chalk.dim('…')} Probing ${chalk.bold(probeRuntimeId)} ${chalk.dim(`(${runtime.type})`)}`);
    },
  });

  if (!result.ok && result.error) {
    const payload = { overall: 'error', error: result.error };
    if (options.json) {
      printJson(payload, result.exitCode || 2);
      return;
    }
    console.error(chalk.red(result.error));
    process.exit(result.exitCode || 2);
  }

  const payload = {
    overall: result.overall,
    timeout_ms: result.timeout_ms,
    pass_count: result.pass_count,
    warn_count: result.warn_count,
    fail_count: result.fail_count,
    connectors: result.connectors,
  };

  if (options.json) {
    printJson(payload, result.exitCode);
    return;
  }

  printText(payload, result.exitCode);
}

function printValidateText(result, exitCode) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Connector Validate'));
  console.log(chalk.dim('  ' + '─'.repeat(47)));
  console.log(`  ${chalk.dim(`Runtime:`)} ${result.runtime_id} (${result.runtime_type})`);
  console.log(`  ${chalk.dim(`Role:`)}    ${result.role_id}`);
  console.log(`  ${chalk.dim(`Timeout:`)} ${result.timeout_ms}ms`);
  console.log('');

  const badge = result.overall === 'pass'
    ? chalk.green('PASS')
    : result.overall === 'error'
      ? chalk.red('ERROR')
      : chalk.red('FAIL');
  const summary = result.overall === 'pass'
    ? 'Synthetic governed dispatch produced a valid turn result'
    : (result.error || result.dispatch?.error || result.validation?.errors?.[0] || 'Connector validation failed');
  console.log(`  ${badge}  ${summary}`);

  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    console.log('');
    for (const warning of result.warnings) {
      console.log(`  ${chalk.yellow('!')} ${warning}`);
    }
  }

  if (result.dispatch) {
    console.log('');
    console.log(`  ${chalk.dim('Dispatch:')} ${result.dispatch.ok ? chalk.green('ok') : chalk.red('failed')}`);
    if (result.dispatch.error) {
      console.log(`  ${chalk.dim('Detail:')}   ${result.dispatch.error}`);
    }
  }

  if (result.validation) {
    console.log(`  ${chalk.dim('Validator:')} ${result.validation.ok ? chalk.green('ok') : chalk.red(result.validation.stage || 'failed')}`);
    if (Array.isArray(result.validation.errors) && result.validation.errors.length > 0) {
      console.log(`  ${chalk.dim('Errors:')}   ${result.validation.errors.join(' | ')}`);
    }
  }

  if (typeof result.cost_usd === 'number') {
    console.log(`  ${chalk.dim('Cost:')}     $${result.cost_usd.toFixed(3)}`);
  }

  if (result.scratch_root) {
    console.log('');
    console.log(`  ${chalk.dim('Scratch:')} ${result.scratch_root}`);
  }

  console.log('');
  process.exit(exitCode);
}

export async function connectorValidateCommand(runtimeId, options = {}) {
  const context = loadProjectContext();
  if (!context) {
    const payload = { overall: 'error', error: 'No governed agentxchain.json found.' };
    if (options.json) {
      printJson(payload, 2);
      return;
    }
    console.error(chalk.red('No governed agentxchain.json found. Run this inside a governed project.'));
    process.exit(2);
  }

  const timeoutMs = Number.parseInt(options.timeout || DEFAULT_VALIDATE_TIMEOUT_MS, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const payload = { overall: 'error', error: 'Timeout must be a positive integer.' };
    if (options.json) {
      printJson(payload, 2);
      return;
    }
    console.error(chalk.red('Timeout must be a positive integer.'));
    process.exit(2);
  }

  const result = await validateConfiguredConnector(context.root, {
    runtimeId,
    roleId: options.role || null,
    timeoutMs,
    keepArtifacts: options.keepArtifacts === true,
  });

  if (options.json) {
    printJson(result, result.exitCode ?? 1);
    return;
  }

  printValidateText(result, result.exitCode ?? 1);
}
