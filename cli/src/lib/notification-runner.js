import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { interpolateHeaders } from './hook-runner.js';

export const NOTIFICATION_AUDIT_PATH = '.agentxchain/notification-audit.jsonl';
export const VALID_NOTIFICATION_EVENTS = [
  'run_blocked',
  'operator_escalation_raised',
  'escalation_resolved',
  'phase_transition_pending',
  'run_completion_pending',
  'run_completed',
  'approval_sla_reminder',
];

const NOTIFICATION_NAME_RE = /^[a-z0-9_-]+$/;
const MAX_NOTIFICATION_WEBHOOKS = 8;
const HEADER_VAR_RE = /\$\{([^}]+)\}/g;
const SIGKILL_GRACE_MS = 2000;
const MAX_STDERR_CAPTURE = 4096;

function collectMissingHeaderVars(headers, webhookEnv) {
  if (!headers) return [];
  const missing = [];
  const mergedEnv = { ...process.env };

  for (const [key, value] of Object.entries(webhookEnv || {})) {
    if (typeof value === 'string') {
      mergedEnv[key] = value;
    }
  }

  for (const [headerName, value] of Object.entries(headers)) {
    let match;
    while ((match = HEADER_VAR_RE.exec(value)) !== null) {
      if (mergedEnv[match[1]] === undefined) {
        missing.push({ header: headerName, varName: match[1] });
      }
    }
    HEADER_VAR_RE.lastIndex = 0;
  }

  return missing;
}

function appendAudit(root, entry) {
  const filePath = join(root, NOTIFICATION_AUDIT_PATH);
  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function generateEventId() {
  return `notif_${randomBytes(8).toString('hex')}`;
}

function executeWebhook(webhook, envelope) {
  const startedAt = Date.now();
  let headers;

  try {
    headers = interpolateHeaders(webhook.headers, webhook.env);
  } catch (error) {
    return {
      delivered: false,
      timed_out: false,
      status_code: null,
      duration_ms: Date.now() - startedAt,
      message: String(error?.message || error),
      stderr_excerpt: String(error?.message || error).slice(0, MAX_STDERR_CAPTURE),
    };
  }

  headers['Content-Type'] = 'application/json';

  const script = `
const url = process.argv[1];
const body = process.argv[2];
const headers = JSON.parse(process.argv[3]);
headers.Connection = 'close';
(async () => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(${webhook.timeout_ms}),
    });
    const text = await response.text();
    process.stdout.write(JSON.stringify({ status: response.status, body: text }));
    process.exit(0);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      process.stderr.write('timeout');
      process.exit(2);
    }
    process.stderr.write(error?.message || String(error));
    process.exit(1);
  }
})();
`;

  const result = spawnSync(process.execPath, ['-e', script, webhook.url, JSON.stringify(envelope), JSON.stringify(headers)], {
    timeout: webhook.timeout_ms + SIGKILL_GRACE_MS,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(webhook.env || {}) },
  });

  const durationMs = Date.now() - startedAt;
  const timedOut = result.error?.code === 'ETIMEDOUT' || durationMs > webhook.timeout_ms;
  const stdout = result.stdout ? result.stdout.toString('utf8') : '';
  const stderr = result.stderr ? result.stderr.toString('utf8').slice(0, MAX_STDERR_CAPTURE) : '';

  if (timedOut) {
    return {
      delivered: false,
      timed_out: true,
      status_code: null,
      duration_ms: durationMs,
      message: `Timed out after ${webhook.timeout_ms}ms`,
      stderr_excerpt: stderr,
    };
  }

  if (result.status !== 0) {
    return {
      delivered: false,
      timed_out: false,
      status_code: null,
      duration_ms: durationMs,
      message: stderr || `Webhook delivery failed with exit code ${result.status}`,
      stderr_excerpt: stderr,
    };
  }

  try {
    const bridge = JSON.parse(stdout || '{}');
    const statusCode = Number.isInteger(bridge.status) ? bridge.status : null;
    const delivered = statusCode >= 200 && statusCode < 300;
    return {
      delivered,
      timed_out: false,
      status_code: statusCode,
      duration_ms: durationMs,
      message: delivered ? 'Delivered' : `Webhook returned HTTP ${statusCode}`,
      stderr_excerpt: stderr,
    };
  } catch {
    return {
      delivered: false,
      timed_out: false,
      status_code: null,
      duration_ms: durationMs,
      message: 'Failed to parse webhook bridge response',
      stderr_excerpt: stderr || stdout.slice(0, MAX_STDERR_CAPTURE),
    };
  }
}

