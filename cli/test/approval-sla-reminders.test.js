import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validateNotificationsConfig,
  evaluateApprovalSlaReminders,
  clearSlaReminders,
  VALID_NOTIFICATION_EVENTS,
} from '../src/lib/notification-runner.js';

describe('Approval SLA Reminders', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sla-test-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  // --- Config Validation ---

  describe('Config Validation', () => {
    it('AT-SLA-001: accepts valid approval_sla with ascending integers >= 300', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [300, 3600, 14400, 86400],
        },
      });
      assert.equal(result.ok, true, `Errors: ${result.errors.join(', ')}`);
      assert.equal(result.warnings.length, 0);
    });

    it('AT-SLA-002: rejects non-ascending reminder_after_seconds', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [3600, 1800],
        },
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(e => /strictly ascending/.test(e)));
    });

    it('AT-SLA-003: rejects values below 300', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [60],
        },
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(e => /minimum value is 300/.test(e)));
    });

    it('AT-SLA-004: rejects more than 10 thresholds', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300],
        },
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(e => /maximum 10 thresholds/.test(e)));
    });

    it('AT-SLA-010: warns when no webhook subscribes to approval_sla_reminder', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['run_blocked'],
        }],
        approval_sla: {
          reminder_after_seconds: [3600],
        },
      });
      assert.equal(result.ok, true);
      assert.ok(result.warnings.some(w => /no webhook subscribes/.test(w)));
    });

    it('AT-SLA-009: accepts enabled: false', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          enabled: false,
          reminder_after_seconds: [3600],
        },
      });
      assert.equal(result.ok, true);
    });

    it('rejects empty reminder_after_seconds', () => {
      const result = validateNotificationsConfig({
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [],
        },
      });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(e => /non-empty array/.test(e)));
    });

    it('approval_sla_reminder is a valid notification event', () => {
      assert.ok(VALID_NOTIFICATION_EVENTS.includes('approval_sla_reminder'));
    });
  });

  // --- Evaluator ---

  describe('Evaluator', () => {
    const baseConfig = {
      notifications: {
        webhooks: [{
          name: 'test', url: 'https://example.com', timeout_ms: 5000,
          events: ['approval_sla_reminder'],
        }],
        approval_sla: {
          reminder_after_seconds: [300, 3600],
        },
      },
    };

    it('AT-SLA-005: emits reminder when elapsed time crosses threshold', () => {
      const oneHourAgo = new Date(Date.now() - 3700 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: oneHourAgo,
        },
      };

      const result = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.ok(result.notifications_emitted >= 1);
      assert.ok(result.reminders_sent.includes('pending_phase_transition:300'));
      assert.ok(result.reminders_sent.includes('pending_phase_transition:3600'));
    });

    it('AT-SLA-006: single-fire per threshold — second call does not re-emit', () => {
      const oneHourAgo = new Date(Date.now() - 3700 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: oneHourAgo,
        },
      };

      const first = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.ok(first.notifications_emitted >= 1);

      const second = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.equal(second.notifications_emitted, 0);
      assert.equal(second.reminders_sent.length, 0);
    });

    it('AT-SLA-007: clearSlaReminders clears tracking for resolved approval type', () => {
      const oneHourAgo = new Date(Date.now() - 3700 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: oneHourAgo,
        },
      };

      evaluateApprovalSlaReminders(root, baseConfig, state);
      clearSlaReminders(root, 'pending_phase_transition');

      // After clearing, re-evaluating should emit again
      const result = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.ok(result.notifications_emitted >= 1);
    });

    it('AT-SLA-009: no reminders when enabled is false', () => {
      const disabledConfig = {
        notifications: {
          ...baseConfig.notifications,
          approval_sla: { ...baseConfig.notifications.approval_sla, enabled: false },
        },
      };
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: new Date(Date.now() - 3700 * 1000).toISOString(),
        },
      };

      const result = evaluateApprovalSlaReminders(root, disabledConfig, state);
      assert.equal(result.notifications_emitted, 0);
    });

    it('does not emit when threshold not yet reached', () => {
      const justNow = new Date(Date.now() - 10 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: justNow,
        },
      };

      const result = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.equal(result.notifications_emitted, 0);
    });

    it('handles pending_run_completion', () => {
      const twoHoursAgo = new Date(Date.now() - 7200 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'qa',
        pending_run_completion: {
          gate: 'require_approval',
          requested_at: twoHoursAgo,
        },
      };

      const result = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.ok(result.reminders_sent.includes('pending_run_completion:300'));
      assert.ok(result.reminders_sent.includes('pending_run_completion:3600'));
    });

    it('no-ops when no approval is pending', () => {
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
      };

      const result = evaluateApprovalSlaReminders(root, baseConfig, state);
      assert.equal(result.notifications_emitted, 0);
    });

    it('no-ops when no webhooks subscribe to approval_sla_reminder', () => {
      const noSubConfig = {
        notifications: {
          webhooks: [{
            name: 'test', url: 'https://example.com', timeout_ms: 5000,
            events: ['run_blocked'],
          }],
          approval_sla: { reminder_after_seconds: [300] },
        },
      };
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: new Date(Date.now() - 3700 * 1000).toISOString(),
        },
      };

      const result = evaluateApprovalSlaReminders(root, noSubConfig, state);
      assert.equal(result.notifications_emitted, 0);
    });

    it('writes sla-reminders.json tracking file', () => {
      const oneHourAgo = new Date(Date.now() - 3700 * 1000).toISOString();
      const state = {
        run_id: 'run_1',
        status: 'active',
        phase: 'implementation',
        pending_phase_transition: {
          from: 'implementation', to: 'qa', gate: 'require_approval',
          requested_at: oneHourAgo,
        },
      };

      evaluateApprovalSlaReminders(root, baseConfig, state);
      const trackingPath = join(root, '.agentxchain', 'sla-reminders.json');
      assert.ok(existsSync(trackingPath), 'sla-reminders.json should be created');
      const data = JSON.parse(readFileSync(trackingPath, 'utf8'));
      assert.ok(Array.isArray(data));
      assert.ok(data.includes('pending_phase_transition:300'));
    });
  });
});
