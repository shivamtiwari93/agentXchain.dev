#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('delegation-mock-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const entry = Object.values(index.active_turns || {})[0];
if (!entry) {
  console.error('delegation-mock-agent: no active turn in dispatch index');
  process.exit(1);
}

const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const runId = index.run_id;
const assignmentPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = existsSync(assignmentPath) ? JSON.parse(readFileSync(assignmentPath, 'utf8')) : {};

function ensureJson(relPath, value) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n');
}

function writeTurnResult(turnResult) {
  const absPath = join(root, entry.staging_result_path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(turnResult, null, 2) + '\n');
}

function baseResult(summary, filesChanged, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: summary,
        rationale: 'Delegation CLI proof mock agent',
      },
    ],
    objections: [],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo delegation-proof'],
      evidence_summary: 'delegation-proof',
      machine_evidence: [{ command: 'echo delegation-proof', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    ...overrides,
  };
}

if (assignment.delegation_review) {
  const relPath = '.agentxchain/proof/delegation/review-turn.json';
  ensureJson(relPath, {
    turn_id: turnId,
    role: roleId,
    parent_turn_id: assignment.delegation_review.parent_turn_id,
    delegation_ids: assignment.delegation_review.results.map((item) => item.delegation_id),
    child_turn_ids: assignment.delegation_review.results.map((item) => item.child_turn_id),
    to_roles: assignment.delegation_review.results.map((item) => item.to_role),
    result_count: assignment.delegation_review.results.length,
  });
  writeTurnResult(
    baseResult(
      'Director reviewed delegated results and approved run completion.',
      [relPath],
      {
        run_completion_request: true,
      },
    ),
  );
  process.exit(0);
}

if (assignment.delegation_context) {
  const delegationId = assignment.delegation_context.delegation_id;
  const relPath = `.agentxchain/proof/delegation/${delegationId}.json`;
  ensureJson(relPath, {
    turn_id: turnId,
    role: roleId,
    delegation_id: delegationId,
    parent_turn_id: assignment.delegation_context.parent_turn_id,
    parent_role: assignment.delegation_context.parent_role,
    charter: assignment.delegation_context.charter,
    acceptance_contract: assignment.delegation_context.acceptance_contract,
  });
  writeTurnResult(
    baseResult(
      `${roleId} executed delegated work for ${delegationId}.`,
      [relPath],
      {
        proposed_next_role: roleId === 'dev' ? 'qa' : 'director',
      },
    ),
  );
  process.exit(0);
}

const seedPath = '.agentxchain/proof/delegation/seed-turn.json';
ensureJson(seedPath, {
  turn_id: turnId,
  role: roleId,
  delegation_context: false,
  delegation_review: false,
});
writeTurnResult(
  baseResult(
    'Director decomposed delivery into implementation and QA delegations.',
    [seedPath],
    {
      proposed_next_role: 'dev',
      delegations: [
        {
          id: 'del-001',
          to_role: 'dev',
          charter: 'Implement the delegated delivery slice',
          acceptance_contract: ['Implementation summary is complete', 'Delegation proof artifact is written'],
        },
        {
          id: 'del-002',
          to_role: 'qa',
          charter: 'Review the delegated delivery slice',
          acceptance_contract: ['Review summary is complete', 'Delegation proof artifact is written'],
        },
      ],
    },
  ),
);
