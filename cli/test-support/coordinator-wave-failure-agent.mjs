#!/usr/bin/env node

/**
 * Mock agent for coordinator wave-failure E2E proof.
 *
 * Behavior:
 *   - repo-a: always exits with code 1 (no staged result) to simulate execution failure
 *   - repo-b: writes a staged result and exits with code 0
 *
 * This agent is purpose-built for the two coordinator wave-failure scenarios:
 *   FAIL-001: repo-a fails first → wave stops → repo-b is never dispatched
 *   FAIL-002: repo-b succeeds first → repo-a fails → plan_incomplete
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const root = process.cwd();
const repoId = basename(root);
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('coordinator-wave-failure-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('coordinator-wave-failure-agent: no active turns found');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const runtimeId = entry.runtime_id;
const roleId = entry.role;
const stagingResultPath = entry.staging_result_path;
const runId = index.run_id;

const assignmentPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = existsSync(assignmentPath)
  ? JSON.parse(readFileSync(assignmentPath, 'utf8'))
  : {};

// repo-a always fails — simulates an execution crash with no staged result
if (repoId === 'repo-a') {
  console.error(`coordinator-wave-failure-agent: repo-a execution failure`);
  process.exit(1);
}

// repo-b always succeeds — writes implementation artifact + staged result
function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

const relPath = join('src', 'output.js');
ensureFile(relPath, `export const proof = ${JSON.stringify(`wave-failure:${repoId}`)};\n`);

const result = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Wave failure agent completed in ${repoId}.`,
  decisions: [
    {
      id: 'DEC-301',
      category: 'implementation',
      statement: `Executed wave-failure proof in ${repoId} through the real local_cli adapter.`,
      rationale: 'Coordinator wave-failure real-agent E2E proof.',
    },
  ],
  objections: [],
  files_changed: [relPath],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['echo ok'],
    evidence_summary: 'pass',
    machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
  },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: 'human',
  phase_transition_request: null,
  run_completion_request: true,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(result, null, 2));

console.log(`coordinator-wave-failure-agent: completed in ${repoId}`);
