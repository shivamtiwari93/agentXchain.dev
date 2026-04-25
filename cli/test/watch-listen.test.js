import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDirs = new Set();

// Import the listener directly so we can test the HTTP surface without spawning a child CLI
const { startWebhookListener } = await import('../src/lib/watch-listener.js');

function createProject(extraConfig = {}) {
  const dir = join(tmpdir(), `agentxchain-watch-listen-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'watch-listen-test', name: 'Watch Listen Test' },
    roles: [
      { id: 'pm', title: 'PM', mandate: 'Plan work' },
      { id: 'dev', title: 'Dev', mandate: 'Build work' },
      { id: 'qa', title: 'QA', mandate: 'Verify work' },
    ],
    ...extraConfig,
  }, null, 2));
  return dir;
}

function githubPrOpened() {
  return {
    action: 'opened',
    repository: { full_name: 'acme/widgets' },
    pull_request: {
      number: 42,
      title: 'Add governed review',
      html_url: 'https://github.com/acme/widgets/pull/42',
      head: { ref: 'feature/review', sha: 'abc123' },
      base: { ref: 'main' },
      draft: false,
    },
  };
}

function signPayload(body, secret) {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${sig}`;
}

function httpRequest(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (body !== undefined && body !== null) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

// Find a free port by binding to 0 and reading the assigned port
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain watch --listen', () => {
  it('AT-WATCH-LISTEN-001: valid signed GitHub PR event records event and returns watch result', async () => {
    const secret = 'test-secret-001';
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret, allowUnsigned: false });

    try {
      const body = JSON.stringify(githubPrOpened());
      const sig = signPayload(body, secret);
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-Hub-Signature-256': sig,
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': 'delivery-001',
      });

      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.raw}`);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.result_id, 'should have result_id');
      assert.ok(res.body.event_id, 'should have event_id');
      assert.ok(res.body.intent_id, 'should have intent_id');
      assert.equal(res.body.delivery_id, 'delivery-001');

      // Verify watch result file on disk
      const resultsDir = join(dir, '.agentxchain', 'watch-results');
      assert.ok(existsSync(resultsDir), 'watch-results dir should exist');
      const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json'));
      assert.equal(files.length, 1, 'should have exactly one result file');
      const record = JSON.parse(readFileSync(join(resultsDir, files[0]), 'utf8'));
      assert.equal(record.delivery_id, 'delivery-001');
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-002: invalid HMAC signature returns 401', async () => {
    const secret = 'test-secret-002';
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes('signature'));

      // No event recorded
      const resultsDir = join(dir, '.agentxchain', 'watch-results');
      assert.ok(!existsSync(resultsDir), 'no watch-results should be written');
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-003: missing X-Hub-Signature-256 with configured secret returns 401', async () => {
    const secret = 'test-secret-003';
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-004: no secret and no --allow-unsigned returns 403', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: false });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes('webhook secret required'));
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-005: --allow-unsigned accepts unsigned payloads', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.event_id);
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-006: oversized body returns 413', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      // Create a body larger than 1MB
      const bigBody = '{"data":"' + 'x'.repeat(1_100_000) + '"}';
      const res = await httpRequest(port, 'POST', '/webhook', bigBody, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 413);
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-007: malformed JSON returns 400', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const res = await httpRequest(port, 'POST', '/webhook', '{not valid json}', {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes('invalid JSON'));
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-008: non-JSON content type returns 415', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const res = await httpRequest(port, 'POST', '/webhook', 'plain text', {
        'Content-Type': 'text/plain',
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 415);
      assert.equal(res.body.ok, false);
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-009: GET /health returns status with uptime and event count', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const res = await httpRequest(port, 'GET', '/health', null, {});

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(typeof res.body.uptime_ms, 'number');
      assert.equal(res.body.events_processed, 0);

      const invalid = await httpRequest(port, 'POST', '/webhook', '{not valid json}', {
        'X-GitHub-Event': 'pull_request',
      });
      assert.equal(invalid.status, 400);

      const afterInvalid = await httpRequest(port, 'GET', '/health', null, {});
      assert.equal(afterInvalid.body.events_processed, 0, 'rejected webhook deliveries must not increment health counter');

      const valid = await httpRequest(port, 'POST', '/webhook', JSON.stringify(githubPrOpened()), {
        'X-GitHub-Event': 'pull_request',
      });
      assert.equal(valid.status, 200);

      const afterValid = await httpRequest(port, 'GET', '/health', null, {});
      assert.equal(afterValid.body.events_processed, 1);
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-010: --dry-run returns normalized payload without persisting', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true, dryRun: true });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.dry_run, true);
      assert.ok(res.body.payload);
      assert.equal(res.body.payload.category, 'github_pull_request_opened');

      // No intake files or watch results should exist
      const resultsDir = join(dir, '.agentxchain', 'watch-results');
      assert.ok(!existsSync(resultsDir), 'no watch-results should be written in dry-run');
      const intakeDir = join(dir, '.agentxchain', 'intake');
      assert.ok(!existsSync(intakeDir), 'no intake files should be written in dry-run');
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-011: route matching applies auto_approve from config', async () => {
    const dir = createProject({
      watch: {
        routes: [
          {
            match: { category: 'github_pull_request_opened' },
            triage: {
              priority: 'p1',
              template: 'generic',
              charter: 'Review PR #{{number}}',
              acceptance_contract: ['PR reviewed'],
            },
            auto_approve: true,
            preferred_role: 'qa',
          },
        ],
      },
    });
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const body = JSON.stringify(githubPrOpened());
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.route.matched, true);
      assert.equal(res.body.route.approved, true);
      assert.equal(res.body.route.preferred_role, 'qa');
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-012: X-GitHub-Event header constructs envelope for raw payloads', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      // Send raw GitHub payload without provider/event envelope
      const payload = githubPrOpened();
      const body = JSON.stringify(payload);
      const res = await httpRequest(port, 'POST', '/webhook', body, {
        'X-GitHub-Event': 'pull_request',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.intent_id, 'should create an intent from X-GitHub-Event header');
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-013: unsupported event shape returns 422', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      const body = JSON.stringify({ random: 'data', nothing: 'useful' });
      const res = await httpRequest(port, 'POST', '/webhook', body);

      assert.equal(res.status, 422);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes('unsupported'));
    } finally {
      server.close();
    }
  });

  it('AT-WATCH-LISTEN-014: 404 for unknown paths and 405 for wrong method', async () => {
    const dir = createProject();
    const port = await getFreePort();
    const server = await startWebhookListener({ root: dir, port, secret: null, allowUnsigned: true });

    try {
      // Unknown path
      const res404 = await httpRequest(port, 'GET', '/unknown', null, {});
      assert.equal(res404.status, 404);

      // GET on webhook (should be POST)
      const res405 = await httpRequest(port, 'GET', '/webhook', null, {});
      assert.equal(res405.status, 405);

      // POST on health (should be GET)
      const res405b = await httpRequest(port, 'POST', '/health', '{}');
      assert.equal(res405b.status, 405);
    } finally {
      server.close();
    }
  });
});
