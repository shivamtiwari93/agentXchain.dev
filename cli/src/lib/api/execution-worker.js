/**
 * Execution Worker — in-process worker that polls the job queue and executes
 * governed turns via run-loop + api_proxy adapter composition.
 *
 * Design rules:
 *   - Composes run-loop directly (protocol parity invariant)
 *   - Single turn per job (maxTurns: 1)
 *   - Heartbeat-based liveness per execution plane spec rule 3
 *   - Structured execution events per spec rule 6
 *
 * @module execution-worker
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runLoop } from '../run-loop.js';
import { dispatchApiProxy } from '../adapters/api-proxy-adapter.js';
import { getTurnStagingResultPath } from '../runner-interface.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Create an execution worker.
 * @param {object} options
 * @param {string} options.root - project root directory
 * @param {object} options.config - normalized config
 * @param {object} options.queue - job queue instance
 * @param {function} [options.onEvent] - structured event callback
 * @param {string} [options.workerId] - worker identifier
 * @param {number} [options.pollIntervalMs=2000] - queue poll interval
 * @returns {{ start(): void, stop(): void, getStatus(): object }}
 */
export function createExecutionWorker(options) {
  const {
    root,
    config,
    queue,
    onEvent,
    workerId = `worker-${randomUUID().slice(0, 8)}`,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  let running = false;
  let pollTimer = null;
  let currentJob = null;
  let currentAbort = null;

  function emit(type, data = {}) {
    if (!onEvent) return;
    try {
      onEvent({ type, worker_id: workerId, timestamp: new Date().toISOString(), ...data });
    } catch {
      // swallow event handler errors
    }
  }

  async function executeJob(job, lease) {
    currentJob = job;
    const abortController = new AbortController();
    currentAbort = abortController;

    emit('execution_started', { job_id: job.job_id, run_id: job.run_id, role: job.role });

    // Heartbeat interval
    const heartbeatTimer = setInterval(() => {
      const alive = queue.heartbeat(lease.lease_id);
      if (!alive) {
        abortController.abort();
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const result = await runLoop(root, config, {
        selectRole(state) {
          return job.role;
        },

        async dispatch(context) {
          const adapterResult = await dispatchApiProxy(root, context.state, config, {
            turnId: context.turn.turn_id,
            signal: abortController.signal,
          });

          if (!adapterResult.ok) {
            return { accept: false, reason: adapterResult.error || 'api_proxy dispatch failed' };
          }

          // api_proxy stages to disk; read back for run-loop acceptance
          const stagingFile = join(root, getTurnStagingResultPath(context.turn.turn_id));
          if (!existsSync(stagingFile)) {
            return { accept: false, reason: 'adapter completed but no staged result found' };
          }

          let turnResult;
          try {
            turnResult = JSON.parse(readFileSync(stagingFile, 'utf8'));
          } catch (err) {
            return { accept: false, reason: `failed to parse staged result: ${err.message}` };
          }

          return { accept: true, turnResult };
        },

        approveGate() {
          return true; // auto-approve in hosted mode
        },

        onEvent(event) {
          emit('execution_progress', { job_id: job.job_id, event });
        },
      }, { maxTurns: 1 });

      clearInterval(heartbeatTimer);

      const success = result.ok;
      queue.finalize(lease.lease_id, success ? 'completed' : 'failed');

      emit(success ? 'execution_completed' : 'execution_interrupted', {
        job_id: job.job_id,
        run_id: job.run_id,
        result_status: result.stop_reason || (success ? 'completed' : 'failed'),
        turns_executed: result.turnsExecuted,
      });

      return result;
    } catch (err) {
      clearInterval(heartbeatTimer);
      queue.finalize(lease.lease_id, 'failed');

      emit('execution_interrupted', {
        job_id: job.job_id,
        run_id: job.run_id,
        error: err.message,
      });

      return null;
    } finally {
      currentJob = null;
      currentAbort = null;
    }
  }

  async function poll() {
    if (!running) return;

    const claimed = queue.claim(workerId);
    if (claimed) {
      await executeJob(claimed.job, claimed.lease);
    }

    // Expire stale leases periodically
    queue.expireStaleLeases();

    // Schedule next poll
    if (running) {
      pollTimer = setTimeout(poll, pollIntervalMs);
    }
  }

  function start() {
    if (running) return;
    running = true;
    emit('worker_started', {});
    // Start polling immediately
    pollTimer = setTimeout(poll, 0);
  }

  function stop() {
    running = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (currentAbort) {
      currentAbort.abort();
    }
    emit('worker_stopped', {});
  }

  function getStatus() {
    return {
      worker_id: workerId,
      running,
      current_job: currentJob ? currentJob.job_id : null,
    };
  }

  return { start, stop, getStatus };
}
