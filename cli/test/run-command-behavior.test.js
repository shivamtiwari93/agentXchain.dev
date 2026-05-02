import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

const tempDirs = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-cmd-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Command Test', 'run-command-test');
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('agentxchain run CLI behavior', () => {
  it('exits non-zero for an unknown --role override in dry-run mode', () => {
    const root = makeProject();
    const result = runCli(root, ['run', '--dry-run', '--role', 'ghost']);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Unknown role: "ghost"/);
  });

  it('uses routing.entry_role for dry-run first-role selection', () => {
    const root = makeProject();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    config.roles = {
      qa: config.roles.qa,
      pm: config.roles.pm,
      dev: config.roles.dev,
      eng_director: config.roles.eng_director,
    };
    config.routing = {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'eng_director', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: config.routing.implementation,
      qa: config.routing.qa,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = runCli(root, ['run', '--dry-run']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /First role:\s+pm/);
    assert.doesNotMatch(result.stdout, /First role:\s+qa/);
  });
});
