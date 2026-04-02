import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentxchain-dash-cmd-'));
}

describe('dashboard command — CLI surface', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      tmpDir = null;
    }
  });

  it('exits with error when .agentxchain/ does not exist', () => {
    tmpDir = createTempDir();
    const result = spawnSync('node', [CLI_BIN, 'dashboard', '--no-open'], {
      cwd: tmpDir,
      timeout: 10000,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'should exit non-zero');
    assert.ok(
      result.stderr.includes('.agentxchain') || result.stderr.includes('No .agentxchain'),
      `stderr should mention missing .agentxchain/: ${result.stderr}`
    );
  });

  it('appears in --help output', () => {
    const result = spawnSync('node', [CLI_BIN, '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('dashboard'), '--help should list dashboard command');
  });

  it('dashboard --help shows port and no-open options', () => {
    const result = spawnSync('node', [CLI_BIN, 'dashboard', '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('--port'), 'should show --port option');
    assert.ok(result.stdout.includes('--no-open'), 'should show --no-open option');
  });

  it('starts and serves on the specified port with a governed project', async () => {
    tmpDir = createTempDir();
    const agentxchainDir = join(tmpDir, '.agentxchain');
    mkdirSync(agentxchainDir, { recursive: true });
    writeFileSync(join(agentxchainDir, 'state.json'), JSON.stringify({
      schema_version: '1.0',
      status: 'idle',
    }));

    const port = 30000 + Math.floor(Math.random() * 10000);
    const child = spawn('node', [CLI_BIN, 'dashboard', '--port', String(port), '--no-open'], {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for "Dashboard running at" in stdout
    const started = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Dashboard did not start within timeout. Output: ${output}`));
      }, 8000);

      child.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('Dashboard running at')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
      child.stderr.on('data', (data) => {
        output += data.toString();
      });
      child.on('exit', () => {
        clearTimeout(timeout);
        reject(new Error(`Dashboard exited early. Output: ${output}`));
      });
    });

    assert.ok(started, 'dashboard should start');

    // Verify it serves HTTP on the port
    const response = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });

    assert.equal(response.status, 200, 'should serve 200 on root');
    assert.ok(response.body.includes('AgentXchain'), 'should serve dashboard HTML');

    // Verify API endpoint
    const apiResponse = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/state`, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });

    assert.equal(apiResponse.status, 200, 'should serve state API');
    const state = JSON.parse(apiResponse.body);
    assert.equal(state.schema_version, '1.0');

    // Verify mutation is rejected
    const putResponse = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}/api/state`, { method: 'PUT' }, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
      req.end('{}');
    });

    assert.equal(putResponse.status, 405, 'should reject PUT with 405');

    // Clean shutdown
    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));
  });
});
