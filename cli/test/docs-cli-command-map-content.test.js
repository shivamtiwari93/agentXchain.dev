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
    ['init', ['init']],
    ['config', ['config']],
    ['status', ['status']],
    ['export', ['export']],
    ['restore', ['restore']],
    ['restart', ['restart']],
    ['report', ['report']],
    ['validate', ['validate']],
    ['verify', ['verify protocol', 'verify export']],
    ['migrate', ['migrate']],
    ['resume', ['resume']],
    ['escalate', ['escalate']],
    ['accept-turn', ['accept-turn']],
    ['reject-turn', ['reject-turn']],
    ['step', ['step']],
    ['run', ['run']],
    ['schedule', ['schedule']],
    ['approve-transition', ['approve-transition']],
    ['approve-completion', ['approve-completion']],
    ['dashboard', ['dashboard']],
    ['plugin', ['plugin']],
    ['template', ['template list', 'template validate', 'template set']],
    ['multi', ['multi']],
    ['intake', ['intake']],
    ['proposal', ['proposal']],
    ['history', ['history']],
    ['events', ['events']],
    ['doctor', ['doctor']],
  ]);

  it('documents every governed-scope top-level command family from the CLI registration', () => {
    assert.deepEqual(governedCommands, [
      'init',
      'status',
      'export',
      'restore',
      'restart',
      'report',
      'config',
      'doctor',
      'demo',
      'schedule',
      'history',
      'events',
      'validate',
      'verify',
      'migrate',
      'resume',
      'escalate',
      'accept-turn',
      'reject-turn',
      'step',
      'run',
      'approve-transition',
      'approve-completion',
      'dashboard',
      'plugin',
      'template',
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
    assert.ok(commandMapRows.includes('verify protocol'));
    assert.ok(commandMapRows.includes('verify export'));
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
});

describe('CLI command map spec alignment', () => {
  it('ships a standalone command-map contract spec', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-CMAP-001/);
    assert.match(SPEC, /AT-CMAP-005/);
    assert.match(SPEC, /verify protocol/);
  });
});
