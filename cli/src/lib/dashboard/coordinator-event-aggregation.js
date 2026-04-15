/**
 * Coordinator event aggregation — merges lifecycle events from all child
 * repos in a multi-repo coordinator run into a single time-ordered stream.
 *
 * See: .planning/COORDINATOR_EVENT_AGGREGATION_SPEC.md
 */

import { existsSync, readFileSync, watchFile, unwatchFile, statSync } from 'fs';
import { join, resolve } from 'path';
import { loadCoordinatorConfig } from '../coordinator-config.js';
import { RUN_EVENTS_PATH } from '../run-events.js';

/**
 * Read and merge events from all child repos defined in the coordinator config.
 *
 * @param {string} workspacePath - Coordinator workspace root
 * @param {object} [opts]        - Filter options
 * @param {string} [opts.type]   - Comma-separated event types
 * @param {string} [opts.since]  - ISO-8601 timestamp
 * @param {number} [opts.limit]  - Max events (from end, default 100)
 * @param {string} [opts.repo_id] - Filter to one repo
 * @returns {{ ok: boolean, events?: object[], error?: string }}
 */
export function readAggregatedCoordinatorEvents(workspacePath, opts = {}) {
  const configResult = loadCoordinatorConfig(workspacePath);
  if (!configResult.ok) {
    return { ok: false, error: configResult.errors.join('; ') };
  }

  const config = configResult.config;
  let allEvents = [];

  for (const [repoId, repo] of Object.entries(config.repos)) {
    if (opts.repo_id && opts.repo_id !== repoId) continue;

    const repoPath = resolve(workspacePath, repo.path);
    const eventsPath = join(repoPath, RUN_EVENTS_PATH);

    if (!existsSync(eventsPath)) continue;

    let raw;
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      continue;
    }

    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        evt.repo_id = repoId;
        allEvents.push(evt);
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Apply type filter
  if (opts.type) {
    const types = new Set(opts.type.split(',').map(t => t.trim()));
    allEvents = allEvents.filter(e => types.has(e.event_type));
  }

  // Apply since filter
  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    if (!Number.isNaN(sinceMs)) {
      allEvents = allEvents.filter(e => new Date(e.timestamp).getTime() > sinceMs);
    }
  }

  // Sort by timestamp ascending, ties broken by event_id
  allEvents.sort((a, b) => {
    const tDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (tDiff !== 0) return tDiff;
    return (a.event_id || '').localeCompare(b.event_id || '');
  });

  // Apply limit (from end)
  const limit = opts.limit ?? 100;
  if (limit > 0 && allEvents.length > limit) {
    allEvents = allEvents.slice(-limit);
  }

  return { ok: true, events: allEvents };
}

/**
 * Set up file watchers on child repo events.jsonl files for real-time
 * WebSocket push. Returns a controller with a stop() method.
 *
 * @param {string} workspacePath - Coordinator workspace root
 * @param {function} onNewEvents - Callback: (repoId, events[]) => void
 * @returns {{ ok: boolean, stop?: function, error?: string }}
 */
export function watchChildRepoEvents(workspacePath, onNewEvents) {
  const configResult = loadCoordinatorConfig(workspacePath);
  if (!configResult.ok) {
    return { ok: false, error: configResult.errors.join('; ') };
  }

  const config = configResult.config;
  const trackedFiles = new Map(); // eventsPath → { repoId, lastSize }
  const watchedPaths = [];

  for (const [repoId, repo] of Object.entries(config.repos)) {
    const repoPath = resolve(workspacePath, repo.path);
    const eventsPath = join(repoPath, RUN_EVENTS_PATH);

    let initialSize = 0;
    try {
      if (existsSync(eventsPath)) {
        initialSize = statSync(eventsPath).size;
      }
    } catch {}

    trackedFiles.set(eventsPath, { repoId, lastSize: initialSize });

    // Use fs.watchFile (polling) for reliability across platforms
    try {
      watchFile(eventsPath, { interval: 500 }, (curr) => {
        const tracked = trackedFiles.get(eventsPath);
        if (!tracked) return;

        const currentSize = curr.size;
        if (currentSize <= tracked.lastSize) {
          // File truncated or unchanged
          if (currentSize < tracked.lastSize) {
            tracked.lastSize = 0;
          } else {
            return;
          }
        }

        try {
          const content = readFileSync(eventsPath, 'utf8');
          const newContent = content.slice(tracked.lastSize);
          tracked.lastSize = content.length;

          const lines = newContent.split('\n').filter(Boolean);
          const newEvents = [];
          for (const line of lines) {
            try {
              const evt = JSON.parse(line);
              evt.repo_id = tracked.repoId;
              newEvents.push(evt);
            } catch {}
          }

          if (newEvents.length > 0) {
            onNewEvents(tracked.repoId, newEvents);
          }
        } catch {}
      });
      watchedPaths.push(eventsPath);
    } catch {}
  }

  function stop() {
    for (const path of watchedPaths) {
      try { unwatchFile(path); } catch {}
    }
    trackedFiles.clear();
  }

  return { ok: true, stop };
}
