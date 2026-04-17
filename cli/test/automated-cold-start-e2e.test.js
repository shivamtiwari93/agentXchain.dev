import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const MOCK_AGENT = join(__dirname, '..', 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('automated cold-start onboarding', () => {
  it('AT-AUTO-COLD-001: init -> doctor -> connector check -> connector validate -> run completes with a spaced-path wrapper agent', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-auto-cold-'));
    tempDirs.push(root);

    const fixturesDir = join(root, 'agent fixtures');
    mkdirSync(fixturesDir, { recursive: true });
    const wrapperAgent = join(fixturesDir, 'mock-wrapper.mjs');
    writeFileSync(wrapperAgent, `import ${JSON.stringify(pathToFileURL(MOCK_AGENT).href)};\n`);

    const init = runCli(root, [
      'init',
      '--governed',
      '--dir', 'project',
      '--goal', 'Automated cold-start onboarding proof',
      '--dev-command', 'node', wrapperAgent,
      '--dev-prompt-transport', 'dispatch_bundle_only',
      '--yes',
    ]);
    assert.equal(init.status, 0, init.stderr);

    const projectRoot = join(root, 'project');
    const configPath = join(projectRoot, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(config.runtimes['local-dev'].command, ['node', wrapperAgent]);

    const automatedRuntime = {
      type: 'local_cli',
      command: ['node', wrapperAgent],
      cwd: '.',
      prompt_transport: 'dispatch_bundle_only',
    };
    config.runtimes['manual-pm'] = automatedRuntime;
    config.runtimes['manual-qa'] = automatedRuntime;
    config.runtimes['manual-director'] = automatedRuntime;
    config.roles.pm.runtime = 'manual-pm';
    config.roles.pm.write_authority = 'authoritative';
    config.roles.qa.runtime = 'manual-qa';
    config.roles.qa.write_authority = 'authoritative';
    config.roles.eng_director.runtime = 'manual-director';
    config.roles.eng_director.write_authority = 'authoritative';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const doctor = runCli(projectRoot, ['doctor', '--json']);
    assert.equal(doctor.status, 0, doctor.stdout);
    const doctorOutput = JSON.parse(doctor.stdout);
    assert.equal(doctorOutput.overall, 'pass');

    const check = runCli(projectRoot, ['connector', 'check', '--json']);
    assert.equal(check.status, 0, check.stdout);
    const checkOutput = JSON.parse(check.stdout);
    assert.equal(checkOutput.overall, 'pass');
    assert.ok(checkOutput.connectors.length >= 4, 'expected all automated runtimes to be probed');

    const validate = runCli(projectRoot, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(validate.status, 0, validate.stdout);
    const validateOutput = JSON.parse(validate.stdout);
    assert.equal(validateOutput.overall, 'pass');
    assert.equal(validateOutput.validation.ok, true);

    const dryRun = runCli(projectRoot, ['run', '--dry-run']);
    assert.equal(dryRun.status, 0, dryRun.stdout);
    assert.match(dryRun.stdout, /✓ pm → local_cli/);
    assert.match(dryRun.stdout, /✓ dev → local_cli/);
    assert.match(dryRun.stdout, /✓ qa → local_cli/);

    const run = runCli(projectRoot, ['run', '--auto-approve', '--max-turns', '6']);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /Run completed/);
    assert.match(run.stdout, /Turns:\s+3/);

    const state = JSON.parse(readFileSync(join(projectRoot, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.status, 'completed');
    assert.ok(existsSync(join(projectRoot, '.planning', 'PM_SIGNOFF.md')));
    assert.ok(existsSync(join(projectRoot, '.planning', 'IMPLEMENTATION_NOTES.md')));
    assert.ok(existsSync(join(projectRoot, '.planning', 'ship-verdict.md')));
  });
});
