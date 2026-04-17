import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { emitRunEvent } from './run-events.js';

export const HUMAN_ESCALATIONS_PATH = '.agentxchain/human-escalations.jsonl';
export const HUMAN_TASKS_PATH = 'HUMAN_TASKS.md';

const OPEN_START = '<!-- AGENTXCHAIN:HUMAN_ESCALATIONS:OPEN:START -->';
const OPEN_END = '<!-- AGENTXCHAIN:HUMAN_ESCALATIONS:OPEN:END -->';
const COMPLETED_START = '<!-- AGENTXCHAIN:HUMAN_ESCALATIONS:COMPLETED:START -->';
const COMPLETED_END = '<!-- AGENTXCHAIN:HUMAN_ESCALATIONS:COMPLETED:END -->';
const MAX_COMPLETED_IN_MARKDOWN = 10;

const SERVICE_PATTERNS = [
  ['Anthropic', /\banthropic\b|\bclaude\b/i],
  ['OpenAI', /\bopenai\b|\bgpt\b/i],
  ['GitHub', /\bgithub\b|\bgh\b/i],
  ['Google', /\bgoogle\b|\bgcp\b|\bgmail\b|\bdrive\b/i],
  ['Linear', /\blinear\b/i],
  ['Slack', /\bslack\b/i],
  ['LinkedIn', /\blinkedin\b/i],
  ['X/Twitter', /\btwitter\b|\bx-browser\b|\bx\/twitter\b/i],
  ['Reddit', /\breddit\b|\br-browser\b/i],
  ['npm', /\bnpm\b/i],
  ['Homebrew', /\bhomebrew\b|\btap\b/i],
  ['VS Code Marketplace', /\bvs code marketplace\b|\bvsce\b/i],
];

function generateEscalationId() {
  return `hesc_${randomBytes(8).toString('hex')}`;
}

function trimToNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function appendJsonl(root, relPath, entry) {
  const filePath = join(root, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function readJsonl(root, relPath) {
  const filePath = join(root, relPath);
  if (!existsSync(filePath)) return [];
  const raw = safeRead(filePath);
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function replaceManagedSection(content, startMarker, endMarker, replacement) {
  if (!content.includes(startMarker) || !content.includes(endMarker)) {
    const suffix = content.endsWith('\n') ? '' : '\n';
    return `${content}${suffix}${startMarker}\n${replacement}\n${endMarker}\n`;
  }

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  return `${content.slice(0, startIndex)}${startMarker}\n${replacement}\n${content.slice(endIndex)}`;
}

function formatField(label, value) {
  return value ? `- ${label}: ${value}` : null;
}

function detectService(text) {
  for (const [service, pattern] of SERVICE_PATTERNS) {
    if (pattern.test(text)) return service;
  }
  return null;
}

export function classifyHumanEscalation({ blockedOn, typedReason, detail, category }) {
  const text = [
    trimToNull(blockedOn),
    trimToNull(typedReason),
    trimToNull(detail),
    trimToNull(category),
  ].filter(Boolean).join(' ');
  const lower = text.toLowerCase();
  const service = detectService(text);

  if (/\boauth\b|\blogin\b|\blog in\b|\bsign in\b|\bre-?auth\b|\bsession expired\b/.test(lower)) {
    return { type: 'needs_oauth', service };
  }
  if (/\bapi key\b|\bcredential\b|\bsecret\b|\btoken\b|\bpat\b|\bauth_env\b|\baccess key\b/.test(lower)) {
    return { type: 'needs_credential', service };
  }
  if (/\bbilling\b|\bpayment\b|\bcard\b|\binvoice\b|\bsubscription\b/.test(lower)) {
    return { type: 'needs_payment', service };
  }
  if (/\blegal\b|\blicense\b|\bnda\b|\bdpa\b|\bcontract\b|\bterms\b/.test(lower)) {
    return { type: 'needs_legal', service };
  }
  if (/\bphysical\b|\bdevice\b|\bhardware\b|\bon-site\b|\bon site\b|\busb\b|\bphone\b|\bcamera\b/.test(lower)) {
    return { type: 'needs_physical_access', service };
  }

  return { type: 'needs_decision', service };
}

/**
 * Emit a local (non-webhook) escalation notice to stderr.
 * Always fires — no config required. This is the notifier floor:
 * operators see escalation signals even with zero webhook configuration.
 *
 * On macOS, optionally emits an AppleScript notification if
 * AGENTXCHAIN_LOCAL_NOTIFY=1 is set.
 */
function emitLocalEscalationNotice(kind, record) {
  try {
    if (kind === 'raised') {
      const svc = record.service ? ` (${record.service})` : '';
      process.stderr.write(
        `\n[agentxchain] ⚠ HUMAN ESCALATION RAISED: ${record.escalation_id}${svc}\n` +
        `  Type:    ${record.type}\n` +
        `  Action:  ${record.action}\n` +
        `  Unblock: ${record.resolution_command}\n\n`
      );
    } else if (kind === 'resolved') {
      process.stderr.write(
        `\n[agentxchain] ✓ HUMAN ESCALATION RESOLVED: ${record.escalation_id}\n` +
        `  Resolved via: ${record.resolved_via || 'unknown'}\n\n`
      );
    }

    if (process.env.AGENTXCHAIN_LOCAL_NOTIFY === '1' && process.platform === 'darwin') {
      emitAppleScriptNotification(kind, record);
    }
  } catch {
    // Best-effort — never interrupt governed operations for local notices.
  }
}

function emitAppleScriptNotification(kind, record) {
  try {
    const title = kind === 'raised'
      ? `AgentXchain: Escalation ${record.escalation_id}`
      : `AgentXchain: Resolved ${record.escalation_id}`;
    const body = kind === 'raised'
      ? `${record.type}${record.service ? ` — ${record.service}` : ''}: ${record.action}`
      : `Resolved via ${record.resolved_via || 'unknown'}`;
    const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    spawnSync('osascript', ['-e', script], { timeout: 3000, stdio: 'ignore' });
  } catch {
    // Best-effort.
  }
}

function summarizeAction(type, service) {
  switch (type) {
    case 'needs_oauth':
      return service
        ? `Reconnect ${service} OAuth and verify the session.`
        : 'Reconnect the required OAuth session and verify access.';
    case 'needs_credential':
      return service
        ? `Restore the required ${service} credential and verify access.`
        : 'Restore the required credential or secret and verify access.';
    case 'needs_payment':
      return service
        ? `Complete the required ${service} billing or payment action.`
        : 'Complete the required billing or payment action.';
    case 'needs_legal':
      return 'Complete the required legal review or approval.';
    case 'needs_physical_access':
      return 'Complete the required physical-access or device action.';
    default:
      return 'Review the blocker, make the required decision, and confirm the run can continue.';
  }
}

function materializeHumanEscalations(events) {
  const byId = new Map();

  for (const event of events) {
    if (!event?.escalation_id) continue;
    if (event.kind === 'raised') {
      byId.set(event.escalation_id, {
        ...event,
        status: 'open',
        resolved_at: null,
        resolved_via: null,
        resolution_notes: null,
      });
      continue;
    }

    if (event.kind === 'resolved') {
      const existing = byId.get(event.escalation_id);
      if (!existing) continue;
      byId.set(event.escalation_id, {
        ...existing,
        status: 'resolved',
        resolved_at: event.resolved_at || null,
        resolved_via: event.resolved_via || null,
        resolution_notes: event.resolution_notes || null,
      });
    }
  }

  const records = [...byId.values()].sort((left, right) => {
    const leftTs = new Date(left.created_at || 0).getTime();
    const rightTs = new Date(right.created_at || 0).getTime();
    return rightTs - leftTs;
  });

  return {
    records,
    open: records.filter((record) => record.status === 'open'),
    completed: records.filter((record) => record.status === 'resolved'),
    byId,
  };
}

function renderOpenSection(open) {
  if (open.length === 0) {
    return [
      '## Open',
      '',
      '_No open human escalations._',
    ].join('\n');
  }

  const lines = [
    '## Open',
    '',
    'Live operator-required blockers generated by governed runs. The parseable source of truth is `.agentxchain/human-escalations.jsonl`.',
  ];

  for (const record of open) {
    lines.push('');
    lines.push(`### ${record.escalation_id} — ${record.type}`);
    lines.push(...[
      formatField('Created', record.created_at),
      formatField('Run', record.run_id),
      formatField('Phase', record.phase),
      formatField('Blocked on', record.blocked_on),
      formatField('Typed reason', record.typed_reason),
      formatField('Service', record.service),
      formatField('Action', record.action),
      formatField('Continue', record.resolution_command ? `\`${record.resolution_command}\`` : null),
      formatField('Underlying recovery', record.recovery_action ? `\`${record.recovery_action}\`` : null),
      formatField('Detail', record.detail),
    ].filter(Boolean));
  }

  return lines.join('\n');
}

function renderCompletedSection(completed) {
  const records = completed.slice(0, MAX_COMPLETED_IN_MARKDOWN);
  if (records.length === 0) {
    return [
      '## Completed',
      '',
      '_No resolved human escalations yet._',
    ].join('\n');
  }

  const lines = ['## Completed'];
  for (const record of records) {
    lines.push('');
    lines.push(`### ${record.escalation_id} — resolved`);
    lines.push(...[
      formatField('Created', record.created_at),
      formatField('Resolved', record.resolved_at),
      formatField('Resolved via', record.resolved_via),
      formatField('Type', record.type),
      formatField('Service', record.service),
      formatField('Blocked on', record.blocked_on),
      formatField('Detail', record.detail),
      formatField('Notes', record.resolution_notes),
    ].filter(Boolean));
  }

  return lines.join('\n');
}

function rewriteHumanTasks(root, summary) {
  const filePath = join(root, HUMAN_TASKS_PATH);
  const existing = existsSync(filePath)
    ? safeRead(filePath)
    : '# Human Tasks\n\nOperator-required blockers surfaced by AgentXchain.\n';

  let next = replaceManagedSection(existing, OPEN_START, OPEN_END, renderOpenSection(summary.open));
  next = replaceManagedSection(next, COMPLETED_START, COMPLETED_END, renderCompletedSection(summary.completed));
  if (!next.endsWith('\n')) next += '\n';
  writeFileSync(filePath, next);
}

function summarize(root) {
  return materializeHumanEscalations(readJsonl(root, HUMAN_ESCALATIONS_PATH));
}

export function readHumanEscalations(root) {
  return summarize(root).records;
}

export function getOpenHumanEscalation(root, escalationId) {
  const summary = summarize(root);
  const record = summary.byId.get(escalationId);
  return record?.status === 'open' ? record : null;
}

export function findCurrentHumanEscalation(root, state) {
  if (!state || state.status !== 'blocked') return null;
  const summary = summarize(root);
  return summary.open.find((record) => {
    if (record.run_id !== (state.run_id || null)) return false;
    if (record.blocked_on !== (state.blocked_on || null)) return false;
    if ((record.turn_id || null) !== (state.blocked_reason?.turn_id || null)) return false;
    return true;
  }) || null;
}

export function ensureHumanEscalation(root, state, turn = null) {
  const recovery = state?.blocked_reason?.recovery || null;
  if (state?.status !== 'blocked' || recovery?.owner !== 'human') {
    return null;
  }

  const existing = findCurrentHumanEscalation(root, state);
  if (existing) {
    return { record: existing, created: false };
  }

  const detail = trimToNull(recovery.detail) || trimToNull(state.blocked_on) || 'Operator intervention required.';
  const classification = classifyHumanEscalation({
    blockedOn: state.blocked_on,
    typedReason: recovery.typed_reason,
    detail,
    category: state.blocked_reason?.category || null,
  });
  const escalationId = generateEscalationId();
  const record = {
    kind: 'raised',
    escalation_id: escalationId,
    created_at: state.blocked_reason?.blocked_at || new Date().toISOString(),
    run_id: state.run_id || null,
    phase: state.phase || null,
    blocked_on: state.blocked_on || null,
    category: state.blocked_reason?.category || 'unknown_block',
    typed_reason: recovery.typed_reason || 'unknown_block',
    type: classification.type,
    service: classification.service,
    action: summarizeAction(classification.type, classification.service),
    recovery_action: recovery.recovery_action || null,
    resolution_command: `agentxchain unblock ${escalationId}`,
    detail,
    turn_id: trimToNull(turn?.turn_id) || state.blocked_reason?.turn_id || null,
    role_id: trimToNull(turn?.assigned_role) || trimToNull(turn?.role_id) || null,
  };

  appendJsonl(root, HUMAN_ESCALATIONS_PATH, record);
  rewriteHumanTasks(root, summarize(root));

  emitRunEvent(root, 'human_escalation_raised', {
    run_id: state.run_id || null,
    phase: state.phase || null,
    status: state.status || null,
    payload: {
      escalation_id: escalationId,
      type: classification.type,
      service: classification.service,
      action: record.action,
      blocked_on: state.blocked_on || null,
      resolution_command: record.resolution_command,
      detail: record.detail,
    },
  });

  emitLocalEscalationNotice('raised', record);

  return { record, created: true };
}

export function resolveHumanEscalation(root, escalationId, resolution = {}) {
  const current = getOpenHumanEscalation(root, escalationId);
  if (!current) {
    return { ok: false, error: `No open human escalation found for ${escalationId}` };
  }

  const resolvedAt = resolution.resolved_at || new Date().toISOString();
  const resolvedVia = resolution.resolved_via || 'unknown';
  appendJsonl(root, HUMAN_ESCALATIONS_PATH, {
    kind: 'resolved',
    escalation_id: escalationId,
    resolved_at: resolvedAt,
    resolved_via: resolvedVia,
    resolution_notes: trimToNull(resolution.resolution_notes),
  });
  const summary = summarize(root);
  rewriteHumanTasks(root, summary);

  emitRunEvent(root, 'human_escalation_resolved', {
    run_id: current.run_id || null,
    phase: current.phase || null,
    status: 'active',
    payload: {
      escalation_id: escalationId,
      type: current.type,
      service: current.service,
      resolved_via: resolvedVia,
    },
  });

  emitLocalEscalationNotice('resolved', { ...current, resolved_via: resolvedVia });

  return {
    ok: true,
    record: summary.byId.get(escalationId) || null,
  };
}
