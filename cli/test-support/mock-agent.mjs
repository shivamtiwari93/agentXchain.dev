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
  ensureFile('.planning/ROADMAP.md', '# Roadmap\n\n## Phases\n\n- planning\n- implementation\n- qa\n');
  ensureFile(
    '.planning/SYSTEM_SPEC.md',
    '# System Spec\n\n## Purpose\n\nMock governed project for integration testing.\n\n## Interface\n\nagentxchain run --auto-approve completes a 3-turn lifecycle.\n\n## Acceptance Tests\n\n- [ ] Run completes with exit 0 and 3 turns executed.\n',
  );
}

if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\n');
  ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\n## Changes\n\nImplemented the integration-test governed artifact output.\n\n## Verification\n\nRun the governed integration test flow and confirm the implementation phase exits cleanly.\n',
  );
}

if (phase === 'qa') {
  ensureFile(
    '.planning/acceptance-matrix.md',
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Mock governed run | QA confirms the mocked governed run can complete end to end | pass | 2026-04-06 | pass |\n',
  );
  ensureFile('.planning/ship-verdict.md', '# Ship Verdict\n\n## Verdict: YES\n');
  ensureFile(
    '.planning/RELEASE_NOTES.md',
    '# Release Notes\n\n## User Impact\n\nMock governed run completed successfully through QA.\n\n## Verification Summary\n\nIntegration-test mock agent created the full workflow-kit artifact set required by the shipped gates.\n',
  );
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
  files_changed:
    phase === 'planning'
      ? ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md']
      : phase === 'implementation'
        ? ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md']
        : phase === 'qa'
          ? ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md']
          : [],
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
