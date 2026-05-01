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

import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import {
  isDispatchProgressDiagnosticStream,
  isDispatchProgressProofOutputStream,
} from './dispatch-streams.js';

export const LEGACY_DISPATCH_PROGRESS_PATH = '.agentxchain/dispatch-progress.json';
export const DISPATCH_PROGRESS_FILE_PREFIX = '.agentxchain/dispatch-progress-';

export function getDispatchProgressRelativePath(turnId) {
  return `${DISPATCH_PROGRESS_FILE_PREFIX}${turnId}.json`;
}

function getDispatchProgressFilePath(root, turnId) {
  return join(root, getDispatchProgressRelativePath(turnId));
}

function listDispatchProgressFiles(root) {
  const agentxchainDir = join(root, '.agentxchain');
  if (!existsSync(agentxchainDir)) return [];
  try {
    return readdirSync(agentxchainDir)
      .filter((entry) => entry.startsWith('dispatch-progress-') && entry.endsWith('.json'))
      .map((entry) => join(agentxchainDir, entry));
  } catch {
    return [];
  }
}

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

  const filePath = getDispatchProgressFilePath(root, turn.turn_id);

  let state = {
    turn_id: turn.turn_id,
    runtime_id: turn.runtime_id || null,
    adapter_type,
    started_at: null,
    first_output_at: null,
    last_activity_at: null,
    activity_type: 'starting',
    activity_summary: 'Waiting for first output',
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
      state.activity_type = 'starting';
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
      // DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 (Turn 88) extended to the
      // progress tracker in Turn 89: stderr is diagnostic evidence, not usable
      // startup proof. Only stdout may set `first_output_at`. stderr still
      // increments `stderr_lines` for silence detection and diagnostics.
      let recognizedActivity = false;
      if (isDispatchProgressDiagnosticStream(stream)) {
        state.stderr_lines += lineCount;
        recognizedActivity = true;
      } else if (isDispatchProgressProofOutputStream(stream)) {
        state.first_output_at = state.first_output_at || now;
        state.output_lines += lineCount;
        recognizedActivity = true;
      }
      // DEC-BUG54-DIAGNOSTIC-ACTIVITY-TYPE-001 (Turn 91): activity_type and
      // activity_summary must reflect whether operator-usable stdout proof has
      // arrived. A stderr-only subprocess that never attached stdout must NOT
      // be rendered as "Producing output" on the operator status surface —
      // that is a false live-progress signal for a failing startup. Only when
      // `output_lines > 0` may we claim 'output'; otherwise recognized stderr
      // activity is surfaced as 'diagnostic_only'. Unknown stream labels do
      // not mutate activity_type (Turn 90 closed-vocabulary contract).
      if (recognizedActivity) {
        if (state.output_lines > 0) {
          state.activity_type = 'output';
          state.activity_summary = `Producing output (${state.output_lines} lines)`;
        } else {
          state.activity_type = 'diagnostic_only';
          state.activity_summary = `Diagnostic output only (${state.stderr_lines} stderr lines)`;
        }
        state.silent_since = null;
      }
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

    /** Record adapter keepalive without treating it as governed startup proof. */
    heartbeat(summary = 'Adapter keepalive') {
      state.activity_type = 'heartbeat';
      state.activity_summary = summary;
      state.last_activity_at = new Date().toISOString();
      dirty = true;
      maybeWrite();
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
      deleteProgressFile(root, turn.turn_id);
    },

    /** Clean up — dispatch failed. */
    fail() {
      if (silenceTimer) clearTimeout(silenceTimer);
      deleteProgressFile(root, turn.turn_id);
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
export function deleteProgressFile(root, turnId = null) {
  try {
    if (turnId) {
      const filePath = getDispatchProgressFilePath(root, turnId);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      return;
    }

    const legacyPath = join(root, LEGACY_DISPATCH_PROGRESS_PATH);
    if (existsSync(legacyPath)) {
      unlinkSync(legacyPath);
    }
    for (const filePath of listDispatchProgressFiles(root)) {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
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
export function readDispatchProgress(root, turnId = null) {
  try {
    let filePath;
    if (turnId) {
      filePath = getDispatchProgressFilePath(root, turnId);
      if (!existsSync(filePath)) return null;
    } else {
      const files = listDispatchProgressFiles(root);
      if (files.length === 0) {
        const legacyPath = join(root, LEGACY_DISPATCH_PROGRESS_PATH);
        if (!existsSync(legacyPath)) return null;
        filePath = legacyPath;
      } else if (files.length === 1) {
        filePath = files[0];
      } else {
        return null;
      }
    }
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.turn_id || !data.started_at) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Read all current per-turn dispatch progress files.
 *
 * @param {string} root - project root
 * @returns {Record<string, object>}
 */
export function readAllDispatchProgress(root) {
  const progressByTurn = {};

  for (const filePath of listDispatchProgressFiles(root)) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const turnId = typeof data?.turn_id === 'string' && data.turn_id.length > 0
        ? data.turn_id
        : basename(filePath).replace(/^dispatch-progress-/, '').replace(/\.json$/, '');
      if (!turnId || !data?.started_at) continue;
      progressByTurn[turnId] = data;
    } catch {
      // Ignore malformed files.
    }
  }

  if (Object.keys(progressByTurn).length === 0) {
    const legacy = readDispatchProgress(root);
    if (legacy?.turn_id) {
      progressByTurn[legacy.turn_id] = legacy;
    }
  }

  return progressByTurn;
}
