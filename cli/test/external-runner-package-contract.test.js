import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const STARTER_DIR = join(REPO_ROOT, 'examples', 'external-runner-starter');
const STARTER_README = readFileSync(join(STARTER_DIR, 'README.md'), 'utf8');
const STARTER_SCRIPT = readFileSync(join(STARTER_DIR, 'run-one-turn.mjs'), 'utf8');
const BUILD_DOC = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'build-your-own-runner.mdx'), 'utf8');
const INTERFACE_DOC = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'runner-interface.mdx'), 'utf8');
const SPEC = readFileSync(join(REPO_ROOT, '.planning', 'RUNNER_PACKAGE_CONTRACT_SPEC.md'), 'utf8');

const tempRoots = [];

after(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('External runner package contract', () => {
  it('AT-RPC-001: public docs distinguish repo proofs from the installed-package starter', () => {
    assert.match(BUILD_DOC, /examples\/external-runner-starter/);
    assert.match(BUILD_DOC, /repo-native proof surface/i);
    assert.match(INTERFACE_DOC, /External-consumer starter/);
    assert.match(SPEC, /agentxchain\/runner-interface/);
    assert.match(SPEC, /agentxchain\/run-loop/);
  });

  it('AT-RPC-002: starter example uses package exports and install instructions', () => {
    assert.ok(existsSync(join(STARTER_DIR, 'README.md')), 'starter README must exist');
    assert.ok(existsSync(join(STARTER_DIR, 'run-one-turn.mjs')), 'starter script must exist');
    assert.match(STARTER_README, /npm install agentxchain/);
    assert.match(STARTER_SCRIPT, /from 'agentxchain\/runner-interface'/);
    assert.ok(
      !STARTER_SCRIPT.includes('cli/src/lib/runner-interface.js'),
      'starter script must not use repo-relative runner-interface imports',
    );
    assert.ok(
      !STARTER_SCRIPT.includes('agentxchain step'),
      'starter script must not shell out to the CLI',
    );
  });

  it('AT-RPC-003: a clean consumer project can install the packed tarball and run the starter', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-runner-package-'));
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
          name: 'agentxchain-runner-package-contract',
          private: true,
          type: 'module',
        },
        null,
        2,
      ),
    );
    cpSync(join(STARTER_DIR, 'run-one-turn.mjs'), join(consumerDir, 'run-one-turn.mjs'));

    execFileSync('npm', ['install', tarballPath], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 120_000,
    });

    const result = execFileSync('node', ['run-one-turn.mjs', '--json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const json = JSON.parse(result);

    assert.equal(json.result, 'pass');
    assert.equal(json.runner, 'external-runner-starter');
    assert.equal(json.final_status, 'active');
    assert.match(json.runner_interface_version, /^[0-9]+\.[0-9]+$/);
    assert.match(json.run_id, /^run_[0-9a-f]+$/);
    assert.match(json.turn_id, /^turn_[0-9a-f]+$/);
    assert.match(json.state_sha256, /^[0-9a-f]{64}$/);
  });
});
