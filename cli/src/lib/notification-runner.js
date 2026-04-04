import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
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
    return { ok: false, errors };
  }

  const allowedKeys = new Set(['webhooks']);
  for (const key of Object.keys(notifications)) {
    if (!allowedKeys.has(key)) {
      errors.push(`notifications contains unknown field "${key}"`);
    }
  }

  if (!('webhooks' in notifications)) {
    return { ok: errors.length === 0, errors };
  }

  if (!Array.isArray(notifications.webhooks)) {
    errors.push('notifications.webhooks must be an array');
    return { ok: false, errors };
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

  return { ok: errors.length === 0, errors };
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
