import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const LEDGER_PATH = '.agentxchain/decision-ledger.jsonl';
const MAX_OUTPUT_TAIL_CHARS = 1200;

export function validateGateActionsConfig(gates, errors) {
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) {
    errors.push('gates must be an object');
    return;
  }

  for (const [gateId, gate] of Object.entries(gates)) {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      errors.push(`Gate "${gateId}" must be an object`);
      continue;
    }

    if (!('gate_actions' in gate)) {
      continue;
    }

    if (!Array.isArray(gate.gate_actions) || gate.gate_actions.length === 0) {
      errors.push(`Gate "${gateId}": gate_actions must be a non-empty array when provided`);
      continue;
    }

    if (gate.requires_human_approval !== true) {
      errors.push(`Gate "${gateId}": gate_actions require requires_human_approval: true`);
    }

    for (let i = 0; i < gate.gate_actions.length; i++) {
      const action = gate.gate_actions[i];
      const prefix = `gates.${gateId}.gate_actions[${i}]`;
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      if (typeof action.run !== 'string' || !action.run.trim()) {
        errors.push(`${prefix}.run must be a non-empty string`);
      }
      if ('label' in action && (typeof action.label !== 'string' || !action.label.trim())) {
        errors.push(`${prefix}.label must be a non-empty string when provided`);
      }
    }
  }
}

export function getGateActions(config, gateId) {
  const actions = config?.gates?.[gateId]?.gate_actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return [];
  }

  return actions
    .filter((action) => action && typeof action === 'object' && typeof action.run === 'string' && action.run.trim())
    .map((action, index) => ({
      index: index + 1,
      label: typeof action.label === 'string' && action.label.trim() ? action.label.trim() : null,
      run: action.run.trim(),
    }));
}

function trimOutputTail(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= MAX_OUTPUT_TAIL_CHARS) {
    return trimmed;
  }
  return trimmed.slice(-MAX_OUTPUT_TAIL_CHARS);
}

function buildGateActionEntry(action, meta, runtimeResult, status) {
  return {
    type: 'gate_action',
    timestamp: new Date().toISOString(),
    attempt_id: meta.attemptId,
    gate_id: meta.gateId,
    gate_type: meta.gateType,
    phase: meta.phase || null,
    requested_by_turn: meta.requestedByTurn || null,
    trigger_command: meta.triggerCommand || null,
    action_index: action.index,
    action_label: action.label,
    command: action.run,
    status,
    exit_code: Number.isInteger(runtimeResult?.status) ? runtimeResult.status : null,
    signal: runtimeResult?.signal || null,
    stdout_tail: trimOutputTail(runtimeResult?.stdout),
    stderr_tail: trimOutputTail(runtimeResult?.stderr),
    spawn_error: runtimeResult?.error?.message || null,
  };
}

export function executeGateActions(root, config, meta, opts = {}) {
  const actions = getGateActions(config, meta.gateId);
  if (actions.length === 0) {
    return { ok: true, dry_run: Boolean(opts.dryRun), actions: [] };
  }

  if (opts.dryRun) {
    return { ok: true, dry_run: true, actions };
  }

  const attemptId = `ga_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const results = [];

  for (const action of actions) {
    const runtimeResult = spawnSync('/bin/sh', ['-lc', action.run], {
      cwd: root,
      env: {
        ...process.env,
        AGENTXCHAIN_GATE_ID: meta.gateId,
        AGENTXCHAIN_GATE_TYPE: meta.gateType,
        AGENTXCHAIN_PHASE: meta.phase || '',
        AGENTXCHAIN_REQUESTED_BY_TURN: meta.requestedByTurn || '',
        AGENTXCHAIN_TRIGGER_COMMAND: meta.triggerCommand || '',
      },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const status = runtimeResult.error || runtimeResult.status !== 0 ? 'failed' : 'succeeded';
    const entry = buildGateActionEntry(action, { ...meta, attemptId }, runtimeResult, status);
    results.push(entry);

    if (status === 'failed') {
      return {
        ok: false,
        attempt_id: attemptId,
        actions: results,
        failed_action: entry,
        error: `Gate action failed for "${meta.gateId}": ${action.label || action.run}`,
      };
    }
  }

  return {
    ok: true,
    attempt_id: attemptId,
    actions: results,
  };
}

export function normalizeGateActionEntry(entry) {
  if (!entry || entry.type !== 'gate_action') {
    return null;
  }

  return {
    attempt_id: entry.attempt_id || null,
    gate_id: entry.gate_id || null,
    gate_type: entry.gate_type || null,
    phase: entry.phase || null,
    requested_by_turn: entry.requested_by_turn || null,
    trigger_command: entry.trigger_command || null,
    action_index: Number.isInteger(entry.action_index) ? entry.action_index : null,
    action_label: entry.action_label || null,
    command: entry.command || null,
    status: entry.status || 'unknown',
    exit_code: Number.isInteger(entry.exit_code) ? entry.exit_code : null,
    signal: entry.signal || null,
    stdout_tail: entry.stdout_tail || null,
    stderr_tail: entry.stderr_tail || null,
    spawn_error: entry.spawn_error || null,
    timestamp: entry.timestamp || null,
  };
}

export function extractGateActionDigest(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  return entries
    .map(normalizeGateActionEntry)
    .filter(Boolean)
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

export function readGateActionEntries(root) {
  const filePath = join(root, LEDGER_PATH);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return [];
  }

  const entries = raw
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

  return extractGateActionDigest(entries);
}

export function summarizeLatestGateActionAttempt(root, gateType, gateId) {
  const entries = readGateActionEntries(root)
    .filter((entry) => entry.gate_type === gateType && entry.gate_id === gateId);

  if (entries.length === 0) {
    return null;
  }

  const latest = entries[entries.length - 1];
  const attemptEntries = entries.filter((entry) => entry.attempt_id === latest.attempt_id);
  return {
    attempt_id: latest.attempt_id,
    gate_id: gateId,
    gate_type: gateType,
    status: attemptEntries.some((entry) => entry.status === 'failed') ? 'failed' : 'succeeded',
    attempted_at: latest.timestamp || null,
    actions: attemptEntries,
  };
}
