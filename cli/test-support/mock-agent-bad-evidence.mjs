#!/usr/bin/env node
/**
 * Mock agent that writes MISMATCHED machine evidence for testing
 * require_reproducible_verification policy enforcement.
 *
 * Identical to mock-agent.mjs except:
 * - machine_evidence declares exit_code: 0 for a command that actually exits 1
 * - This should cause the reproducible verification replay to detect a mismatch
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();

// ── Read dispatch index to find our turn ────────────────────────────────────
const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('mock-agent-bad-evidence: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('mock-agent-bad-evidence: no active turns in dispatch index');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

// ── Create gate-required files based on phase ───────────────────────────────
function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

if (phase === 'planning') {
  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\n\nApproved: YES\n');
  ensureFile('.planning/ROADMAP.md', '# Roadmap\n\n## Phases\n\n- planning\n- implementation\n- qa\n');
}

if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\n');
  ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\n## Changes\n\nBad-evidence fixture.\n\n## Verification\n\nDeliberately mismatched.\n',
  );
}

if (phase === 'qa') {
  ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\n\n| Req # | Status |\n|-------|--------|\n| 1 | pass |\n');
  ensureFile('.planning/ship-verdict.md', '# Ship Verdict\n\n## Verdict: YES\n');
  ensureFile('.planning/RELEASE_NOTES.md', '# Release Notes\n\nBad-evidence fixture.\n');
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

// ── Write turn result with MISMATCHED machine evidence ──────────────────────
// Claims exit_code: 0, but the command `node -e "process.exit(1)"` actually exits 1.
// The reproducible verification replay should detect this mismatch and block.
const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Mock ${roleId} completed ${phase} with bad evidence.`,
  decisions: [{
    id: 'DEC-001',
    category: 'implementation',
    statement: `${roleId} completed governed slice in ${phase}.`,
    rationale: 'Bad-evidence integration test mock.',
  }],
  objections: [{
    id: 'OBJ-001',
    severity: 'low',
    statement: `Mock objection from ${roleId}.`,
    status: 'raised',
  }],
  files_changed:
    phase === 'planning'
      ? ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md']
      : phase === 'implementation'
        ? ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md']
        : phase === 'qa'
          ? ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md']
          : [],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['node -e "process.exit(1)"'],
    evidence_summary: 'Deliberately mismatched evidence.',
    machine_evidence: [{ command: 'node -e "process.exit(1)"', exit_code: 0 }],
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

console.log(`mock-agent-bad-evidence: ${roleId} completed (${phase}) → ${stagingResultPath}`);
