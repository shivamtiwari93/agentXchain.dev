import chalk from 'chalk';

import { loadProjectContext } from '../lib/config.js';
import { DEFAULT_VALIDATE_TIMEOUT_MS, validateConfiguredConnector } from '../lib/connector-validate.js';
import { DEFAULT_TIMEOUT_MS, probeConfiguredConnectors } from '../lib/connector-probe.js';
import { buildRuntimeCapabilityReport } from '../lib/runtime-capabilities.js';

function warningDetail(warning) {
  if (typeof warning === 'string') {
    return warning;
  }
  return warning?.detail || JSON.stringify(warning);
}

function warningFix(warning) {
  return typeof warning === 'object' && warning?.fix ? warning.fix : null;
}

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
    if (connector.fix) {
      console.log(`        ${chalk.dim('Fix:')}    ${connector.fix}`);
    }
    if (Array.isArray(connector.authority_warnings) && connector.authority_warnings.length > 0) {
      for (const warning of connector.authority_warnings) {
        console.log(`        ${chalk.yellow('⚠')} ${warningDetail(warning)}`);
        const fix = warningFix(warning);
        if (fix) {
          console.log(`          ${chalk.dim('Fix:')} ${fix}`);
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
    root: context.root,
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
      console.log(`  ${chalk.yellow('!')} ${warningDetail(warning)}`);
      const fix = warningFix(warning);
      if (fix) {
        console.log(`    ${chalk.dim('Fix:')} ${fix}`);
      }
    }
  }

  if (result.schema_contract) {
    console.log('');
    console.log(`  ${chalk.dim('Schema:')}   ${result.schema_contract.ok ? chalk.green('ok') : chalk.red('failed')}`);
    if (Array.isArray(result.schema_contract.failures) && result.schema_contract.failures.length > 0) {
      console.log(`  ${chalk.dim('Contract:')} ${result.schema_contract.failures.join(' | ')}`);
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

function printCapabilitiesText(report) {
  console.log('');
  console.log(chalk.bold(`  ${report.runtime_id}`) + chalk.dim(` (${report.runtime_type})`));
  console.log(chalk.dim('  ' + '-'.repeat(44)));

  const c = report.merged_contract;
  console.log(`  ${chalk.dim('Transport:')}         ${c.transport}`);
  console.log(`  ${chalk.dim('Write files:')}       ${c.can_write_files}`);
  console.log(`  ${chalk.dim('Proposals:')}         ${c.proposal_support}`);
  console.log(`  ${chalk.dim('Artifact ownership:')} ${c.workflow_artifact_ownership}`);
  console.log(`  ${chalk.dim('Local binary:')}      ${c.requires_local_binary ? 'yes' : 'no'}`);

  if (Object.keys(report.declared_capabilities).length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Declared overrides:')}`);
    for (const [k, v] of Object.entries(report.declared_capabilities)) {
      console.log(`    ${k}: ${v}`);
    }
  }

  if (report.declaration_warnings.length > 0) {
    console.log('');
    for (const w of report.declaration_warnings) {
      console.log(`  ${chalk.yellow('!')} ${w}`);
    }
  }

  if (report.role_bindings.length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Role bindings:')}`);
    for (const rb of report.role_bindings) {
      const badge = rb.effective_write_path.startsWith('invalid') ? chalk.red('INVALID') : chalk.green('OK');
      console.log(`    ${badge}  ${rb.role_id} (${rb.role_write_authority}) -> ${rb.effective_write_path}`);
      for (const note of rb.notes) {
        console.log(`         ${chalk.dim(note)}`);
      }
    }
  }
}

export async function connectorCapabilitiesCommand(runtimeId, options = {}) {
  const context = loadProjectContext();
  if (!context) {
    const payload = { error: 'No governed agentxchain.json found.' };
    if (options.json) { printJson(payload, 2); return; }
    console.error(chalk.red('No governed agentxchain.json found. Run this inside a governed project.'));
    process.exit(2);
  }

  const config = context.config;
  const runtimes = config.runtimes || {};
  const roles = config.roles || {};

  if (options.all) {
    const reports = [];
    for (const [id, runtime] of Object.entries(runtimes)) {
      reports.push(buildRuntimeCapabilityReport(id, runtime, roles));
    }
    const payload = { runtimes: reports };
    if (options.json) { printJson(payload, 0); return; }

    console.log('');
    console.log(chalk.bold('  AgentXchain Connector Capabilities'));
    console.log(chalk.dim('  ' + '='.repeat(44)));
    if (reports.length === 0) {
      console.log('  No runtimes configured.');
    } else {
      for (const r of reports) { printCapabilitiesText(r); }
    }
    console.log('');
    process.exit(0);
  }

  if (!runtimeId) {
    const payload = { error: 'Runtime ID required. Use --all to list all runtimes.', available_runtimes: Object.keys(runtimes) };
    if (options.json) { printJson(payload, 2); return; }
    console.error(chalk.red('Runtime ID required. Use --all to list all runtimes.'));
    if (Object.keys(runtimes).length > 0) {
      console.error(chalk.dim(`Available: ${Object.keys(runtimes).join(', ')}`));
    }
    process.exit(2);
  }

  if (!runtimes[runtimeId]) {
    const payload = { error: `Runtime "${runtimeId}" not found.`, available_runtimes: Object.keys(runtimes) };
    if (options.json) { printJson(payload, 2); return; }
    console.error(chalk.red(`Runtime "${runtimeId}" not found.`));
    if (Object.keys(runtimes).length > 0) {
      console.error(chalk.dim(`Available: ${Object.keys(runtimes).join(', ')}`));
    }
    process.exit(2);
  }

  const report = buildRuntimeCapabilityReport(runtimeId, runtimes[runtimeId], roles);
  if (options.json) { printJson(report, 0); return; }

  console.log('');
  console.log(chalk.bold('  AgentXchain Connector Capabilities'));
  console.log(chalk.dim('  ' + '='.repeat(44)));
  printCapabilitiesText(report);
  console.log('');
  process.exit(0);
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
