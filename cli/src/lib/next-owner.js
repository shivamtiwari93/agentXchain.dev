import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function resolveNextAgent(root, config, lock = {}) {
  const agents = Object.keys(config.agents || {});
  if (agents.length === 0) return { next: null, source: 'none', raw: null };

  const talkFile = config.talk_file || 'TALK.md';
  const talkPath = join(root, talkFile);
  const fromTalk = parseNextOwnerFromTalk(talkPath, agents);
  if (fromTalk) {
    return { next: fromTalk, source: 'talk', raw: fromTalk };
  }

  const last = lock.last_released_by;
  if (last && agents.includes(last)) {
    const idx = agents.indexOf(last);
    return { next: agents[(idx + 1) % agents.length], source: 'fallback-cyclic', raw: null };
  }

  return { next: agents[0], source: 'fallback-first', raw: null };
}

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
    const match = line.match(/^(?:-|\*)?\s*\**next\s*owner\**\s*:\s*(.+)$/i);
    if (!match) continue;

    const candidate = normalizeAgentId(match[1]);
    if (candidate && validAgentIds.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeAgentId(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  value = value.replace(/[`*_]/g, '').trim();
  value = value.replace(/\(.*?\)/g, '').trim();
  value = value.split(/[,\s]+/)[0];
  value = value.toLowerCase();
  return /^[a-z0-9_-]+$/.test(value) ? value : null;
}

