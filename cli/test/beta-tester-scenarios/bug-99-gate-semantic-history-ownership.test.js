/**
 * BUG-99 beta-tester scenario: a retained QA turn in implementation can
 * re-verify an implementation gate after the dev-owned gate artifact was
 * produced by an already accepted dev turn. Pre-acceptance gate semantic
 * coverage must evaluate ownership with accepted history, not raw state alone.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function createProject({ includeDevHistory = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug99-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const devTurnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = 'local-qa';

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug99-cli-test', id: `bug99-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Test.', write_authority: 'authoritative', runtime: runtimeId },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      [runtimeId]: { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'dev', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: { requires_files: ['.planning/ship-verdict.md'], requires_human_approval: false },
    },
    workflow_kit: {
      phases: {
        implementation: {
          artifacts: [
            {
              path: '.planning/IMPLEMENTATION_NOTES.md',
              semantics: 'implementation_notes',
              required: true,
              owned_by: 'dev',
            },
          ],
        },
      },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), [
    '# Implementation Notes',
    '',
    '## Changes',
    '',
    '- Dev implemented the milestone.',
    '',
    '## Verification',
    '',
    '- npm test passed.',
    '',
  ].join('\n'));
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance\n\n- QA verified.\n');
  writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\nVerdict: SHIP\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug99@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-99 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance\n\n- QA verified implementation.\n');
  writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\nVerdict: SHIP\n\nQA reverified implementation.\n');

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'qa',
    runtime_id: runtimeId,
    status: 'completed',
    summary: 'QA verified implementation artifacts and requests QA phase.',
    decisions: [
      {
        id: 'DEC-001',
        statement: 'QA accepted implementation evidence.',
        rationale: 'Verification passed and QA artifacts were updated.',
        category: 'verification',
      },
    ],
    objections: [],
    files_changed: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
    verification: {
      status: 'pass',
      commands: ['node -e "process.exit(0)"'],
      evidence_summary: 'Smoke command passed.',
      machine_evidence: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
    run_completion_request: null,
    needs_human_reason: null,
  };
  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  const state = {
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        run_id: runId,
        assigned_role: 'qa',
        status: 'failed_acceptance',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 2,
        baseline: headSha,
      },
    },
    turn_sequence: 2,
    last_completed_turn_id: includeDevHistory ? devTurnId : null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { implementation_complete: 'failed', qa_ship_verdict: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: 'qa',
  };
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), includeDevHistory ? `${JSON.stringify({
    turn_id: devTurnId,
    run_id: runId,
    role: 'dev',
    phase: 'implementation',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Dev implemented milestone.',
    decisions: [],
    objections: [],
    files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
    verification: { status: 'pass' },
    phase_transition_request: 'qa',
    accepted_at: new Date().toISOString(),
  })}\n` : '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId };
}

describe('BUG-99: gate semantic coverage uses accepted history for ownership', () => {
  it('accepts QA transition when dev-owned gate artifact already has accepted dev participation', () => {
    const { root, turnId } = createProject({ includeDevHistory: true });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.doesNotMatch(combined, /gate_semantic_coverage/);
  });

  it('still rejects QA transition when no accepted dev turn owns the implementation artifact', () => {
    const { root, turnId } = createProject({ includeDevHistory: false });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'accept-turn must fail without dev ownership history');
    assert.match(combined, /gate_semantic_coverage|did not modify that file/);
  });
});
