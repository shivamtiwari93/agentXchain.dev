import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createCoordinatorWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-boundary-'));
  writeFileSync(join(dir, 'agentxchain-multi.json'), JSON.stringify({
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Test' },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
    },
    workstreams: {
      delivery_fix: {
        phase: 'implementation',
        repos: ['api'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'delivery_fix' },
    },
    gates: {
      initiative_ship: { requires_human_approval: true, requires_repos: ['api'] },
    },
  }, null, 2));
  return dir;
}

function createGovernedProject(dir) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    project: 'intake-boundary-test',
    protocol_mode: 'governed',
    version: '1.0',
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('intake workspace boundary', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('AT-INTAKE-BOUNDARY-001: all intake subcommands reject coordinator workspaces explicitly', () => {
    const dir = createCoordinatorWorkspace();
    cleanup.push(dir);

    const cases = [
      ['record'],
      ['triage'],
      ['approve'],
      ['plan'],
      ['start'],
      ['resolve'],
      ['scan'],
      ['status'],
    ];

    for (const command of cases) {
      const result = runCli(['intake', ...command, '--json'], dir);
      assert.equal(result.status, 2, `${command.join(' ')} should exit 2: ${result.stderr}`);
      const out = JSON.parse(result.stdout);
      assert.equal(out.ok, false);
      assert.match(out.error, /repo-local only/i);
      assert.match(out.error, /agentxchain-multi\.json/);
      assert.match(out.error, /child governed repo/i);
      assert.match(out.error, /agentxchain multi step/);
    }
  });

  it('AT-INTAKE-BOUNDARY-003: coordinator workspace detection works from nested non-repo directories', () => {
    const dir = createCoordinatorWorkspace();
    const nested = join(dir, 'notes', 'drafts');
    mkdirSync(nested, { recursive: true });
    cleanup.push(dir);

    const result = runCli(['intake', 'status', '--json'], nested);
    assert.equal(result.status, 2, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.match(out.error, /coordinator workspace/i);
    assert.match(out.error, /agentxchain-multi\.json/);
  });

  it('AT-INTAKE-BOUNDARY-004: governed project detection wins when both config files exist', () => {
    const dir = createCoordinatorWorkspace();
    cleanup.push(dir);
    createGovernedProject(dir);

    const result = runCli(['intake', 'status', '--json'], dir);
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.summary.total_events, 0);
    assert.equal(out.summary.total_intents, 0);
  });
});
