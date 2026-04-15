#!/usr/bin/env node
/**
 * Mock agent for replay roundtrip proof.
 *
 * Immediately completes the run with a single turn.
 * Designed for single-phase configs where the only goal
 * is to produce a complete governed run for export.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();

const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('replay-roundtrip-mock: no dispatch index');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('replay-roundtrip-mock: no active turns');
  process.exit(1);
}

const entry = turnEntries[0];
const { turn_id: turnId, role: roleId, runtime_id: runtimeId, staging_result_path: stagingResultPath } = entry;
const { run_id: runId, phase } = index;

const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Mock ${roleId} completed ${phase} — requesting run completion.`,
  decisions: [{
    id: 'DEC-001',
    category: 'implementation',
    statement: `${roleId} shipped ${phase}.`,
    rationale: 'Replay roundtrip proof mock.',
  }],
  objections: [],
  files_changed: ['src/mock.js'],
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
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`replay-roundtrip-mock: ${roleId} completed (${phase}) → ${stagingResultPath}`);
