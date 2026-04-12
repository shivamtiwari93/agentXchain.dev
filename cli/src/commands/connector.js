import chalk from 'chalk';

import { loadProjectContext } from '../lib/config.js';
import { DEFAULT_TIMEOUT_MS, probeConfiguredConnectors } from '../lib/connector-probe.js';

function printJson(result, exitCode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

function printText(result, exitCode) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Connector Check'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  if (result.connectors.length === 0) {
    console.log(`  ${chalk.green('PASS')}  No non-manual runtimes are configured`);
    console.log('');
    process.exit(exitCode);
  }

  for (const connector of result.connectors) {
    const badge = connector.level === 'pass' ? chalk.green('PASS') : chalk.red('FAIL');
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
  }

  console.log('');
  const summary = result.overall === 'pass'
    ? chalk.green(`  ✓ ${result.pass_count}/${result.connectors.length} connectors passed`)
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
    fail_count: result.fail_count,
    connectors: result.connectors,
  };

  if (options.json) {
    printJson(payload, result.exitCode);
    return;
  }

  printText(payload, result.exitCode);
}
