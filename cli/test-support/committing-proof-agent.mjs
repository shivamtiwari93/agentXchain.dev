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
const sessionPath = join(root, '.agentxchain', 'continuous-session.json');
const session = existsSync(sessionPath)
  ? JSON.parse(readFileSync(sessionPath, 'utf8'))
  : null;
const sessionId = session?.session_id || 'cont-unknown';
const currentObjective = String(session?.current_vision_objective || runId);
const objectiveSlug = currentObjective
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64) || runId;

function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  const current = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  if (current === content) return false;
  writeFileSync(absPath, content);
  return true;
}

function ensureFileOnce(relPath, content) {
  const absPath = join(root, relPath);
  if (existsSync(absPath)) return false;
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
  return true;
}

const filesChanged = [];

if (phase === 'planning') {
  if (ensureFile(
    '.planning/PM_SIGNOFF.md',
    `# PM Signoff\n\nApproved: YES\n\n## Notes\n\nContinuous proof gate baseline.\n`,
  )) filesChanged.push('.planning/PM_SIGNOFF.md');
  if (ensureFile(
    '.planning/ROADMAP.md',
    '# Roadmap\n\n## Phases\n\n- planning\n- implementation\n- qa\n',
  )) filesChanged.push('.planning/ROADMAP.md');
  if (ensureFile(
    '.planning/SYSTEM_SPEC.md',
    '# System Spec\n\n## Purpose\n\nLive continuous mixed-runtime proof.\n\n## Interface\n\n- local authoring roles commit their slice before the next turn\n- QA reviews through api_proxy\n\n## Acceptance Tests\n\n- [ ] Planning artifacts committed\n- [ ] Implementation artifacts committed\n- [ ] QA review completes through api_proxy\n',
  )) filesChanged.push('.planning/SYSTEM_SPEC.md');
  if (ensureFile(
    `.planning/proof-objectives/${objectiveSlug}.md`,
    `# Proof Objective\n\n- Session: ${sessionId}\n- Run: ${runId}\n- Objective: ${currentObjective}\n- Phase: planning\n`,
  )) filesChanged.push(`.planning/proof-objectives/${objectiveSlug}.md`);
}

if (phase === 'implementation') {
  if (ensureFileOnce(
    'src/output.js',
    'export const liveContinuousProof = true;\n',
  )) filesChanged.push('src/output.js');
  if (ensureFile(
    `src/objectives/${objectiveSlug}.js`,
    `export const sessionId = ${JSON.stringify(sessionId)};\nexport const runId = ${JSON.stringify(runId)};\nexport const objective = ${JSON.stringify(currentObjective)};\n`,
  )) filesChanged.push(`src/objectives/${objectiveSlug}.js`);
  if (ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\n## Changes\n\n- Added a committed implementation artifact for the live mixed-runtime proof.\n- Kept the working tree clean so the next authoritative turn can be assigned truthfully.\n\n## Verification\n\n- `node -e "import(\'./src/output.js\').then((m) => console.log(m.liveContinuousProof))"`\n',
  )) filesChanged.push('.planning/IMPLEMENTATION_NOTES.md');
  if (ensureFile(
    `.planning/implementation-objectives/${objectiveSlug}.md`,
    `# Implementation Objective\n\n- Session: ${sessionId}\n- Run: ${runId}\n- Objective: ${currentObjective}\n- Phase: implementation\n`,
  )) filesChanged.push(`.planning/implementation-objectives/${objectiveSlug}.md`);
}

let phaseTransitionRequest = null;
let proposedNextRole = 'human';
if (phase === 'planning') {
  phaseTransitionRequest = 'implementation';
} else if (phase === 'implementation') {
  phaseTransitionRequest = 'qa';
  proposedNextRole = 'qa';
}

execSync('git add -A', { cwd: root, stdio: 'pipe' });
execSync('git config user.name "proof"', { cwd: root, stdio: 'pipe' });
execSync('git config user.email "proof@example.com"', { cwd: root, stdio: 'pipe' });
execSync(`git commit -m "proof(${phase}): ${runId} ${objectiveSlug}

Continuous-Session: ${sessionId}
Co-Authored-By: GPT 5.4 (Codex) <noreply@openai.com>"`, {
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