export function validateNotificationsConfig(notifications) {
  const errors = [];

  if (!notifications || typeof notifications !== 'object' || Array.isArray(notifications)) {
    errors.push('notifications must be an object');
    return { ok: false, errors, warnings: [] };
  }

  const allowedKeys = new Set(['webhooks', 'approval_sla']);
  for (const key of Object.keys(notifications)) {
    if (!allowedKeys.has(key)) {
      errors.push(`notifications contains unknown field "${key}"`);
    }
  }

  if (!('webhooks' in notifications)) {
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  if (!Array.isArray(notifications.webhooks)) {
    errors.push('notifications.webhooks must be an array');
    return { ok: false, errors, warnings: [] };
  }

  if (notifications.webhooks.length > MAX_NOTIFICATION_WEBHOOKS) {
    errors.push(`notifications.webhooks: maximum ${MAX_NOTIFICATION_WEBHOOKS} webhooks`);
  }

  const names = new Set();
  notifications.webhooks.forEach((webhook, index) => {
    const label = `notifications.webhooks[${index}]`;

    if (!webhook || typeof webhook !== 'object' || Array.isArray(webhook)) {
      errors.push(`${label} must be an object`);
      return;
    }

    if (typeof webhook.name !== 'string' || !webhook.name.trim()) {
      errors.push(`${label}: name must be a non-empty string`);
    } else if (!NOTIFICATION_NAME_RE.test(webhook.name)) {
      errors.push(`${label}: name must match ^[a-z0-9_-]+$`);
    } else if (names.has(webhook.name)) {
      errors.push(`${label}: duplicate webhook name "${webhook.name}"`);
    } else {
      names.add(webhook.name);
    }

    if (typeof webhook.url !== 'string' || !webhook.url.trim()) {
      errors.push(`${label}: url must be a non-empty string`);
    } else if (!/^https?:\/\/.+/.test(webhook.url)) {
      errors.push(`${label}: url must be a valid HTTP or HTTPS URL`);
    }

    if (!Array.isArray(webhook.events) || webhook.events.length === 0) {
      errors.push(`${label}: events must be a non-empty array`);
    } else {
      for (const eventName of webhook.events) {
        if (!VALID_NOTIFICATION_EVENTS.includes(eventName)) {
          errors.push(
            `${label}: events contains unknown event "${eventName}". Valid events: ${VALID_NOTIFICATION_EVENTS.join(', ')}`
          );
        }
      }
    }

    if (!Number.isInteger(webhook.timeout_ms) || webhook.timeout_ms < 100 || webhook.timeout_ms > 30000) {
      errors.push(`${label}: timeout_ms must be an integer between 100 and 30000`);
    }

    if ('headers' in webhook && webhook.headers !== undefined) {
      if (!webhook.headers || typeof webhook.headers !== 'object' || Array.isArray(webhook.headers)) {
        errors.push(`${label}: headers must be an object`);
      } else {
        for (const [key, value] of Object.entries(webhook.headers)) {
          if (typeof value !== 'string') {
            errors.push(`${label}: headers.${key} must be a string`);
          }
        }
        const missingHeaderVars = collectMissingHeaderVars(webhook.headers, webhook.env);
        if (missingHeaderVars.length > 0) {
          errors.push(
            `${label}: unresolved header env vars ${missingHeaderVars.map(({ header, varName }) => `${header}:${varName}`).join(', ')}`
          );
        }
      }
    }

    if ('env' in webhook && webhook.env !== undefined) {
      if (!webhook.env || typeof webhook.env !== 'object' || Array.isArray(webhook.env)) {
        errors.push(`${label}: env must be an object`);
      } else {
        for (const [key, value] of Object.entries(webhook.env)) {
          if (typeof value !== 'string') {
            errors.push(`${label}: env.${key} must be a string`);
          }
        }
      }
    }
  });

  // Validate approval_sla if present
  const warnings = [];
  if (notifications.approval_sla !== undefined) {
    const sla = notifications.approval_sla;
    if (!sla || typeof sla !== 'object' || Array.isArray(sla)) {
      errors.push('notifications.approval_sla must be an object');
    } else {
      const slaAllowed = new Set(['enabled', 'reminder_after_seconds']);
      for (const key of Object.keys(sla)) {
        if (!slaAllowed.has(key)) {
          errors.push(`notifications.approval_sla contains unknown field "${key}"`);
        }
      }
      if ('enabled' in sla && typeof sla.enabled !== 'boolean') {
        errors.push('notifications.approval_sla.enabled must be a boolean');
      }
      if (!Array.isArray(sla.reminder_after_seconds) || sla.reminder_after_seconds.length === 0) {
        errors.push('notifications.approval_sla.reminder_after_seconds must be a non-empty array of positive integers');
      } else {
        if (sla.reminder_after_seconds.length > 10) {
          errors.push('notifications.approval_sla.reminder_after_seconds: maximum 10 thresholds');
        }
        let prev = 0;
        for (let i = 0; i < sla.reminder_after_seconds.length; i++) {
          const v = sla.reminder_after_seconds[i];
          if (!Number.isInteger(v) || v <= 0) {
            errors.push(`notifications.approval_sla.reminder_after_seconds[${i}]: must be a positive integer`);
          } else if (v < 300) {
            errors.push(`notifications.approval_sla.reminder_after_seconds[${i}]: minimum value is 300 (5 minutes)`);
          } else if (v <= prev) {
            errors.push(`notifications.approval_sla.reminder_after_seconds[${i}]: values must be strictly ascending`);
          }
          prev = v;
        }
      }
      // Warn if no webhook subscribes to approval_sla_reminder
      const hasSubscriber = Array.isArray(notifications.webhooks) &&
        notifications.webhooks.some(w => Array.isArray(w.events) && w.events.includes('approval_sla_reminder'));
      if (!hasSubscriber) {
        warnings.push('notifications.approval_sla is configured but no webhook subscribes to "approval_sla_reminder"');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function emitNotifications(root, config, state, eventType, payload = {}, turn = null) {
  const webhooks = config?.notifications?.webhooks;
  if (!Array.isArray(webhooks) || webhooks.length === 0) {
    return { ok: true, results: [] };
  }

  if (!VALID_NOTIFICATION_EVENTS.includes(eventType)) {
    return { ok: false, error: `Unknown notification event "${eventType}"`, results: [] };
  }

  const eventId = generateEventId();
  const emittedAt = new Date().toISOString();
  const envelope = {
    schema_version: '0.1',
    event_id: eventId,
    event_type: eventType,
    emitted_at: emittedAt,
    project: {
      id: config?.project?.id || 'unknown',
      name: config?.project?.name || 'Unknown',
      root,
    },
    run: {
      run_id: state?.run_id || null,
      status: state?.status || null,
      phase: state?.phase || null,
    },
    turn: turn ? {
      turn_id: turn.turn_id || null,
      role_id: turn.assigned_role || turn.role_id || null,
      attempt: Number.isInteger(turn.attempt) ? turn.attempt : null,
      assigned_sequence: Number.isInteger(turn.assigned_sequence) ? turn.assigned_sequence : null,
    } : null,
    payload,
  };

  const results = [];
  for (const webhook of webhooks) {
    if (!webhook.events.includes(eventType)) {
      continue;
    }

    const delivery = executeWebhook(webhook, envelope);
    const auditEntry = {
      event_id: eventId,
      event_type: eventType,
      notification_name: webhook.name,
      transport: 'webhook',
      delivered: delivery.delivered,
      status_code: delivery.status_code,
      timed_out: delivery.timed_out,
      duration_ms: delivery.duration_ms,
      message: delivery.message,
      emitted_at: emittedAt,
    };
    if (delivery.stderr_excerpt) {
      auditEntry.stderr_excerpt = delivery.stderr_excerpt;
    }
    appendAudit(root, auditEntry);
    results.push(auditEntry);
  }

  return { ok: true, event_id: eventId, results };
}

const SLA_REMINDERS_PATH = '.agentxchain/sla-reminders.json';

function readSlaReminders(root) {
  try {
    const filePath = join(root, SLA_REMINDERS_PATH);
    if (!existsSync(filePath)) return [];
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function writeSlaReminders(root, sent) {
  const filePath = join(root, SLA_REMINDERS_PATH);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(sent, null, 2) + '\n');
}

/**
 * Evaluate and emit approval SLA reminders for pending approvals.
 * Uses `.agentxchain/sla-reminders.json` for dedup tracking (not governed state).
 * Returns { reminders_sent: string[], notifications_emitted: number }.
 */
export function evaluateApprovalSlaReminders(root, config, state) {
  const result = { reminders_sent: [], notifications_emitted: 0 };

  const sla = config?.notifications?.approval_sla;
  if (!sla || sla.enabled === false) return result;
  if (!Array.isArray(sla.reminder_after_seconds) || sla.reminder_after_seconds.length === 0) return result;

  const webhooks = config?.notifications?.webhooks;
  if (!Array.isArray(webhooks) || !webhooks.some(w => Array.isArray(w.events) && w.events.includes('approval_sla_reminder'))) {
    return result;
  }

  if (!state) return result;

  const sent = readSlaReminders(root);
  const now = Date.now();
  const pendingApprovals = [];

  if (state.pending_phase_transition && state.pending_phase_transition.requested_at) {
    pendingApprovals.push({
      approval_type: 'pending_phase_transition',
      requested_at: state.pending_phase_transition.requested_at,
      from_phase: state.pending_phase_transition.from || null,
      to_phase: state.pending_phase_transition.to || null,
      gate: state.pending_phase_transition.gate || null,
    });
  }

  if (state.pending_run_completion && state.pending_run_completion.requested_at) {
    pendingApprovals.push({
      approval_type: 'pending_run_completion',
      requested_at: state.pending_run_completion.requested_at,
      from_phase: null,
      to_phase: null,
      gate: state.pending_run_completion.gate || null,
    });
  }

  let changed = false;
  for (const approval of pendingApprovals) {
    const requestedMs = new Date(approval.requested_at).getTime();
    if (isNaN(requestedMs)) continue;
    const elapsedSeconds = Math.floor((now - requestedMs) / 1000);

    for (let i = 0; i < sla.reminder_after_seconds.length; i++) {
      const threshold = sla.reminder_after_seconds[i];
      const reminderKey = `${approval.approval_type}:${threshold}`;

      if (elapsedSeconds >= threshold && !sent.includes(reminderKey)) {
        const payload = {
          approval_type: approval.approval_type,
          requested_at: approval.requested_at,
          elapsed_seconds: elapsedSeconds,
          threshold_seconds: threshold,
          reminder_index: i + 1,
          total_thresholds: sla.reminder_after_seconds.length,
        };
        if (approval.from_phase) payload.from_phase = approval.from_phase;
        if (approval.to_phase) payload.to_phase = approval.to_phase;
        if (approval.gate) payload.gate = approval.gate;

        emitNotifications(root, config, state, 'approval_sla_reminder', payload);
        sent.push(reminderKey);
        result.reminders_sent.push(reminderKey);
        result.notifications_emitted++;
        changed = true;
      }
    }
  }

  if (changed) {
    writeSlaReminders(root, sent);
  }

  return result;
}

/**
 * Clear SLA reminder tracking for a resolved approval type.
 * Called from approve-transition / approve-completion.
 */
export function clearSlaReminders(root, approvalType) {
  const sent = readSlaReminders(root);
  const filtered = sent.filter(k => !k.startsWith(`${approvalType}:`));
  if (filtered.length !== sent.length) {
    writeSlaReminders(root, filtered);
  }
}
