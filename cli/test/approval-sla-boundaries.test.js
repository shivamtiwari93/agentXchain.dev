import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runLoop } from '../src/lib/run-loop.js';
import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { loadProjectContext } from '../src/lib/config.js';

const CLI_BIN = join(import.meta.dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readNotificationAudit(root) {
  const filePath = join(root, '.agentxchain', 'notification-audit.jsonl');
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createGovernedApprovalFixture() {
  const root = mkdtempSync(join(tmpdir(), 'approval-sla-boundary-'));
  const agentxchainDir = join(root, '.agentxchain');
  const dashboardDir = join(root, 'dashboard');
  mkdirSync(agentxchainDir, { recursive: true });
  mkdirSync(dashboardDir, { recursive: true });
  writeFileSync(join(dashboardDir, 'index.html'), '<html><body>Dashboard</body></html>');

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'approval-sla-boundary',
      name: 'Approval SLA Boundary',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    notifications: {
      webhooks: [
        {
          name: 'ops_webhook',
          url: 'http://127.0.0.1:9/webhook',
          events: ['approval_sla_reminder'],
          timeout_ms: 250,
        },
      ],
      approval_sla: {
        reminder_after_seconds: [300],
      },
    },
  });

  writeJson(join(agentxchainDir, 'state.json'), {
    schema_version: '1.0',
    project_id: 'approval-sla-boundary',
    run_id: 'run_sla_boundary',
    status: 'paused',
    phase: 'implementation',
    current_turn: null,
    last_completed_turn_id: 'turn_001',
    blocked_on: null,
    blocked_reason: null,
    pending_phase_transition: {
      from: 'implementation',
      to: 'qa',
      gate: 'require_approval',
      requested_by_turn: 'turn_001',
      requested_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    pending_run_completion: null,
  });

  return { root, agentxchainDir, dashboardDir };
}

const cleanupPaths = [];
const cleanupBridges = [];

afterEach(async () => {
  while (cleanupBridges.length) {
    await cleanupBridges.pop().stop();
  }

  while (cleanupPaths.length) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe('Approval SLA lazy evaluation boundaries', () => {
  it('AT-SLA-011: step fires due approval SLA reminders before exiting on a pending approval', async () => {
    const fixture = createGovernedApprovalFixture();
    cleanupPaths.push(fixture.root);

    const result = spawnSync(process.execPath, [CLI_BIN, 'step'], {
      cwd: fixture.root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /awaiting approval/i);
    const audit = readNotificationAudit(fixture.root);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].event_type, 'approval_sla_reminder');
    assert.ok(existsSync(join(fixture.root, '.agentxchain', 'sla-reminders.json')));
  });

  it('AT-SLA-012: runLoop fires due approval SLA reminders when it encounters a pending gate', async () => {
    const fixture = createGovernedApprovalFixture();
    cleanupPaths.push(fixture.root);

    const context = loadProjectContext(fixture.root);
    assert.ok(context, 'fixture must load through the real project-context path');

    const result = await runLoop(context.root, context.config, {
      selectRole() {
        return 'dev';
      },
      async dispatch() {
        throw new Error('dispatch should not run while a gate is already pending');
      },
      async approveGate() {
        return false;
      },
    }, { maxTurns: 1 });

    assert.equal(result.ok, false);
    assert.equal(result.stop_reason, 'gate_held');
    const audit = readNotificationAudit(fixture.root);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].event_type, 'approval_sla_reminder');
  });

  it('AT-DPOLL-001: dashboard /api/poll evaluates due approval SLA reminders exactly once per threshold', async () => {
    const fixture = createGovernedApprovalFixture();
    cleanupPaths.push(fixture.root);

    const bridge = createBridgeServer({
      agentxchainDir: fixture.agentxchainDir,
      dashboardDir: fixture.dashboardDir,
      port: 0,
    });
    cleanupBridges.push(bridge);

    const { port } = await bridge.start();

    const first = await fetch(`http://127.0.0.1:${port}/api/poll`);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.replay_mode, false);
    assert.equal(firstBody.governed_project_detected, true);
    assert.equal(firstBody.state_available, true);
    assert.equal(firstBody.reminder_evaluation.notifications_emitted, 1);
    assert.deepEqual(firstBody.reminder_evaluation.reminders_sent, ['pending_phase_transition:300']);
    const firstAudit = readNotificationAudit(fixture.root);
    assert.equal(firstAudit.length, 1);
    assert.equal(firstAudit[0].event_type, 'approval_sla_reminder');

    const second = await fetch(`http://127.0.0.1:${port}/api/poll`);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.reminder_evaluation.notifications_emitted, 0);
    assert.deepEqual(secondBody.reminder_evaluation.reminders_sent, []);
    const secondAudit = readNotificationAudit(fixture.root);
    assert.equal(secondAudit.length, 1);
  });
});
