#!/usr/bin/env node

/**
 * Mock agent for delegation failure-path proof.
 *
 * Behavior:
 * - Director (initial): emits 2 delegations (del-001 → dev, del-002 → qa)
 * - Dev (del-001):       completes successfully, writes proof artifact
 * - QA  (del-002):       FAILS — emits status:'failed', writes failure artifact
 * - Director (review):   receives mixed results (1 completed, 1 failed),
 *                         writes review artifact with failure details,
 *                         completes the run
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('delegation-failure-mock-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const entry = Object.values(index.active_turns || {})[0];
if (!entry) {
  console.error('delegation-failure-mock-agent: no active turn in dispatch index');
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
        rationale: 'Delegation failure-path proof mock agent',
      },
    ],
    objections: [],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo delegation-failure-proof'],
      evidence_summary: 'delegation-failure-proof',
      machine_evidence: [{ command: 'echo delegation-failure-proof', exit_code: 0 }],
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

// ── Delegation review turn ──────────────────────────────────────────────────
if (assignment.delegation_review) {
  const results = assignment.delegation_review.results || [];
  const failedCount = results.filter(r => r.status === 'failed').length;
  const completedCount = results.filter(r => r.status === 'completed').length;

  const relPath = '.agentxchain/proof/delegation-failure/review-turn.json';
  ensureJson(relPath, {
    turn_id: turnId,
    role: roleId,
    parent_turn_id: assignment.delegation_review.parent_turn_id,
    delegation_ids: results.map(item => item.delegation_id),
    child_turn_ids: results.map(item => item.child_turn_id),
    to_roles: results.map(item => item.to_role),
    statuses: results.map(item => item.status),
    result_count: results.length,
    completed_count: completedCount,
    failed_count: failedCount,
  });
  writeTurnResult(
    baseResult(
      `Director reviewed delegated results: ${completedCount} completed, ${failedCount} failed. Accepting with partial success.`,
      [relPath],
      {
        run_completion_request: true,
      },
    ),
  );
  process.exit(0);
}

// ── Delegated sub-task turn ─────────────────────────────────────────────────
if (assignment.delegation_context) {
  const delegationId = assignment.delegation_context.delegation_id;

  // QA delegation (del-002) FAILS
  if (roleId === 'qa') {
    const relPath = `.agentxchain/proof/delegation-failure/${delegationId}-failed.json`;
    ensureJson(relPath, {
      turn_id: turnId,
      role: roleId,
      delegation_id: delegationId,
      parent_turn_id: assignment.delegation_context.parent_turn_id,
      parent_role: assignment.delegation_context.parent_role,
      charter: assignment.delegation_context.charter,
      failure_reason: 'QA review found critical issues that cannot be resolved in this delegation scope.',
    });
    writeTurnResult(
      baseResult(
        `${roleId} failed delegated work for ${delegationId}: critical issues found.`,
        [relPath],
        {
          status: 'failed',
          proposed_next_role: 'director',
          verification: {
            status: 'fail',
            commands: ['echo qa-delegation-failed'],
            evidence_summary: 'QA delegation failed — critical issues found',
            machine_evidence: [{ command: 'echo qa-delegation-failed', exit_code: 1 }],
          },
        },
      ),
    );
    process.exit(0);
  }

  // Dev delegation (del-001) succeeds
  const relPath = `.agentxchain/proof/delegation-failure/${delegationId}.json`;
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

// ── Initial director turn: emit 2 delegations ──────────────────────────────
const seedPath = '.agentxchain/proof/delegation-failure/seed-turn.json';
ensureJson(seedPath, {
  turn_id: turnId,
  role: roleId,
  delegation_context: false,
  delegation_review: false,
});
writeTurnResult(
  baseResult(
    'Director decomposed delivery into implementation (dev) and QA review (qa) delegations.',
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
          charter: 'Review the delegated delivery slice for quality issues',
          acceptance_contract: ['Review summary is complete', 'All quality checks pass'],
        },
      ],
    },
  ),
);
