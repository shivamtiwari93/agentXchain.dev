import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readNotificationSnapshot } from '../src/lib/dashboard/notifications-reader.js';
import { render } from '../dashboard/components/notifications.js';

const SPEC_SOURCE = readFileSync(new URL('../../.planning/DASHBOARD_NOTIFICATION_AUDIT_SPEC.md', import.meta.url), 'utf8');

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'axc-notify-dash-'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeRepo(root, notifications = null) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'notify-dash', name: 'Notify Dash', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Build safely.',
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
    },
    gates: {},
    ...(notifications ? { notifications } : {}),
  });
}

function writeAudit(root, entries) {
  const path = join(root, '.agentxchain', 'notification-audit.jsonl');
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

describe('Notifications dashboard spec', () => {
  it('documents the shipped notifications dashboard contract', () => {
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests', '## Open Questions']) {
      assert.ok(SPEC_SOURCE.includes(heading), `spec must include heading ${heading}`);
    }
    assert.match(SPEC_SOURCE, /GET \/api\/notifications/);
    assert.match(SPEC_SOURCE, /Dashboard nav item: `Notifications`/);
  });
});

describe('readNotificationSnapshot', () => {
  it('AT-NOTIFY-DASH-001: returns 404 when config missing', () => {
    const root = tempDir();
    try {
      const result = readNotificationSnapshot(root);
      assert.equal(result.status, 404);
      assert.equal(result.body.code, 'config_missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-NOTIFY-DASH-002: returns configured false with empty summary when notifications are absent', () => {
    const root = tempDir();
    try {
      writeRepo(root);
      const result = readNotificationSnapshot(root);
      assert.equal(result.status, 200);
      assert.equal(result.body.configured, false);
      assert.deepEqual(result.body.webhooks, []);
      assert.deepEqual(result.body.recent, []);
      assert.equal(result.body.summary.total_attempts, 0);
      assert.equal(result.body.summary.failed, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-NOTIFY-DASH-003: returns config summary and newest-first audit rows', () => {
    const root = tempDir();
    try {
      writeRepo(root, {
        webhooks: [
          {
            name: 'ops_webhook',
            url: 'https://ops.example.test/events',
            events: ['run_blocked', 'approval_sla_reminder'],
            timeout_ms: 5000,
          },
        ],
        approval_sla: {
          enabled: true,
          reminder_after_seconds: [3600, 14400],
        },
      });
      writeAudit(root, [
        {
          event_type: 'run_blocked',
          notification_name: 'ops_webhook',
          delivered: true,
          status_code: 202,
          timed_out: false,
          duration_ms: 120,
          message: 'Delivered',
          emitted_at: '2026-04-19T10:00:00.000Z',
        },
        {
          event_type: 'approval_sla_reminder',
          notification_name: 'ops_webhook',
          delivered: false,
          status_code: null,
          timed_out: true,
          duration_ms: 5000,
          message: 'Timed out after 5000ms',
          emitted_at: '2026-04-19T12:00:00.000Z',
        },
      ]);
      const result = readNotificationSnapshot(root);
      assert.equal(result.status, 200);
      assert.equal(result.body.configured, true);
      assert.equal(result.body.webhooks[0].name, 'ops_webhook');
      assert.deepEqual(result.body.approval_sla.reminder_after_seconds, [3600, 14400]);
      assert.equal(result.body.summary.total_attempts, 2);
      assert.equal(result.body.summary.delivered, 1);
      assert.equal(result.body.summary.failed, 1);
      assert.equal(result.body.summary.timed_out, 1);
      assert.equal(result.body.summary.last_failure_at, '2026-04-19T12:00:00.000Z');
      assert.equal(result.body.recent[0].event_type, 'approval_sla_reminder');
      assert.equal(result.body.recent[1].event_type, 'run_blocked');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Notifications dashboard component', () => {
  it('AT-NOTIFY-DASH-004: renders not-configured placeholder when no config and no audit exists', () => {
    const html = render({
      notifications: {
        ok: true,
        configured: false,
        webhooks: [],
        approval_sla: null,
        summary: { total_attempts: 0, delivered: 0, failed: 0, timed_out: 0, last_emitted_at: null, last_failure_at: null },
        recent: [],
      },
    });
    assert.ok(html.includes('No <code>notifications.webhooks</code> are configured'));
  });

  it('AT-NOTIFY-DASH-005: renders recent failures and timeout badges from audit data', () => {
    const html = render({
      notifications: {
        ok: true,
        configured: true,
        webhooks: [
          { name: 'ops_webhook', timeout_ms: 5000, event_count: 2, events: ['run_blocked', 'approval_sla_reminder'] },
        ],
        approval_sla: { enabled: true, reminder_after_seconds: [3600] },
        summary: {
          total_attempts: 2,
          delivered: 1,
          failed: 1,
          timed_out: 1,
          last_emitted_at: '2026-04-19T12:00:00.000Z',
          last_failure_at: '2026-04-19T12:00:00.000Z',
        },
        recent: [
          {
            event_type: 'approval_sla_reminder',
            notification_name: 'ops_webhook',
            delivered: false,
            status_code: null,
            timed_out: true,
            duration_ms: 5000,
            message: 'Timed out after 5000ms',
            emitted_at: '2026-04-19T12:00:00.000Z',
          },
        ],
      },
    });
    assert.ok(html.includes('1 failed'));
    assert.ok(html.includes('1 timed out'));
    assert.ok(html.includes('Notification Targets'));
    assert.ok(html.includes('Recent Delivery Attempts'));
    assert.ok(html.includes('Timed out after 5000ms'));
  });

  it('AT-NOTIFY-DASH-006: shell and bridge expose the Notifications view and API route', () => {
    const appContent = readFileSync(new URL('../dashboard/app.js', import.meta.url), 'utf8');
    const htmlContent = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
    const bridgeContent = readFileSync(new URL('../src/lib/dashboard/bridge-server.js', import.meta.url), 'utf8');
    assert.ok(appContent.includes("notifications: { fetch: ['notifications'], render: renderNotifications }"));
    assert.ok(appContent.includes("notifications: '/api/notifications'"));
    assert.ok(htmlContent.includes('href="#notifications"'));
    assert.ok(bridgeContent.includes("'/api/notifications'"));
  });
});
