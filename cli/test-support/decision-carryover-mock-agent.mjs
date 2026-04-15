#!/usr/bin/env node
/**
 * Mock agent for cross-run decision carryover proof.
 *
 * Behavior varies by AGENTXCHAIN_CARRYOVER_MODE env var:
 *   "repo-decision"   — emits a decision with durability: "repo"
 *   "override"        — emits a decision that overrides DEC-REPO-001
 *   default           — emits a normal run-scoped decision
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();
const mode = process.env.AGENTXCHAIN_CARRYOVER_MODE || 'normal';

const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('decision-carryover-mock: no dispatch index');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('decision-carryover-mock: no active turns');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

// Build decisions based on mode
const decisions = [];
if (mode === 'repo-decision') {
  decisions.push({
    id: 'DEC-100',
    category: 'architecture',
    statement: 'All API endpoints must use JSON:API format.',
    rationale: 'Standardize API response format across the project.',
    durability: 'repo',
  });
} else if (mode === 'override') {
  decisions.push({
    id: 'DEC-200',
    category: 'architecture',
    statement: 'API endpoints should use GraphQL instead of JSON:API.',
    rationale: 'Team decided GraphQL better fits our use case.',
    durability: 'repo',
    overrides: 'DEC-100',
  });
} else {
  decisions.push({
    id: 'DEC-001',
    category: 'implementation',
    statement: 'Normal run-scoped decision.',
    rationale: 'Standard implementation decision.',
  });
}

const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Mock ${roleId} completed with ${mode} decision mode.`,
  decisions,
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
  run_completion_request: true,
  phase_transition_request: null,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));

console.log(`decision-carryover-mock: ${roleId} (${mode}) → ${stagingResultPath}`);
