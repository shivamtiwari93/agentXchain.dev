import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

export function writeReport(pluginName, envelope) {
  const projectRoot = process.env.AGENTXCHAIN_PROJECT_ROOT;
  if (!projectRoot) {
    process.stdout.write(JSON.stringify({
      verdict: 'warn',
      message: 'Missing AGENTXCHAIN_PROJECT_ROOT',
    }));
    return;
  }

  const hookPhase = envelope.hook_phase || 'unknown';
  const timestamp = envelope.timestamp || new Date().toISOString();
  const reportDir = join(projectRoot, '.agentxchain', 'reports');
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
