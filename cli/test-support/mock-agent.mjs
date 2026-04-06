#!/usr/bin/env node
/**
 * Mock agent for integration testing `agentxchain run`.
 *
 * This script simulates a governed agent by:
 *   1. Reading the dispatch index to find its turn assignment
 *   2. Reading ASSIGNMENT.json to get role and turn metadata
 *   3. Creating phase-required gate files
 *   4. Writing a valid turn-result.json to the staging path
 *
 * Runtime config should use: { command: "node", args: ["<path-to-this-file>"] }
 * with prompt_transport: "dispatch_bundle_only".
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();

// ── Read dispatch index to find our turn ────────────────────────────────────
const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('mock-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('mock-agent: no active turns in dispatch index');
  process.exit(1);
}

// Take the first (and typically only) active turn
const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

// ── Read ASSIGNMENT.json for full context ───────────────────────────────────
const assignmentPath = join(root, `.agentxchain/dispatch/turns/${turnId}/ASSIGNMENT.json`);
let assignment = {};
if (existsSync(assignmentPath)) {
  assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
}

// ── Create gate-required files based on phase ───────────────────────────────
function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

if (phase === 'planning') {
  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\n\nApproved: YES\n');
  ensureFile('.planning/ROADMAP.md', '# Roadmap\nMock roadmap for integration test.\n');
}

if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\n');
}

if (phase === 'qa') {
  ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\nAll passed.\n');
  ensureFile('.planning/ship-verdict.md', '# Ship Verdict\n\n## Verdict: YES\n');
}

// ── Determine phase transition / completion request ─────────────────────────
let phaseTransitionRequest = null;
let runCompletionRequest = null;
let proposedNextRole = 'human';

if (phase === 'planning') {
  phaseTransitionRequest = 'implementation';
  proposedNextRole = 'human';
} else if (phase === 'implementation') {
  phaseTransitionRequest = 'qa';
  proposedNextRole = 'qa';
} else if (phase === 'qa') {
  runCompletionRequest = true;
  proposedNextRole = 'human';
}

// ── Write turn result ───────────────────────────────────────────────────────
const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Mock ${roleId} completed ${phase} phase.`,
  decisions: [{
    id: 'DEC-001',
    category: 'implementation',
    statement: `${roleId} completed governed slice in ${phase}.`,
    rationale: 'Integration test mock.',
  }],
  objections: [{
    id: 'OBJ-001',
    severity: 'low',
    statement: `Mock objection from ${roleId}.`,
    status: 'raised',
  }],
  files_changed: [],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['echo ok'],
    evidence_summary: 'pass',
    machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
  },
  artifact: { type: roleId === 'dev' ? 'workspace' : 'review', ref: null },
  proposed_next_role: proposedNextRole,
  phase_transition_request: phaseTransitionRequest,
  run_completion_request: runCompletionRequest,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`mock-agent: ${roleId} completed (${phase}) → ${stagingResultPath}`);
