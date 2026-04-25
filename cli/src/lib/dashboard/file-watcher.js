/**
 * File watcher for the dashboard bridge server.
 *
 * Watches .agentxchain/ for changes and emits invalidation events
 * mapped to API resource paths. Debounces rapid successive changes.
 */

import { watch, existsSync } from 'fs';
import { basename, join } from 'path';
import { EventEmitter } from 'events';
import { WATCH_DIRECTORIES, RECURSIVE_WATCH_DIRECTORIES, resourcesForRelativePath } from './state-reader.js';

const DEBOUNCE_MS = 100;

export class FileWatcher extends EventEmitter {
  #watchers = new Map();
  #debounceTimers = new Map();
  #agentxchainDir;
  #closed = false;

  constructor(agentxchainDir) {
    super();
    this.#agentxchainDir = agentxchainDir;
  }

  #watchPath(relativeDir, { recursive = false } = {}) {
    if (this.#watchers.has(relativeDir)) {
      return;
    }

    const watchPath = relativeDir
      ? join(this.#agentxchainDir, relativeDir)
      : this.#agentxchainDir;
    if (!existsSync(watchPath)) {
      return;
    }

    try {
      const watcher = watch(watchPath, { recursive }, (eventType, filename) => {
        if (!filename || this.#closed) return;
        // For recursive watchers, filename includes subdirectory path
        const fileSegment = recursive ? filename.replace(/\\/g, '/') : basename(filename);
        const relativePath = relativeDir ? `${relativeDir}/${fileSegment}` : fileSegment;
        const resources = resourcesForRelativePath(relativePath);

        if (resources.length === 0) {
          if (!relativeDir && fileSegment === 'multirepo') {
            this.#watchPath('multirepo');
          }
          if (!relativeDir && fileSegment === 'watch-results') {
            this.#watchPath('watch-results');
            this.emit('invalidate', { resource: '/api/watch-results' });
          }
          return;
        }

        for (const resource of resources) {
          if (this.#debounceTimers.has(resource)) {
            clearTimeout(this.#debounceTimers.get(resource));
          }
          this.#debounceTimers.set(resource, setTimeout(() => {
            this.#debounceTimers.delete(resource);
            if (!this.#closed) {
              this.emit('invalidate', { resource });
            }
          }, DEBOUNCE_MS));
        }
      });

      watcher.on('error', (err) => {
        if (!this.#closed) {
          this.emit('error', err);
        }
      });

      this.#watchers.set(relativeDir, watcher);
    } catch (err) {
      this.emit('error', err);
    }
  }

  start() {
    if (this.#watchers.size > 0) return;
    for (const relativeDir of WATCH_DIRECTORIES) {
      this.#watchPath(relativeDir);
    }
    for (const relativeDir of RECURSIVE_WATCH_DIRECTORIES) {
      this.#watchPath(relativeDir, { recursive: true });
    }
  }

  stop() {
    this.#closed = true;
    for (const watcher of this.#watchers.values()) {
      watcher.close();
    }
    this.#watchers.clear();
    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();
  }
}
