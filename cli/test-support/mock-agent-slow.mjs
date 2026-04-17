#!/usr/bin/env node
/**
 * Slow mock agent for parallel dispatch integration testing.
 *
 * Like mock-agent.mjs, but:
 *   1. Outputs several lines to stdout (triggering dispatch progress tracking)
 *   2. Waits for a signal file before completing (allows mid-dispatch assertions)
 *
 * The signal file path: <project-root>/.agentxchain/continue-<turn_id>
 * The agent polls every 100ms for the signal file.
 *
 * Environment:
 *   SLOW_AGENT_MAX_WAIT_MS — max wait before auto-completing (default: 10000)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();

// ── Read dispatch index to find our turn ────────────────────────────────────
const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('mock-agent-slow: no dispatch index found');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('mock-agent-slow: no active turns in dispatch index');
  process.exit(1);
}

// In parallel dispatch, the adapter sets AGENTXCHAIN_TURN_ID to identify
// which turn this subprocess should work on. Use it if available.
const envTurnId = process.env.AGENTXCHAIN_TURN_ID;
let entry;
if (envTurnId && index.active_turns[envTurnId]) {
  entry = index.active_turns[envTurnId];
} else {
  entry = turnEntries[0];
}

const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const phase = index.phase;
const runId = index.run_id;

// ── Produce stdout output (triggers dispatch progress tracking) ─────────────
console.log(`mock-agent-slow: ${roleId} starting (${phase}), turn ${turnId}`);
console.log(`mock-agent-slow: producing output lines for progress tracking`);
for (let i = 0; i < 5; i++) {
  console.log(`mock-agent-slow: work line ${i + 1} for ${roleId}`);
}

// ── Write a "ready" signal so the test knows we're in-flight ────────────────
const readyPath = join(root, `.agentxchain/ready-${turnId}`);
writeFileSync(readyPath, JSON.stringify({ turn_id: turnId, role: roleId, pid: process.pid }));

// ── Wait for continue signal ────────────────────────────────────────────────
const continuePath = join(root, `.agentxchain/continue-${turnId}`);
const maxWait = parseInt(process.env.SLOW_AGENT_MAX_WAIT_MS || '10000', 10);
const deadline = Date.now() + maxWait;

function poll() {
  return new Promise((resolve) => {
    const check = () => {
      if (existsSync(continuePath) || Date.now() > deadline) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

await poll();

console.log(`mock-agent-slow: ${roleId} continuing after signal`);

// ── Create gate-required files based on phase ───────────────────────────────
function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  if (!existsSync(absPath)) {
    writeFileSync(absPath, content);
  }
}

if (phase === 'planning') {
  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\n\nApproved: YES\n');
  ensureFile('.planning/ROADMAP.md', '# Roadmap\n\n## Phases\n\n- planning\n- implementation\n- qa\n');
  ensureFile(
    '.planning/SYSTEM_SPEC.md',
    '# System Spec\n\n## Purpose\n\nParallel dispatch integration test.\n\n## Interface\n\nParallel governed run.\n\n## Acceptance Tests\n\n- [ ] Parallel dispatch completes.\n',
  );
}

if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\n');
  ensureFile(
    '.planning/IMPLEMENTATION_NOTES.md',
    '# Implementation Notes\n\nParallel dispatch implementation.\n',
  );
}

if (phase === 'qa') {
  ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\n\n| Req | Status |\n|-----|--------|\n| 1 | pass |\n');
  ensureFile('.planning/ship-verdict.md', '# Ship Verdict\n\n## Verdict: YES\n');
  ensureFile('.planning/RELEASE_NOTES.md', '# Release Notes\n\nParallel dispatch QA complete.\n');
}

// ── Write turn result ───────────────────────────────────────────────────────
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

const turnResult = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: `Mock slow ${roleId} completed ${phase} phase.`,
  decisions: [{
    id: 'DEC-001',
    category: 'implementation',
    statement: `${roleId} completed governed slice in ${phase}.`,
    rationale: 'Parallel dispatch integration test mock.',
  }],
  objections: [],
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

console.log(`mock-agent-slow: ${roleId} completed (${phase}) → ${stagingResultPath}`);
