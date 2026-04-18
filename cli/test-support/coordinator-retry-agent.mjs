#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const root = process.cwd();
const repoId = basename(root);
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('coordinator-retry-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('coordinator-retry-agent: no active turns found');
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

const workstreamId = assignment.workstream_id || 'unknown-workstream';
const markerDir = join(root, '.agentxchain', 'mock-agent');
const failOnceMarker = join(markerDir, 'repo-b-failed-once');

function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

function writeTurnResult(filesChanged, summary) {
  const decisionIdByTarget = {
    'repo-a:ws-main': 'DEC-201',
    'repo-b:ws-main': 'DEC-202',
    'repo-a:ws-followup': 'DEC-203',
  };
  const decisionId = decisionIdByTarget[`${repoId}:${workstreamId}`] || 'DEC-299';
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary,
    decisions: [
      {
        id: decisionId,
        category: 'implementation',
        statement: `Executed ${workstreamId} in ${repoId} through the real local_cli adapter.`,
        rationale: 'Coordinator retry real-agent E2E proof.',
      },
    ],
    objections: [],
    files_changed: filesChanged,
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
}

mkdirSync(markerDir, { recursive: true });

if (repoId === 'repo-b' && !existsSync(failOnceMarker)) {
  writeFileSync(failOnceMarker, `${new Date().toISOString()}\n`);
  console.error('coordinator-retry-agent: simulated repo-b failure before staged result');
  process.exit(1);
}

const relPath = join('src', `${workstreamId}-${repoId}.js`);
ensureFile(
  relPath,
  `export const proof = ${JSON.stringify(`${workstreamId}:${repoId}`)};\n`,
);

writeTurnResult(
  [relPath],
  `Coordinator retry agent completed ${workstreamId} in ${repoId}.`,
);

console.log(`coordinator-retry-agent: completed ${workstreamId} in ${repoId}`);
