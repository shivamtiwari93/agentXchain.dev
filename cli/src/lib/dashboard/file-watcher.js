/**
 * File watcher for the dashboard bridge server.
 *
 * Watches .agentxchain/ for changes and emits invalidation events
 * mapped to API resource paths. Debounces rapid successive changes.
 */

import { watch } from 'fs';
import { basename } from 'path';
import { EventEmitter } from 'events';
import { FILE_TO_RESOURCE } from './state-reader.js';

const DEBOUNCE_MS = 100;

export class FileWatcher extends EventEmitter {
  #watcher = null;
  #debounceTimers = new Map();
  #agentxchainDir;
  #closed = false;

  constructor(agentxchainDir) {
    super();
    this.#agentxchainDir = agentxchainDir;
  }

  start() {
    if (this.#watcher) return;
    try {
      this.#watcher = watch(this.#agentxchainDir, { recursive: false }, (eventType, filename) => {
        if (!filename || this.#closed) return;
        const base = basename(filename);
        const resource = FILE_TO_RESOURCE[base];
        if (!resource) return; // not a tracked file

        // Debounce: coalesce rapid changes to the same file
        if (this.#debounceTimers.has(base)) {
          clearTimeout(this.#debounceTimers.get(base));
        }
        this.#debounceTimers.set(base, setTimeout(() => {
          this.#debounceTimers.delete(base);
          if (!this.#closed) {
            this.emit('invalidate', { resource });
          }
        }, DEBOUNCE_MS));
      });

      this.#watcher.on('error', (err) => {
        if (!this.#closed) {
          this.emit('error', err);
        }
      });
    } catch (err) {
      this.emit('error', err);
    }
  }

  stop() {
    this.#closed = true;
    if (this.#watcher) {
      this.#watcher.close();
      this.#watcher = null;
    }
    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();
  }
}
