import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeWriteJson } from './safe-write.js';

const HANDOFF_DIR = '.agentxchain/multirepo/handoffs';

export function getCoordinatorHandoffDir(workspacePath) {
  return join(workspacePath, HANDOFF_DIR);
}

export function getCoordinatorHandoffPath(workspacePath, intentId) {
  return join(getCoordinatorHandoffDir(workspacePath), `${intentId}.json`);
}

export function writeCoordinatorHandoff(workspacePath, intentId, handoff) {
  const dir = getCoordinatorHandoffDir(workspacePath);
  mkdirSync(dir, { recursive: true });
  const filePath = getCoordinatorHandoffPath(workspacePath, intentId);
  safeWriteJson(filePath, handoff);
  return filePath;
}

export function readCoordinatorHandoff(workspacePath, intentId) {
  const filePath = getCoordinatorHandoffPath(workspacePath, intentId);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listCoordinatorHandoffs(workspacePath) {
  const dir = getCoordinatorHandoffDir(workspacePath);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json') && !entry.startsWith('.tmp-'))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(join(dir, entry), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function listWorkstreamHandoffs(workspacePath, workstreamId, superRunId) {
  return listCoordinatorHandoffs(workspacePath).filter((handoff) => (
    handoff.workstream_id === workstreamId
    && (!superRunId || handoff.super_run_id === superRunId)
  ));
}
