import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { NOTIFICATION_AUDIT_PATH, VALID_NOTIFICATION_EVENTS } from '../src/lib/notification-runner.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeProject({ webhookUrl, events = VALID_NOTIFICATION_EVENTS, timeoutMs = 5000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-notify-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Notifications E2E', `notifications-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }

  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  config.notifications = {
    webhooks: [
      {
        name: 'ops_webhook',
        url: webhookUrl,
        events,
        timeout_ms: timeoutMs,
      },
    ],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return { root, projectId: config.project.id };
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout ?? 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readJsonl(root, relPath) {
  const filePath = join(root, relPath);
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function waitFor(predicate, timeoutMs = 5000, intervalMs = 25) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

async function waitForFile(filePath, timeoutMs = 5000) {
  await waitFor(() => existsSync(filePath), timeoutMs, 25);
}

async function createWebhookCollector(root) {
  const portFile = join(root, '.agentxchain', 'webhook-port.txt');
  const requestsFile = join(root, '.agentxchain', 'webhook-requests.jsonl');
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  const serverScript = `
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const [portFile, requestsFile] = process.argv.slice(1);
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    appendFileSync(requestsFile, body + '\\n');
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

  const proc = spawn(process.execPath, ['-e', serverScript, portFile, requestsFile], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  await waitForFile(portFile);
  return {
    url: `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}/events`,
    readRequests: () => readJsonl(root, '.agentxchain/webhook-requests.jsonl'),
    close: () => new Promise((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
    }),
  };
}

async function createUnusedWebhookUrl() {
  const { createServer } = await import('node:http');
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/events`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('notifications E2E', () => {
  it('AT-NOTIFY-010: agentxchain run delivers webhook notifications for the real approval-mediated lifecycle', async () => {
    const { root, projectId } = makeProject({
      webhookUrl: 'http://127.0.0.1:1/placeholder',
      events: ['phase_transition_pending', 'run_completion_pending', 'run_completed'],
    });
    const collector = await createWebhookCollector(root);

    try {
      const configPath = join(root, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.notifications.webhooks[0].url = collector.url;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const run = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
      assert.equal(run.status, 0, `run failed:\n${run.combined}`);
      assert.match(run.stdout, /Run completed/);

      await waitFor(() => collector.readRequests().length === 3);

      const state = readState(root);
      const requests = collector.readRequests();
      assert.deepEqual(
        requests.map((request) => request.event_type),
        ['phase_transition_pending', 'run_completion_pending', 'run_completed'],
      );

      for (const request of requests) {
        assert.equal(request.schema_version, '0.1');
        assert.equal(request.project.id, projectId);
        assert.equal(request.run.run_id, state.run_id);
      }

      assert.equal(requests[0].payload.to, 'implementation');
      assert.equal(requests[1].payload.gate, 'qa_ship_verdict');
      assert.equal(requests[2].payload.completed_via, 'approve_run_completion');

      const audit = readJsonl(root, NOTIFICATION_AUDIT_PATH);
      assert.equal(audit.length, 3);
      assert.ok(audit.every((entry) => entry.delivered === true), 'expected successful audit entries for all lifecycle notifications');
      assert.deepEqual(
        audit.map((entry) => entry.event_type),
        ['phase_transition_pending', 'run_completion_pending', 'run_completed'],
      );
    } finally {
      await collector.close();
    }
  });

  it('AT-NOTIFY-011: resume/escalate emits blocked and escalation webhook payloads on the real CLI path', async () => {
    const { root, projectId } = makeProject({
      webhookUrl: 'http://127.0.0.1:1/placeholder',
      events: ['run_blocked', 'operator_escalation_raised', 'escalation_resolved'],
    });
    const collector = await createWebhookCollector(root);

    try {
      const configPath = join(root, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.notifications.webhooks[0].url = collector.url;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const resume = runCli(root, ['resume']);
      assert.equal(resume.status, 0, `resume failed:\n${resume.combined}`);
      assert.match(resume.stdout, /Turn Assigned/);

      const initialState = readState(root);
      const retainedTurnId = Object.keys(initialState.active_turns || {})[0];
      assert.ok(retainedTurnId, 'resume must create an active turn before escalation');

      const escalate = runCli(root, ['escalate', '--reason', 'Need human decision', '--detail', 'operator review required']);
      assert.equal(escalate.status, 0, `escalate failed:\n${escalate.combined}`);
      assert.match(escalate.stdout, /Run Escalated/);

      const resumeBlocked = runCli(root, ['resume']);
      assert.equal(resumeBlocked.status, 0, `resume after escalation failed:\n${resumeBlocked.combined}`);
      assert.match(resumeBlocked.stdout, /Re-dispatching blocked turn/);

      await waitFor(() => collector.readRequests().length === 3);

      const state = readState(root);
      const requests = collector.readRequests();
      assert.equal(state.run_id, initialState.run_id, 'escalation recovery must stay within the same run');
      assert.equal(state.status, 'active');

      assert.deepEqual(
        requests.map((request) => request.event_type),
        ['run_blocked', 'operator_escalation_raised', 'escalation_resolved'],
      );

      for (const request of requests) {
        assert.equal(request.schema_version, '0.1');
        assert.equal(request.project.id, projectId);
        assert.equal(request.run.run_id, initialState.run_id);
        assert.equal(request.turn.turn_id, retainedTurnId);
      }

      assert.match(requests[0].payload.blocked_on, /^escalation:operator:/);
      assert.equal(requests[1].payload.source, 'operator');
      assert.equal(requests[2].payload.resolved_via, 'resume --turn');

      const audit = readJsonl(root, NOTIFICATION_AUDIT_PATH);
      assert.equal(audit.length, 3);
      assert.ok(audit.every((entry) => entry.delivered === true), 'expected successful audit entries for escalation notifications');
      assert.deepEqual(
        audit.map((entry) => entry.event_type),
        ['run_blocked', 'operator_escalation_raised', 'escalation_resolved'],
      );
    } finally {
      await collector.close();
    }
  });

  it('AT-NOTIFY-012: webhook delivery failures are audited but do not block agentxchain run', async () => {
    const webhookUrl = await createUnusedWebhookUrl();
    const { root } = makeProject({
      webhookUrl,
      events: ['phase_transition_pending', 'run_completion_pending', 'run_completed'],
      timeoutMs: 500,
    });

    const run = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(run.status, 0, `run failed despite webhook outage:\n${run.combined}`);
    assert.match(run.stdout, /Run completed/);

    const state = readState(root);
    assert.equal(state.status, 'completed', 'webhook failures must not block governed execution');

    const audit = readJsonl(root, NOTIFICATION_AUDIT_PATH);
    assert.equal(audit.length, 3);
    assert.deepEqual(
      audit.map((entry) => entry.event_type),
      ['phase_transition_pending', 'run_completion_pending', 'run_completed'],
    );
    assert.ok(audit.every((entry) => entry.delivered === false), 'all deliveries should be marked failed when no webhook listener exists');
    assert.ok(audit.every((entry) => entry.status_code === null), 'connection failures should not fabricate HTTP status codes');
  });
});
