/**
 * dispatch-progress.js — Real-time adapter dispatch progress tracking.
 *
 * Writes `.agentxchain/dispatch-progress.json` during in-flight adapter
 * dispatch so operators can distinguish "adapter is working" from "adapter
 * is hung" via `agentxchain status` and the dashboard file-watcher.
 *
 * DEC-DISPATCH-PROGRESS-001: progress writes are best-effort and never
 * block or delay the governed turn.
 */

import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const DISPATCH_PROGRESS_PATH = '.agentxchain/dispatch-progress.json';

/**
 * Create a dispatch progress tracker for a single turn.
 *
 * Usage:
 *   const tracker = createDispatchProgressTracker(root, turn, runtime);
 *   tracker.start();
 *   // ... during dispatch:
 *   tracker.onOutput('stdout', lineCount);
 *   tracker.onOutput('stderr', lineCount);
 *   // ... when done:
 *   tracker.complete();  // or tracker.fail();
 *
 * @param {string} root - project root
 * @param {object} turn - turn object with turn_id, runtime_id, assigned_role
 * @param {object} options
 * @param {string} options.adapter_type - 'local_cli' | 'api_proxy' | 'mcp' | 'remote_agent'
 * @param {number} [options.pid] - subprocess PID (local_cli only)
 * @param {number} [options.writeIntervalMs=1000] - min interval between file writes
 * @param {number} [options.silenceThresholdMs=30000] - silence detection threshold
 * @returns {DispatchProgressTracker}
 */
export function createDispatchProgressTracker(root, turn, options = {}) {
  const {
    adapter_type = 'local_cli',
    pid = null,
    writeIntervalMs = 1000,
    silenceThresholdMs = 30000,
  } = options;

  const filePath = join(root, DISPATCH_PROGRESS_PATH);

  let state = {
    turn_id: turn.turn_id,
    runtime_id: turn.runtime_id || null,
    adapter_type,
    started_at: null,
    last_activity_at: null,
    activity_type: 'output',
    activity_summary: 'Dispatch starting',
    output_lines: 0,
    stderr_lines: 0,
    silent_since: null,
    pid,
  };

  let lastWriteAt = 0;
  let silenceTimer = null;
  let dirty = false;

  function writeProgress() {
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
      lastWriteAt = Date.now();
      dirty = false;
    } catch {
      // Best-effort — never interrupt dispatch.
    }
  }

  function maybeWrite() {
    if (!dirty) return;
    const now = Date.now();
    if (now - lastWriteAt >= writeIntervalMs) {
      writeProgress();
    }
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      state.activity_type = 'silent';
      state.silent_since = state.silent_since || new Date().toISOString();
      state.activity_summary = `No output for ${Math.round(silenceThresholdMs / 1000)}s`;
      dirty = true;
      writeProgress();
    }, silenceThresholdMs);
  }

  return {
    /** Start tracking — call once at dispatch start. */
    start() {
      const now = new Date().toISOString();
      state.started_at = now;
      state.last_activity_at = now;
      state.activity_type = 'output';
      state.activity_summary = 'Subprocess started';
      dirty = true;
      writeProgress();
      if (adapter_type === 'local_cli') {
        resetSilenceTimer();
      }
    },

    /** Record output activity from the subprocess. */
    onOutput(stream, lineCount = 1) {
      const now = new Date().toISOString();
      const wasSilent = state.activity_type === 'silent';
      state.last_activity_at = now;
      state.activity_type = 'output';
      state.silent_since = null;
      if (stream === 'stderr') {
        state.stderr_lines += lineCount;
      } else {
        state.output_lines += lineCount;
      }
      state.activity_summary = `Producing output (${state.output_lines} lines)`;
      dirty = true;
      maybeWrite();
      if (adapter_type === 'local_cli') {
        resetSilenceTimer();
      }
      return wasSilent; // caller can use this to emit a "resumed" event
    },

    /** Mark as API request in flight (api_proxy, mcp, remote_agent). */
    requestStarted() {
      state.activity_type = 'request';
      state.activity_summary = 'API request in flight';
      state.last_activity_at = new Date().toISOString();
      dirty = true;
      writeProgress();
    },

    /** Mark API response received. */
    responseReceived() {
      state.activity_type = 'response';
      state.activity_summary = 'API response received';
      state.last_activity_at = new Date().toISOString();
      dirty = true;
      writeProgress();
    },

    /** Update PID after spawn (local_cli). */
    setPid(newPid) {
      state.pid = newPid;
      dirty = true;
      maybeWrite();
    },

    /** Get current progress state snapshot. */
    getState() {
      return { ...state };
    },

    /** Clean up — dispatch completed successfully. */
    complete() {
      if (silenceTimer) clearTimeout(silenceTimer);
      deleteProgressFile(root);
    },

    /** Clean up — dispatch failed. */
    fail() {
      if (silenceTimer) clearTimeout(silenceTimer);
      deleteProgressFile(root);
    },

    /** Clean up timers without deleting file (for abort paths). */
    dispose() {
      if (silenceTimer) clearTimeout(silenceTimer);
    },
  };
}

/**
 * Delete the dispatch progress file.
 * @param {string} root - project root
 */
export function deleteProgressFile(root) {
  try {
    const filePath = join(root, DISPATCH_PROGRESS_PATH);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best-effort.
  }
}

/**
 * Read the current dispatch progress file.
 * Returns null if no file exists or it's malformed.
 *
 * @param {string} root - project root
 * @returns {object|null}
 */
export function readDispatchProgress(root) {
  try {
    const filePath = join(root, DISPATCH_PROGRESS_PATH);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.turn_id || !data.started_at) return null;
    return data;
  } catch {
    return null;
  }
}
