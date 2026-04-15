import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { verifyProtocolConformance } from '../src/lib/protocol-conformance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'remote-conformance-server');
const SERVER_PATH = join(EXAMPLE_DIR, 'server.js');
const README_PATH = join(EXAMPLE_DIR, 'README.md');

let childProcesses = [];

afterEach(() => {
  for (const child of childProcesses) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
  childProcesses = [];
});

function runCliAsync(args, cwd = REPO_ROOT) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectRun);
    child.on('close', (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

function startServer(extraEnv = {}) {
  return new Promise((resolveStart, rejectStart) => {
    const port = 10000 + Math.floor(Math.random() * 50000);
    const child = spawn(process.execPath, [SERVER_PATH, '--port', String(port)], {
      cwd: EXAMPLE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    childProcesses.push(child);

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      rejectStart(new Error(`Server did not start within 10s.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('listening on')) {
        clearTimeout(timeout);
        resolveStart({
          baseUrl: `http://127.0.0.1:${port}`,
          child,
          stdout,
        });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectStart(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!stdout.includes('listening on')) {
        rejectStart(new Error(`Server exited early with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
  });
}

async function withSingleFixtureRoot(relPath, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-remote-example-fixture-'));
  try {
    const fixture = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    mkdirSync(join(dir, '1', 'state_machine'), { recursive: true });
    writeFileSync(join(dir, '1', 'state_machine', 'fixture.json'), fixture);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('remote conformance server example contract', () => {
  it('ships the example files and README contract', () => {
    assert.ok(existsSync(SERVER_PATH), 'server.js must exist');
    assert.ok(existsSync(README_PATH), 'README.md must exist');

    const readme = readFileSync(README_PATH, 'utf8');
    assert.match(readme, /GET \/conform\/capabilities/);
    assert.match(readme, /POST \/conform\/execute/);
    assert.match(readme, /CONFORMANCE_TOKEN/);
    assert.match(readme, /agentxchain verify protocol --tier 1 --remote/);
  });

  it('serves truthful http-fixture-v1 capabilities without adapter.command', async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/conform/capabilities`);
    assert.equal(response.status, 200);

    const capabilities = await response.json();
    assert.equal(capabilities.adapter.protocol, 'http-fixture-v1');
    assert.equal('command' in capabilities.adapter, false);
    assert.equal(capabilities.implementation, 'agentxchain-reference-http-example');
  });

  it('passes Tier 1 remote verification through the CLI', async () => {
    const { baseUrl } = await startServer();
    const result = await runCliAsync([
      'verify',
      'protocol',
      '--tier',
      '1',
      '--remote',
      baseUrl,
      '--format',
      'json',
    ]);

    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.remote, baseUrl);
    assert.equal(report.target_root, null);
    assert.equal(report.results.tier_1.fixtures_run, 71);
    assert.equal(report.results.tier_1.fixtures_passed, 71);
  });

  it('enforces optional bearer auth and still verifies successfully when token is provided', async () => {
    const { baseUrl } = await startServer({ CONFORMANCE_TOKEN: 'secret123' });

    const unauthorized = await fetch(`${baseUrl}/conform/capabilities`);
    assert.equal(unauthorized.status, 401);

    await withSingleFixtureRoot('.agentxchain-conformance/fixtures/1/state_machine/SM-001.json', async (fixtureRoot) => {
      const result = await verifyProtocolConformance({
        remote: baseUrl,
        token: 'secret123',
        requestedTier: 1,
        surface: 'state_machine',
        fixtureRoot,
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.report.overall, 'pass');
      assert.equal(result.report.remote, baseUrl);
    });
  });
});
