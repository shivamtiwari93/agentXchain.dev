#!/usr/bin/env node

/**
 * Parallel Delegation Mock Agent
 *
 * Deterministic agent for the parallel delegation proof. Uses AGENTXCHAIN_TURN_ID
 * to identify its specific turn when multiple agents run concurrently.
 *
 * This agent does NOT write workspace files — parallel delegation proof validates
 * the delegation lifecycle (queue, concurrent dispatch, review aggregation), not
 * workspace artifact observation.
 *
 * Behavior:
 *   - Director (no delegation context): emits 2 delegations (del-001 → dev, del-002 → qa)
 *   - Delegated child: completes with summary + env_turn_id proof
 *   - Delegation review: requests run completion
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const indexPath = join(root, '.agentxchain', 'dispatch', 'index.json');

if (!existsSync(indexPath)) {
  console.error('parallel-delegation-mock-agent: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));

// Resolve this agent's turn using AGENTXCHAIN_TURN_ID (required for parallel mode)
let entry;
if (turnId && index.active_turns?.[turnId]) {
  entry = index.active_turns[turnId];
} else {
  // Fallback for sequential mode: pick first active turn
  entry = Object.values(index.active_turns || {})[0];
}

if (!entry) {
  console.error('parallel-delegation-mock-agent: no active turn found');
  process.exit(1);
}

const roleId = entry.role;
const runtimeId = entry.runtime_id;
const runId = index.run_id;
const assignmentPath = join(root, '.agentxchain', 'dispatch', 'turns', entry.turn_id, 'ASSIGNMENT.json');
const assignment = existsSync(assignmentPath) ? JSON.parse(readFileSync(assignmentPath, 'utf8')) : {};

function writeTurnResult(turnResult) {
  const absPath = join(root, entry.staging_result_path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(turnResult, null, 2) + '\n');
}

function baseResult(summary, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: entry.turn_id,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: summary,
        rationale: 'Parallel delegation CLI proof mock agent',
      },
    ],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo parallel-delegation-proof'],
      evidence_summary: 'parallel-delegation-proof',
      machine_evidence: [{ command: 'echo parallel-delegation-proof', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    ...overrides,
  };
}

// ── Delegation review turn ─────────────────────────────────────────────────
if (assignment.delegation_review) {
  const results = assignment.delegation_review.results || [];
  writeTurnResult(
    baseResult(
      `Director reviewed ${results.length} parallel-delegated results. ` +
      `Delegation IDs: ${results.map(r => r.delegation_id).join(', ')}. ` +
      `Roles: ${results.map(r => r.to_role).join(', ')}. ` +
      `All completed. Approving run completion.`,
      { run_completion_request: true },
    ),
  );
  process.exit(0);
}

// ── Delegated child turn ───────────────────────────────────────────────────
if (assignment.delegation_context) {
  const dc = assignment.delegation_context;
  writeTurnResult(
    baseResult(
      `${roleId} executed parallel-delegated work for ${dc.delegation_id}. ` +
      `Charter: ${dc.charter}. Parent: ${dc.parent_role}. ` +
      `AGENTXCHAIN_TURN_ID=${turnId || 'NOT_SET'}.`,
    ),
  );
  process.exit(0);
}

// ── Director seed turn — emits 2 delegations ──────────────────────────────
writeTurnResult(
  baseResult(
    'Director decomposed delivery into parallel dev and QA delegations.',
    {
      proposed_next_role: 'dev',
      delegations: [
        {
          id: 'del-001',
          to_role: 'dev',
          charter: 'Implement the delegated delivery slice (parallel)',
          acceptance_contract: ['Implementation complete', 'Delegation proof in summary'],
        },
        {
          id: 'del-002',
          to_role: 'qa',
          charter: 'Review the delegated delivery slice (parallel)',
          acceptance_contract: ['Review complete', 'Delegation proof in summary'],
        },
      ],
    },
  ),
);
