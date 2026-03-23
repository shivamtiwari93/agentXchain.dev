import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function resolveExpectedClaimer(root, config, lock = {}) {
  const agents = Object.keys(config.agents || {});
  if (agents.length === 0) return { next: null, source: 'none', raw: null };

  const trigger = readTrigger(root);
  if (
    trigger &&
    typeof trigger.turn_number === 'number' &&
    trigger.turn_number === lock.turn_number &&
    typeof trigger.agent === 'string' &&
    agents.includes(trigger.agent)
  ) {
    return { next: trigger.agent, source: 'trigger', raw: trigger.agent };
  }

  return resolveNextAgent(root, config, lock);
}

export function resolveNextAgent(root, config, lock = {}) {
  const agents = Object.keys(config.agents || {});
  if (agents.length === 0) return { next: null, source: 'none', raw: null };

  const talkFile = config.talk_file || 'TALK.md';
  const talkPath = join(root, talkFile);
  const fromTalk = parseNextOwnerFromTalk(talkPath, agents);
  if (fromTalk) {
    return { next: fromTalk, source: 'talk', raw: fromTalk };
  }

  if (config.rules?.strict_next_owner) {
    return { next: null, source: 'strict-missing', raw: null };
  }

  const last = lock.last_released_by;
  if (last && agents.includes(last)) {
    const idx = agents.indexOf(last);
    return { next: agents[(idx + 1) % agents.length], source: 'fallback-cyclic', raw: null };
  }

  return { next: agents[0], source: 'fallback-first', raw: null };
}

const NEXT_OWNER_PATTERNS = [
  /^(?:-|\*)?\s*\**next\s*owner\**\s*:\s*(.+)$/i,
  /^(?:-|\*)?\s*\**handoff\s*(?:to)?\**\s*:\s*(.+)$/i,
  /^(?:-|\*)?\s*\**next\**\s*:\s*(.+)$/i,
  /^(?:-|\*)?\s*\**hand\s*off\s*to\**\s*:\s*(.+)$/i,
];

function parseNextOwnerFromTalk(talkPath, validAgentIds) {
  if (!existsSync(talkPath)) return null;

  let text = '';
  try {
    text = readFileSync(talkPath, 'utf8');
  } catch {
    return null;
  }

  if (!text.trim()) return null;

  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;

    for (const pattern of NEXT_OWNER_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;

      const candidate = normalizeAgentId(match[1]);
      if (candidate && validAgentIds.includes(candidate)) {
        return candidate;
      }

      const fuzzy = fuzzyMatchAgentId(match[1], validAgentIds);
      if (fuzzy) return fuzzy;
    }
  }

  return null;
}

function normalizeAgentId(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  value = value.replace(/[`*_\[\]]/g, '').trim();
  value = value.replace(/\(.*?\)/g, '').trim();
  value = value.split(/[,\s]+/)[0];
  value = value.toLowerCase();
  return /^[a-z0-9_-]+$/.test(value) ? value : null;
}

function fuzzyMatchAgentId(raw, validAgentIds) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[`*_\[\]]/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase();
  for (const id of validAgentIds) {
    if (cleaned.startsWith(id)) return id;
    if (cleaned.includes(id)) return id;
  }
  return null;
}

function readTrigger(root) {
  const triggerPath = join(root, '.agentxchain-trigger.json');
  if (!existsSync(triggerPath)) return null;
  try {
    return JSON.parse(readFileSync(triggerPath, 'utf8'));
  } catch {
    return null;
  }
}

