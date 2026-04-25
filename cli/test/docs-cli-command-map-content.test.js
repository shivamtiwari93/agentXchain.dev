import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const SPEC = read('.planning/CLI_DOCS_COMMAND_MAP_CONTRACT_SPEC.md');

const LEGACY_COMMANDS = [
  'start',
  'kickoff',
  'stop',
  'branch',
  'generate',
  'watch',
  'supervise',
  'rebind',
  'claim',
  'release',
  'update',
];

function extractTopLevelCommands() {
  return [...CLI_ENTRY.matchAll(/program\s*\n(?:\s*\.\w+\([^\n]*\)\n)*\s*\.command\('([a-z-]+)(?: [^']+)?'\)/g)]
    .map(([, name]) => name);
}

function extractCommandMapRows() {
  const lines = CLI_DOCS.split('\n');
  const mapStart = lines.findIndex((line) => line.trim() === '| Command | Phase | Description |');
  assert.ok(mapStart >= 0, 'missing command map table');
  const rows = [];
  for (let i = mapStart + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('| `')) break;
    const match = line.match(/^\| `([^`]+)` \|/);
    if (match) rows.push(match[1]);
  }
  return rows;
}

describe('CLI command map docs contract', () => {
  const topLevelCommands = extractTopLevelCommands();
  const commandMapRows = extractCommandMapRows();
  const governedCommands = topLevelCommands.filter((command) => !LEGACY_COMMANDS.includes(command));
  const expectedRowMapping = new Map([
    ['demo', ['demo']],
    ['benchmark', ['benchmark']],
    ['init', ['init']],
    ['config', ['config']],
    ['status', ['status']],
    ['export', ['export']],
    ['audit', ['audit']],
    ['restore', ['restore']],
    ['restart', ['restart']],
    ['report', ['report']],
    ['validate', ['validate']],
    ['verify', ['verify turn', 'verify protocol', 'verify export', 'verify diff']],
    ['replay', ['replay turn']],
    ['migrate', ['migrate']],
    ['migrate-intents', ['migrate-intents']],
    ['resume', ['resume']],
    ['unblock', ['unblock']],
    ['inject', ['inject']],
    ['escalate', ['escalate']],
    ['accept-turn', ['accept-turn']],
    ['checkpoint-turn', ['checkpoint-turn']],
    ['reconcile-state', ['reconcile-state']],
    ['reject-turn', ['reject-turn']],
    ['reissue-turn', ['reissue-turn']],
    ['step', ['step']],
    ['run', ['run']],
    ['schedule', ['schedule']],
    ['approve-transition', ['approve-transition']],
    ['approve-completion', ['approve-completion']],
    ['serve-mcp', ['serve-mcp']],
    ['dashboard', ['dashboard']],
    ['plugin', ['plugin']],
    ['template', ['template list', 'template validate', 'template set']],
    ['phase', ['phase list', 'phase show']],
    ['gate', ['gate list', 'gate show']],
    ['role', ['role list', 'role show']],
    ['turn', ['turn show']],
    ['multi', ['multi']],
    ['intake', ['intake']],
    ['proposal', ['proposal']],
    ['history', ['history']],
    ['decisions', ['decisions']],
    ['diff', ['diff']],
    ['events', ['events']],
    ['chain', ['chain latest', 'chain list', 'chain show']],
    ['mission', ['mission start', 'mission list', 'mission show', 'mission attach-chain', 'mission plan', 'mission plan show', 'mission plan approve', 'mission plan autopilot', 'mission plan list']],
    ['doctor', ['doctor']],
    ['connector', ['connector capabilities', 'connector check', 'connector validate']],
    ['workflow-kit', ['workflow-kit describe']],
    ['conformance', ['conformance check']],
  ]);

  it('documents every governed-scope top-level command family from the CLI registration', () => {
    assert.deepEqual(governedCommands, [
      'init',
      'status',
      'export',
      'audit',
      'restore',
      'restart',
      'report',
      'config',
      'doctor',
      'connector',
      'demo',
      'benchmark',
      'schedule',
      'history',
      'decisions',
      'diff',
      'events',
      'chain',
      'mission',
      'validate',
      'conformance',
      'verify',
      'replay',
      'migrate',
      'migrate-intents',
      'resume',
      'unblock',
      'inject',
      'escalate',
      'accept-turn',
      'checkpoint-turn',
      'reconcile-state',
      'reject-turn',
      'reissue-turn',
      'step',
      'run',
      'approve-transition',
      'approve-completion',
      'serve-mcp',
      'dashboard',
      'plugin',
      'template',
      'phase',
      'workflow-kit',
      'gate',
      'role',
      'turn',
      'multi',
      'intake',
      'proposal',
    ]);

    for (const command of governedCommands) {
      const expectedRows = expectedRowMapping.get(command);
      assert.ok(expectedRows, `missing expected row mapping for ${command}`);
      for (const row of expectedRows) {
        assert.ok(
          commandMapRows.includes(row),
          `cli.mdx command map must include governed command row ${row}`
        );
      }
    }
  });

  it('does not leak legacy compatibility commands into the governed command map', () => {
    for (const command of LEGACY_COMMANDS) {
      assert.ok(
        !commandMapRows.includes(command),
        `legacy compatibility command ${command} must not appear in the governed command map`
      );
    }
  });

  it('documents verify as verify protocol rather than the ambiguous parent command', () => {
    assert.ok(commandMapRows.includes('verify turn'));
    assert.ok(commandMapRows.includes('verify protocol'));
    assert.ok(commandMapRows.includes('verify export'));
    assert.ok(commandMapRows.includes('verify diff'));
    assert.ok(!commandMapRows.includes('verify'));
  });

  it('states the legacy compatibility boundary explicitly near the top of the page', () => {
    assert.match(CLI_DOCS, /Legacy v3 local-orchestration commands/);
    assert.match(CLI_DOCS, /remain in the binary for compatibility/i);
    assert.match(CLI_DOCS, /this page is intentionally scoped to the governed surface/i);
  });

  it('documents config --get as the narrow config inspection path', () => {
    assert.match(CLI_DOCS, /agentxchain config --get <key>/);
    assert.match(CLI_DOCS, /use `--get`/i);
  });

  it('describes benchmark as named-workload governance proof, not protocol conformance', () => {
    assert.match(CLI_DOCS, /benchmark.*--workload <name>/i);
    assert.match(CLI_DOCS, /benchmark.*--stress/i);
    assert.match(CLI_DOCS, /benchmark.*--output <dir>/i);
    assert.match(CLI_DOCS, /completion-recovery/i);
    assert.match(CLI_DOCS, /phase-drift/i);
    assert.match(CLI_DOCS, /planning → design → implementation → qa/i);
    assert.match(CLI_DOCS, /benchmark workloads/i);
    assert.match(CLI_DOCS, /benchmark.*export verification/i);
    assert.doesNotMatch(CLI_DOCS, /benchmark.*protocol conformance/i);
  });

  it('documents generate planning as the governed planning-artifact recovery path', () => {
    assert.ok(commandMapRows.includes('generate planning'));
    assert.match(CLI_DOCS, /agentxchain generate planning \[--dry-run\] \[--force\] \[--json\]/);
    assert.match(CLI_DOCS, /restore scaffold-owned governed planning artifacts/i);
  });
});

describe('CLI command map spec alignment', () => {
  it('ships a standalone command-map contract spec', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-CMAP-001/);
    assert.match(SPEC, /AT-CMAP-005/);
    assert.match(SPEC, /conformance check/);
    assert.match(SPEC, /verify turn/);
    assert.match(SPEC, /verify protocol/);
  });
});
