/**
 * In-memory job store for V0 prototype. No persistence across restarts.
 */

import type { Job } from "./data";

const jobs = new Map<string, Job>();

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `job-${idCounter}-${Date.now()}`;
}

export function createJob(agentSlug: string, input: string): Job {
  const job: Job = {
    id: nextId(),
    agentSlug,
    input,
    status: "queued",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function setJobStatus(
  id: string,
  status: Job["status"],
  result?: string,
  error?: string
): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  job.status = status;
  if (result !== undefined) job.result = result;
  if (error !== undefined) job.error = error;
  return job;
}
