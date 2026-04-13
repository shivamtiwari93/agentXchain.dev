import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const HISTORY_PATH = '.agentxchain/history.jsonl';

export function queryAcceptedTurnHistory(root) {
  const filePath = join(root, HISTORY_PATH);
  if (!existsSync(filePath)) return [];

  let content;
  try {
    content = readFileSync(filePath, 'utf8').trim();
  } catch {
    return [];
  }

  if (!content) return [];

  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry.turn_id === 'string')
    .reverse();
}

export function resolveAcceptedTurnHistoryReference(root, ref) {
  const entries = queryAcceptedTurnHistory(root);

  if (entries.length === 0) {
    return {
      ok: false,
      error: 'No accepted turn history found. Accept at least one governed turn first.',
    };
  }

  if (!ref) {
    return {
      ok: true,
      entry: entries[0],
      resolved_ref: entries[0].turn_id,
      match_kind: 'latest',
    };
  }

  const exact = entries.find((entry) => entry.turn_id === ref);
  if (exact) {
    return {
      ok: true,
      entry: exact,
      resolved_ref: exact.turn_id,
      match_kind: 'exact',
    };
  }

  const prefixMatches = entries.filter((entry) => entry.turn_id.startsWith(ref));
  if (prefixMatches.length === 1) {
    return {
      ok: true,
      entry: prefixMatches[0],
      resolved_ref: prefixMatches[0].turn_id,
      match_kind: 'prefix',
    };
  }

  if (prefixMatches.length > 1) {
    return {
      ok: false,
      error: `Turn reference "${ref}" is ambiguous. Matches: ${prefixMatches.map((entry) => entry.turn_id).join(', ')}`,
    };
  }

  return {
    ok: false,
    error: `Accepted turn ${ref} not found in history.`,
  };
}

