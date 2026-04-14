import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const DASHBOARD_PID_FILE = '.agentxchain-dashboard.pid';
const DASHBOARD_SESSION_FILE = '.agentxchain-dashboard.json';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentxchain-dash-cmd-'));
}

describe('dashboard command — CLI surface', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      const pidPath = join(tmpDir, DASHBOARD_PID_FILE);
      if (existsSync(pidPath)) {
        const pid = Number(readFileSync(pidPath, 'utf8').trim());
        if (Number.isFinite(pid)) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
      }
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
    assert.ok(result.stdout.includes('--daemon'), 'should show --daemon option');
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
    const pidPath = join(tmpDir, DASHBOARD_PID_FILE);
    const sessionPath = join(tmpDir, DASHBOARD_SESSION_FILE);
    assert.ok(existsSync(pidPath), 'foreground dashboard should write a PID file');
    assert.ok(existsSync(sessionPath), 'foreground dashboard should write a session file');

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
    assert.equal(existsSync(pidPath), false, 'foreground shutdown should remove the PID file');
    assert.equal(existsSync(sessionPath), false, 'foreground shutdown should remove the session file');
  });

  it('daemon mode prints PID and URL and leaves a live dashboard session behind', async () => {
    tmpDir = createTempDir();
    const agentxchainDir = join(tmpDir, '.agentxchain');
    mkdirSync(agentxchainDir, { recursive: true });
    writeFileSync(join(agentxchainDir, 'state.json'), JSON.stringify({
      schema_version: '1.0',
      status: 'idle',
    }));

    const port = 31000 + Math.floor(Math.random() * 10000);
    const result = spawnSync('node', [CLI_BIN, 'dashboard', '--daemon', '--port', String(port), '--no-open'], {
      cwd: tmpDir,
      timeout: 15000,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Dashboard started in daemon mode at http:\/\/localhost:/);
    assert.match(result.stdout, /PID: \d+/);

    const pidPath = join(tmpDir, DASHBOARD_PID_FILE);
    const sessionPath = join(tmpDir, DASHBOARD_SESSION_FILE);
    assert.ok(existsSync(pidPath), 'daemon dashboard should write a PID file');
    assert.ok(existsSync(sessionPath), 'daemon dashboard should write a session file');

    const pid = Number(readFileSync(pidPath, 'utf8').trim());
    assert.ok(Number.isFinite(pid), 'PID file should contain a real PID');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    assert.equal(session.pid, pid);
    assert.equal(session.port, port);
    assert.equal(session.url, `http://localhost:${port}`);
    assert.ok(session.started_at, 'session file should record started_at');

    const response = await new Promise((resolve, reject) => {
      const req = http.get(session.url, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.includes('AgentXchain'));
  });

  it('daemon mode fails closed when a live dashboard session already exists', () => {
    tmpDir = createTempDir();
    const agentxchainDir = join(tmpDir, '.agentxchain');
    mkdirSync(agentxchainDir, { recursive: true });
    writeFileSync(join(agentxchainDir, 'state.json'), JSON.stringify({
      schema_version: '1.0',
      status: 'idle',
    }));

    const port = 32000 + Math.floor(Math.random() * 10000);
    const first = spawnSync('node', [CLI_BIN, 'dashboard', '--daemon', '--port', String(port), '--no-open'], {
      cwd: tmpDir,
      timeout: 15000,
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const second = spawnSync('node', [CLI_BIN, 'dashboard', '--daemon', '--port', String(port), '--no-open'], {
      cwd: tmpDir,
      timeout: 15000,
      encoding: 'utf8',
    });
    assert.notEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stderr, /Dashboard already running/);
  });
});
