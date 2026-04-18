#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('coordinator-child-run-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});

if (turnEntries.length === 0) {
  console.error('coordinator-child-run-agent: no active turns found');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

const assignmentPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = existsSync(assignmentPath)
  ? JSON.parse(readFileSync(assignmentPath, 'utf8'))
  : {};

function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

let filesChanged = [];
let phaseTransitionRequest = null;
let runCompletionRequest = false;

if (phase === 'planning') {
  ensureFile(
    '.planning/SYSTEM_SPEC.md',
    '# System Spec\n\n## Purpose\n\nCoordinator child-run E2E proof.\n\n## Interface\n\n- multi step dispatches repo-local turns\n- step executes the repo-local turn\n\n## Behavior\n\nPlanning produces durable planning artifacts for the coordinator workflow.\n\n## Acceptance Tests\n\n- Coordinator dispatch accepts through the real child-run path.\n',
  );
  ensureFile(
    '.planning/ROADMAP.md',
    '# Roadmap\n\n- planning\n- implementation\n',
  );
  filesChanged = ['.planning/SYSTEM_SPEC.md', '.planning/ROADMAP.md'];
  phaseTransitionRequest = 'implementation';
} else if (phase === 'implementation') {
  ensureFile('src/output.js', `export const proof = "${assignment.workstream_id || 'coordinator-child-run'}";\n`);
  ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\n## Changes\n\n- Executed the coordinator-dispatched child repo through the real local_cli adapter.\n\n## Verification\n\n- `agentxchain step`\n',
  );
  filesChanged = ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md'];
  runCompletionRequest = true;
} else {
  console.error(`coordinator-child-run-agent: unsupported phase "${phase}"`);
  process.exit(1);
}

const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Coordinator child-run agent completed ${phase}.`,
  decisions: [
    {
      id: phase === 'planning' ? 'DEC-101' : 'DEC-102',
      category: 'implementation',
      statement: `Completed ${phase} through the real repo-local adapter path.`,
      rationale: 'Coordinator child-run E2E proof.',
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
  phase_transition_request: phaseTransitionRequest,
  run_completion_request: runCompletionRequest,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`coordinator-child-run-agent: ${roleId} completed ${phase} for ${turnId}`);
