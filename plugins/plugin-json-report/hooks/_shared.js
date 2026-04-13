import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';

export async function readEnvelope() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim() ? JSON.parse(input) : {};
}

function safeTimestamp(timestamp) {
  return (timestamp || new Date().toISOString()).replace(/[:]/g, '-');
}

function parsePluginConfig() {
  try {
    const parsed = JSON.parse(process.env.AGENTXCHAIN_PLUGIN_CONFIG || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveReportDir(projectRoot, config) {
  const configuredDir = typeof config?.report_dir === 'string' && config.report_dir.trim()
    ? config.report_dir.trim()
    : '.agentxchain/reports';
  const reportDir = resolve(projectRoot, configuredDir);
  const relativePath = relative(projectRoot, reportDir);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return reportDir;
  }
  return null;
}

export function writeReport(pluginName, envelope) {
  const projectRoot = process.env.AGENTXCHAIN_PROJECT_ROOT;
  if (!projectRoot) {
    process.stdout.write(JSON.stringify({
      verdict: 'warn',
      message: 'Missing AGENTXCHAIN_PROJECT_ROOT',
    }));
    return;
  }

  const config = parsePluginConfig();
  if (config === null) {
    process.stdout.write(JSON.stringify({
      verdict: 'warn',
      message: 'Invalid AGENTXCHAIN_PLUGIN_CONFIG JSON',
    }));
    return;
  }

  const hookPhase = envelope.hook_phase || 'unknown';
  const timestamp = envelope.timestamp || new Date().toISOString();
  const reportDir = resolveReportDir(projectRoot, config);
  if (!reportDir) {
    process.stdout.write(JSON.stringify({
      verdict: 'warn',
      message: 'Configured report_dir must stay within the governed project root',
    }));
    return;
  }

  mkdirSync(reportDir, { recursive: true });

  const report = {
    plugin_name: pluginName,
    hook_phase: hookPhase,
    run_id: envelope.run_id || null,
    hook_name: envelope.hook_name || null,
    turn_id: envelope.payload?.turn_id || envelope.turn_id || envelope.payload?.failed_turn_id || null,
    timestamp,
    payload: envelope.payload || {},
  };

  const stampedName = `${safeTimestamp(timestamp)}-${hookPhase}.json`;
  writeFileSync(join(reportDir, stampedName), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(reportDir, `latest-${hookPhase}.json`), JSON.stringify(report, null, 2) + '\n');

  process.stdout.write(JSON.stringify({
    verdict: 'allow',
    message: `Wrote ${stampedName}`,
  }));
}
