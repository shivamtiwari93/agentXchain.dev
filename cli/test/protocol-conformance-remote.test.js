import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { verifyProtocolConformance } from '../src/lib/protocol-conformance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');
const BASE_CAPABILITIES = JSON.parse(
  readFileSync(join(REPO_ROOT, '.agentxchain-conformance', 'capabilities.json'), 'utf8')
);

function runCli(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

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

function createRemoteCapabilities(overrides = {}) {
  return {
    ...BASE_CAPABILITIES,
    ...overrides,
    adapter: {
      protocol: 'http-fixture-v1',
      ...(overrides.adapter || {}),
    },
  };
}

function runReferenceFixture(fixture) {
  const adapterPath = join(REPO_ROOT, '.agentxchain-conformance', 'reference-adapter.js');
  const result = spawnSync(process.execPath, [adapterPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: `${JSON.stringify(fixture)}\n`,
  });

  if (result.error) {
    throw result.error;
  }

  return JSON.parse((result.stdout || '').trim());
}

async function withSingleFixtureRoot(relPath, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-remote-fixture-'));
  try {
    const fixture = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    mkdirSync(join(dir, '1', 'state_machine'), { recursive: true });
    writeFileSync(join(dir, '1', 'state_machine', 'fixture.json'), fixture);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function readJsonBody(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : null;
}

async function drainRequest(req) {
  req.resume();
  await once(req, 'end');
}

async function withServer(handler, fn) {
  const server = createServer((req, res) => {
    res.setHeader('Connection', 'close');
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        message: error.message,
      }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('protocol conformance verifier remote mode', () => {
  it('passes Tier 1 self-validation against a remote HTTP adapter', async () => {
    await withServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/conform/capabilities') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(createRemoteCapabilities()));
        return;
      }

      if (req.method === 'POST' && req.url === '/conform/execute') {
        const fixture = await readJsonBody(req);
        const response = runReferenceFixture(fixture);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    }, async (baseUrl) => {
      const result = await runCliAsync(['verify', 'protocol', '--tier', '1', '--remote', baseUrl, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
      assert.equal(report.remote, baseUrl);
      assert.equal(report.target_root, null);
      assert.equal(report.results.tier_1.fixtures_run, 40);
      assert.equal(report.results.tier_1.fixtures_passed, 40);
    });
  });

  it('forwards bearer tokens to both capabilities and execute endpoints', async () => {
    const authHeaders = [];

    await withServer(async (req, res) => {
      authHeaders.push(req.headers.authorization || null);

      if (req.method === 'GET' && req.url === '/conform/capabilities') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(createRemoteCapabilities({
          tiers: [1],
          surfaces: { state_machine: true },
        })));
        return;
      }

      if (req.method === 'POST' && req.url === '/conform/execute') {
        await drainRequest(req);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'not_implemented', message: 'pending' }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    }, async (baseUrl) => {
      await withSingleFixtureRoot('.agentxchain-conformance/fixtures/1/state_machine/SM-001.json', async (fixtureRoot) => {
        const result = await verifyProtocolConformance({
          remote: baseUrl,
          token: 'secret123',
          requestedTier: 1,
          surface: 'state_machine',
          fixtureRoot,
        });

        assert.equal(result.report.overall, 'pass');
        assert.ok(authHeaders.length > 1, 'expected both capabilities and execute requests');
        assert.ok(authHeaders.every((value) => value === 'Bearer secret123'));
      });
    });
  });

  it('rejects specifying both --target and --remote', async () => {
    await withServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(createRemoteCapabilities()));
    }, async (baseUrl) => {
      const result = await runCliAsync([
        'verify',
        'protocol',
        '--target',
        '.',
        '--remote',
        baseUrl,
        '--format',
        'json',
      ]);

      assert.equal(result.status, 2);
      assert.match(result.stdout, /Cannot specify both --target and --remote/);
    });
  });

  it('rejects remote-only flags when --remote is absent', () => {
    const tokenResult = runCli(['verify', 'protocol', '--token', 'secret123', '--format', 'json']);
    assert.equal(tokenResult.status, 2);
    assert.match(tokenResult.stdout, /Cannot specify --token without --remote/);

    const timeoutResult = runCli(['verify', 'protocol', '--timeout', '1000', '--format', 'json']);
    assert.equal(timeoutResult.status, 2);
    assert.match(timeoutResult.stdout, /Cannot specify --timeout without --remote/);
  });

  it('rejects remote targets that do not declare http-fixture-v1', async () => {
    await withServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/conform/capabilities') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(createRemoteCapabilities({
          adapter: {
            protocol: 'stdio-fixture-v1',
            command: ['node', '.agentxchain-conformance/reference-adapter.js'],
          },
        })));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    }, async (baseUrl) => {
      const result = await runCliAsync(['verify', 'protocol', '--remote', baseUrl, '--format', 'json']);
      assert.equal(result.status, 2);
      assert.match(result.stdout, /capabilities\.adapter\.protocol/);
      assert.match(result.stdout, /http-fixture-v1/);
    });
  });

  it('turns remote fixture timeouts into error reports', async () => {
    await withServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/conform/capabilities') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(createRemoteCapabilities({
          tiers: [1],
          surfaces: { state_machine: true },
        })));
        return;
      }

      if (req.method === 'POST' && req.url === '/conform/execute') {
        await drainRequest(req);
        await new Promise((resolve) => setTimeout(resolve, 100));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'pass' }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    }, async (baseUrl) => {
      await withSingleFixtureRoot('.agentxchain-conformance/fixtures/1/state_machine/SM-001.json', async (fixtureRoot) => {
        const result = await verifyProtocolConformance({
          remote: baseUrl,
          timeout: 10,
          requestedTier: 1,
          surface: 'state_machine',
          fixtureRoot,
        });

        assert.equal(result.exitCode, 2);
        assert.equal(result.report.overall, 'error');
        assert.equal(result.report.results.tier_1.fixtures_errored, 1);
        assert.match(result.report.results.tier_1.errors[0].message, /timeout after 10ms/i);
      });
    });
  });
});
