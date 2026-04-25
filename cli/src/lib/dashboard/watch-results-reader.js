import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_LIMIT = 25;

export function readWatchResultsSnapshot(workspacePath, { limit = DEFAULT_LIMIT } = {}) {
  const resultsDir = join(workspacePath, '.agentxchain', 'watch-results');
  const parsedLimit = parseLimit(limit);
  const records = [];
  let corrupt = 0;

  if (existsSync(resultsDir)) {
    const entries = readdirSync(resultsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));

    for (const entry of entries) {
      try {
        const record = JSON.parse(readFileSync(join(resultsDir, entry.name), 'utf8'));
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          corrupt += 1;
          continue;
        }
        records.push(record);
      } catch {
        corrupt += 1;
      }
    }
  }

  records.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const recent = parsedLimit === 0 ? records : records.slice(0, parsedLimit);

  return {
    ok: true,
    total: records.length,
    corrupt,
    recent,
    summary: summarize(records, corrupt),
  };
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LIMIT;
  return parsed;
}

function summarize(records, corrupt) {
  const byStatus = {};
  let errored = 0;
  let deduplicated = 0;
  let routed = 0;
  let unrouted = 0;
  let lastTimestamp = null;

  for (const record of records) {
    const status = classifyWatchResult(record);
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (status === 'error') errored += 1;
    if (record.deduplicated === true) deduplicated += 1;
    if (record.route?.matched === false) unrouted += 1;
    else if (record.route?.matched === true) routed += 1;
    if (!lastTimestamp && record.timestamp) lastTimestamp = record.timestamp;
  }

  return {
    by_status: byStatus,
    errored,
    deduplicated,
    routed,
    unrouted,
    corrupt,
    last_timestamp: lastTimestamp,
  };
}

export function classifyWatchResult(record) {
  if (Array.isArray(record?.errors) && record.errors.length > 0) return 'error';
  if (record?.deduplicated === true) return 'deduplicated';
  if (record?.route?.started === true) return 'started';
  if (record?.route?.planned === true) return 'planned';
  if (record?.route?.approved === true) return 'approved';
  if (record?.route?.triaged === true) return 'triaged';
  if (record?.route?.matched === false) return 'unrouted';
  return 'detected';
}
