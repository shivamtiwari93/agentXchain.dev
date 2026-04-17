#!/usr/bin/env node
/**
 * Git-clean local proof agent for live CLI proofs.
 *
 * This preserves the real git-backed admission rule for authoritative turns:
 * actor-owned files cannot remain dirty between authoritative assignments.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const root = process.cwd();

const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('committing-proof-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('committing-proof-agent: no active turns in dispatch index');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

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
    '# System Spec\n\n## Purpose\n\nLive continuous mixed-runtime proof.\n\n## Interface\n\n- local authoring roles commit their slice before the next turn\n- QA reviews through api_proxy\n\n## Acceptance Tests\n\n- [ ] Planning artifacts committed\n- [ ] Implementation artifacts committed\n- [ ] QA review completes through api_proxy\n',
  );
}

if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const liveContinuousProof = true;\n');
  ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\n## Changes\n\n- Added a committed implementation artifact for the live mixed-runtime proof.\n- Kept the working tree clean so the next authoritative turn can be assigned truthfully.\n\n## Verification\n\n- `node -e "import(\'./src/output.js\').then((m) => console.log(m.liveContinuousProof))"`\n',
  );
}

let phaseTransitionRequest = null;
let proposedNextRole = 'human';
if (phase === 'planning') {
  phaseTransitionRequest = 'implementation';
} else if (phase === 'implementation') {
  phaseTransitionRequest = 'qa';
  proposedNextRole = 'qa';
}

const filesChanged = phase === 'planning'
  ? ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md']
  : phase === 'implementation'
    ? ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md']
    : [];

execSync('git add -A', { cwd: root, stdio: 'pipe' });
execSync(`git commit -m "proof(${phase}): commit authored slice"`, {
  cwd: root,
  stdio: 'pipe',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'proof',
    GIT_AUTHOR_EMAIL: 'proof@example.com',
    GIT_COMMITTER_NAME: 'proof',
    GIT_COMMITTER_EMAIL: 'proof@example.com',
  },
});

const verificationCommand = phase === 'implementation'
  ? 'node -e "import(\'./src/output.js\').then((m) => console.log(m.liveContinuousProof))"'
  : 'echo ok';

const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Committing proof agent completed ${phase} phase.`,
  decisions: [{
    id: 'DEC-001',
    category: 'implementation',
    statement: `${roleId} completed and committed the ${phase} slice.`,
    rationale: 'Real git-backed proofs need a clean baseline between authoritative turns.',
  }],
  objections: [{
    id: 'OBJ-001',
    severity: 'low',
    statement: 'Proof scope is intentionally narrow and optimized for runtime truth, not feature breadth.',
    status: 'raised',
  }],
  files_changed: filesChanged,
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: [verificationCommand],
    evidence_summary: 'Local authoritative slice committed cleanly.',
    machine_evidence: [{ command: verificationCommand, exit_code: 0 }],
  },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: proposedNextRole,
  phase_transition_request: phaseTransitionRequest,
  run_completion_request: null,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`committing-proof-agent: ${roleId} completed (${phase})`);
