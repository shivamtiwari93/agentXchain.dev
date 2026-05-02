import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const STARTER_DIR = join(REPO_ROOT, 'examples', 'external-runner-starter');
const STARTER_README = readFileSync(join(STARTER_DIR, 'README.md'), 'utf8');
const ADAPTER_SCRIPT = readFileSync(join(STARTER_DIR, 'run-adapter-turn.mjs'), 'utf8');

const tempRoots = [];

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Adapter-backed starter package contract', () => {
  it('AT-ADAPTER-STARTER-001: adapter starter uses both package exports and no internal imports', () => {
    assert.ok(existsSync(join(STARTER_DIR, 'run-adapter-turn.mjs')), 'adapter starter script must exist');
    assert.match(ADAPTER_SCRIPT, /from 'agentxchain\/runner-interface'/);
    assert.match(ADAPTER_SCRIPT, /from 'agentxchain\/adapter-interface'/);
    assert.ok(
      !ADAPTER_SCRIPT.includes('cli/src/lib/'),
      'adapter starter must not use repo-relative imports',
    );
    assert.ok(
      !ADAPTER_SCRIPT.includes('agentxchain step'),
      'adapter starter must not shell out to the CLI',
    );
  });

  it('AT-ADAPTER-STARTER-002: adapter starter imports dispatchLocalCli, writeDispatchBundle, and saveDispatchLogs', () => {
    assert.match(ADAPTER_SCRIPT, /dispatchLocalCli/);
    assert.match(ADAPTER_SCRIPT, /writeDispatchBundle/);
    assert.match(ADAPTER_SCRIPT, /saveDispatchLogs/);
    assert.match(ADAPTER_SCRIPT, /ADAPTER_INTERFACE_VERSION/);
  });

  it('AT-ADAPTER-STARTER-003: README documents the adapter starter', () => {
    assert.match(STARTER_README, /run-adapter-turn\.mjs/);
    assert.match(STARTER_README, /adapter-interface/);
    assert.match(STARTER_README, /dispatchLocalCli|local_cli/);
  });

  it('AT-ADAPTER-STARTER-004: a clean consumer project can install the packed tarball and run the adapter starter', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-adapter-starter-pkg-'));
    const packDir = join(root, 'pack');
    const consumerDir = join(root, 'consumer');
    tempRoots.push(root);

    mkdirSync(packDir, { recursive: true });
    mkdirSync(consumerDir, { recursive: true });

    const packOutput = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: CLI_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    const [{ filename }] = JSON.parse(packOutput);
    const tarballPath = join(packDir, filename);

    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          name: 'agentxchain-adapter-starter-contract',
          private: true,
          type: 'module',
        },
        null,
        2,
      ),
    );
    cpSync(join(STARTER_DIR, 'run-adapter-turn.mjs'), join(consumerDir, 'run-adapter-turn.mjs'));

    execFileSync('npm', ['install', tarballPath], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 120_000,
    });

    const result = execFileSync('node', ['run-adapter-turn.mjs', '--json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const json = JSON.parse(result);

    assert.equal(json.result, 'pass');
    assert.equal(json.runner, 'adapter-starter');
    assert.equal(json.dispatched_via, 'local_cli');
    assert.equal(json.final_status, 'active');
    assert.match(json.runner_interface_version, /^[0-9]+\.[0-9]+$/);
    assert.match(json.adapter_interface_version, /^[0-9]+\.[0-9]+$/);
    assert.match(json.run_id, /^run_[0-9a-f]+$/);
    assert.match(json.turn_id, /^turn_[0-9a-f]+$/);
    assert.match(json.state_sha256, /^[0-9a-f]{64}$/);
  });
});
