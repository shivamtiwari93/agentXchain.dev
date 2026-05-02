/**
 * AT-STEP-APIPROXY-INT-001
 *
 * Focused integration proof for the `agentxchain step` missing-credentials
 * recovery path. The command must surface the built-in manual QA fallback
 * using normalized config only.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

const tempDirs = [];
const servers = [];

function startMockAnthropicServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];

    const server = createServer((req, res) => {
      requestLog.push({
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString(),
      });
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      servers.push(server);
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, requestLog });
    });

    server.on('error', reject);
  });
}

function makeProject(mockServerUrl) {
  const root = mkdtempSync(join(tmpdir(), 'axc-step-apiproxy-int-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Step API Proxy Integration Test', `step-apiproxy-int-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.runtimes['api-qa'] = {
    type: 'api_proxy',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    auth_env: 'MOCK_ANTHROPIC_KEY',
    base_url: mockServerUrl,
    max_output_tokens: 4096,
    timeout_seconds: 30,
    retry_policy: { max_attempts: 1 },
  };
  config.roles.qa.write_authority = 'review_only';
  config.roles.qa.runtime = 'api-qa';
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.phase = 'qa';
  state.run_id = `run_${Date.now()}`;
  state.status = 'active';
  state.phase_gate_status = {
    planning_signoff: 'passed',
    implementation_complete: 'passed',
    qa_ship_verdict: 'pending',
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  return root;
}

function runCliAsync(root, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        MOCK_ANTHROPIC_KEY: 'test-key-for-mock-server',
        ...(opts.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${opts.timeout || 60000}ms`));
    }, opts.timeout || 60000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('agentxchain step api_proxy integration', () => {
  it('AT-STEP-APIPROXY-INT-001: missing api key prints the built-in manual QA fallback', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const result = await runCliAsync(root, ['step', '--role', 'qa'], {
      env: { MOCK_ANTHROPIC_KEY: '' },
    });

    assert.equal(result.status, 1, 'Missing QA credentials should stop step with a non-zero exit');
    assert.equal(mock.requestLog.length, 0, 'No request should reach the server when credentials are missing');

    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('MOCK_ANTHROPIC_KEY') || combined.includes('not set'),
      'Output should mention the missing credential'
    );
    assert.match(combined, /manual-qa/, 'step output must name the built-in QA fallback');
    assert.match(combined, /roles\.qa\.runtime/, 'step output must name the exact config edit');
    assert.match(combined, /agentxchain step --resume/, 'step output must give the truthful recovery command');
    assert.match(combined, /https:\/\/agentxchain\.dev\/docs\/getting-started/, 'step output must link the getting-started guide');
  });
});
