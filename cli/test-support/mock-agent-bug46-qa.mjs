#!/usr/bin/env node
/**
 * BUG-46 mock QA agent — authoritative QA that produces verification side-effects.
 *
 * Simulates the tester's exact BUG-46 scenario: an authoritative QA role that
 * creates repo files during verification (fixture outputs, acceptance artifacts)
 * and declares them via verification.produced_files with disposition: artifact.
 *
 * This is the CORRECT fix path (not the tester's broken path with empty
 * files_changed + no produced_files). The continuous loop must accept the turn,
 * promote the produced_files into files_changed, checkpoint, and resume.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();

// ── Read dispatch index ────────────────────────────────────────────────────
const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('mock-agent-bug46-qa: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('mock-agent-bug46-qa: no active turns in dispatch index');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const runId = index.run_id;

// ── Read ASSIGNMENT.json ──────────────────────────────────────────────────
const assignmentPath = join(root, `.agentxchain/dispatch/turns/${turnId}/ASSIGNMENT.json`);
let assignment = {};
if (existsSync(assignmentPath)) {
  assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
}

// ── Create the tester's exact 7 side-effect files ─────────────────────────
// These simulate verification commands that produce repo mutations.
const SIDE_EFFECT_PATHS = [
  '.planning/RELEASE_NOTES.md',
  '.planning/acceptance-matrix.md',
  '.planning/ship-verdict.md',
  'tests/fixtures/express-sample/tusq.manifest.json',
  'tests/fixtures/express-sample/tusq-tools/get_users_users.json',
  'tests/fixtures/express-sample/tusq-tools/index.json',
  'tests/fixtures/express-sample/tusq-tools/post_users_users.json',
];

function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

ensureFile('.planning/RELEASE_NOTES.md', '# Release Notes\n\n## Verification\n\nMock QA agent verification output.\n');
ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\n\n| Req | Status |\n|-----|--------|\n| 1 | pass |\n');
ensureFile('.planning/ship-verdict.md', '# Ship Verdict\n\n## Verdict: YES\n');
ensureFile('tests/fixtures/express-sample/tusq.manifest.json', '{"ok":true}\n');
ensureFile('tests/fixtures/express-sample/tusq-tools/get_users_users.json', '{"name":"get_users_users"}\n');
ensureFile('tests/fixtures/express-sample/tusq-tools/index.json', '{"name":"index"}\n');
ensureFile('tests/fixtures/express-sample/tusq-tools/post_users_users.json', '{"name":"post_users_users"}\n');

// ── Build intent response if intake context present ───────────────────────
const intentResponse = Array.isArray(assignment?.intake_context?.acceptance_contract)
  ? assignment.intake_context.acceptance_contract.map((item) => ({
      item,
      status: 'addressed',
      detail: `BUG-46 mock QA agent addressed acceptance item.`,
    }))
  : undefined;

// ── Write turn result — the CORRECT fix path ─────────────────────────────
// files_changed: [] (QA doesn't declare file mutations directly)
// verification.produced_files: artifact disposition (promotes into files_changed)
// artifact.type: workspace (because the role is authoritative and files are promoted)
const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: 'QA verified release candidate — fixture outputs promoted as artifact.',
  decisions: [{
    id: 'DEC-001',
    category: 'quality',
    statement: 'QA verification produced fixture outputs that should be checkpointed.',
    rationale: 'BUG-46 fix path: produced_files with artifact disposition.',
  }],
  objections: [],
  files_changed: [],
  verification: {
    status: 'pass',
    commands: ['echo ok'],
    evidence_summary: 'Verification commands produced 7 fixture files.',
    machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    produced_files: SIDE_EFFECT_PATHS.map((path) => ({
      path,
      disposition: 'artifact',
    })),
  },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: roleId,
  run_completion_request: null,
  needs_human_reason: null,
  intent_response: intentResponse,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`mock-agent-bug46-qa: ${roleId} completed (qa) → ${stagingResultPath}`);
