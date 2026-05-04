/**
 * Job Queue — in-memory FIFO queue with lease management.
 *
 * Implements execution plane spec behavior rules:
 *   - Rule 2: FIFO ordering within project
 *   - Rule 3: Exclusive leases with heartbeat-based liveness
 *   - Rule 4: Explicit finalization, crash-closed recovery (no auto-retry)
 *
 * @module job-queue
 */

import { randomUUID } from 'node:crypto';

const DEFAULT_LEASE_DURATION_MS = 600_000; // 10min (api_proxy)
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_STALE_THRESHOLD_MULTIPLIER = 2;

/**
 * Create an in-memory job queue.
 * @param {object} [options]
 * @param {number} [options.defaultLeaseDurationMs=600000]
 * @param {number} [options.heartbeatIntervalMs=30000]
 * @param {number} [options.staleThresholdMultiplier=2]
 * @returns {JobQueue}
 */
export function createJobQueue(options = {}) {
  const leaseDurationMs = options.defaultLeaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const staleMultiplier = options.staleThresholdMultiplier ?? DEFAULT_STALE_THRESHOLD_MULTIPLIER;
  const staleThresholdMs = heartbeatIntervalMs * staleMultiplier;

  /** @type {Map<string, Job>} */
  const jobs = new Map();

  /** @type {Map<string, ExecutionLease>} */
  const leases = new Map();

  function getLeaseDuration(runtimeClass) {
    if (runtimeClass === 'local_cli') return 1_800_000; // 30min
    return leaseDurationMs; // 10min default (api_proxy)
  }

  function enqueue(jobDef) {
    const job = {
      job_id: jobDef.job_id || randomUUID(),
      project_id: jobDef.project_id || null,
      run_id: jobDef.run_id,
      turn_id: jobDef.turn_id || null,
      role: jobDef.role,
      runtime_id: jobDef.runtime_id || null,
      runtime_class: jobDef.runtime_class || 'api_proxy',
      enqueued_at: Date.now(),
      status: 'waiting',
      lease: null,
    };
    jobs.set(job.job_id, job);
    return job.job_id;
  }

  function claim(workerId, runtimeClass) {
    for (const job of jobs.values()) {
      if (job.status !== 'waiting') continue;
      if (runtimeClass && job.runtime_class !== runtimeClass) continue;

      const now = Date.now();
      const duration = getLeaseDuration(job.runtime_class);
      const lease = {
        lease_id: randomUUID(),
        job_id: job.job_id,
        worker_id: workerId,
        claimed_at: now,
        expires_at: now + duration,
        heartbeat_at: now,
        attempt: (job.lease?.attempt || 0) + 1,
      };

      job.status = 'claimed';
      job.lease = lease;
      leases.set(lease.lease_id, lease);

      return { job, lease };
    }
    return null;
  }

  function heartbeat(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return false;
    const job = jobs.get(lease.job_id);
    if (!job || job.status !== 'claimed') return false;
    if (Date.now() > lease.expires_at) return false;
    lease.heartbeat_at = Date.now();
    return true;
  }

  function finalize(leaseId, result) {
    const lease = leases.get(leaseId);
    if (!lease) return false;
    const job = jobs.get(lease.job_id);
    if (!job) return false;

    job.status = result === 'completed' ? 'completed' : 'failed';
    leases.delete(leaseId);
    return true;
  }

  function expireStaleLeases() {
    const now = Date.now();
    const expired = [];
    for (const [leaseId, lease] of leases) {
      const elapsed = now - lease.heartbeat_at;
      if (elapsed > staleThresholdMs) {
        const job = jobs.get(lease.job_id);
        if (job && job.status === 'claimed') {
          job.status = 'needs_recovery';
          expired.push(lease.job_id);
        }
        leases.delete(leaseId);
      }
    }
    return expired;
  }

  function getJobs(filter) {
    const result = [];
    for (const job of jobs.values()) {
      if (filter && filter.status && job.status !== filter.status) continue;
      if (filter && filter.run_id && job.run_id !== filter.run_id) continue;
      result.push(job);
    }
    return result;
  }

  function getStatus() {
    const counts = { total: 0, waiting: 0, claimed: 0, completed: 0, failed: 0, needs_recovery: 0 };
    for (const job of jobs.values()) {
      counts.total++;
      counts[job.status] = (counts[job.status] || 0) + 1;
    }
    return counts;
  }

  return {
    enqueue,
    claim,
    heartbeat,
    finalize,
    expireStaleLeases,
    getJobs,
    getStatus,
  };
}
