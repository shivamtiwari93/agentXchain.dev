import { loadConfig, loadProjectContext } from '../config.js';
import { readJsonlFile } from './state-reader.js';

function summarizeAuditEntries(entries) {
  const summary = {
    total_attempts: entries.length,
    delivered: 0,
    failed: 0,
    timed_out: 0,
    last_emitted_at: null,
    last_failure_at: null,
  };

  for (const entry of entries) {
    if (entry?.delivered === true) {
      summary.delivered += 1;
    } else {
      summary.failed += 1;
      if (!summary.last_failure_at || String(entry?.emitted_at || '') > summary.last_failure_at) {
        summary.last_failure_at = entry?.emitted_at || null;
      }
    }
    if (entry?.timed_out === true) {
      summary.timed_out += 1;
    }
    if (!summary.last_emitted_at || String(entry?.emitted_at || '') > summary.last_emitted_at) {
      summary.last_emitted_at = entry?.emitted_at || null;
    }
  }

  return summary;
}

function normalizeWebhook(webhook) {
  return {
    name: webhook.name,
    timeout_ms: webhook.timeout_ms,
    event_count: Array.isArray(webhook.events) ? webhook.events.length : 0,
    events: Array.isArray(webhook.events) ? webhook.events : [],
  };
}

export function readNotificationSnapshot(workspacePath) {
  const context = loadProjectContext(workspacePath);
  const governedContext = context?.config ? context : null;
  const legacyConfigResult = governedContext ? null : loadConfig(workspacePath);
  if (!governedContext && !legacyConfigResult) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'config_missing',
        error: 'Project config not found. Run `agentxchain init --governed` first.',
      },
    };
  }

  const root = governedContext?.root || legacyConfigResult.root;
  const config = governedContext?.config || legacyConfigResult.config;
  const notifications = config?.notifications || {};
  const webhooks = Array.isArray(notifications.webhooks)
    ? notifications.webhooks.map(normalizeWebhook)
    : [];
  const configured = webhooks.length > 0;
  const approvalSla = notifications.approval_sla
    ? {
      enabled: notifications.approval_sla.enabled !== false,
      reminder_after_seconds: Array.isArray(notifications.approval_sla.reminder_after_seconds)
        ? notifications.approval_sla.reminder_after_seconds
        : [],
    }
    : null;

  const auditEntries = (readJsonlFile(`${root}/.agentxchain`, 'notification-audit.jsonl') || [])
    .slice()
    .sort((a, b) => String(b?.emitted_at || '').localeCompare(String(a?.emitted_at || '')));

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      configured,
      webhooks,
      approval_sla: approvalSla,
      summary: summarizeAuditEntries(auditEntries),
      recent: auditEntries.slice(0, 10),
    },
  };
}
