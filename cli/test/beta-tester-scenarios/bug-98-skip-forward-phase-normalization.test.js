/**
 * BUG-98 beta-tester scenario: a retained QA turn in implementation copies a
 * later phase name ("launch") from historical context even though the only
 * valid next phase is "qa". The framework should preserve forward-progress
 * intent by correcting the request to the immediate next phase.
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

function createProject(turnResultOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug98-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = 'local-qa';
  const changedFiles = [
    '.planning/IMPLEMENTATION_NOTES.md',
    '.planning/acceptance-matrix.md',
    '.planning/ship-verdict.md',
    '.planning/RELEASE_NOTES.md',
  ];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug98-cli-test', id: `bug98-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Test.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      product_marketing: {
        title: 'Launch',
        mandate: 'Launch.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-launch',
        runtime: 'local-launch',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      [runtimeId]: { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-launch': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'product_marketing', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'dev', 'product_marketing', 'human'], exit_gate: 'qa_ship_verdict' },
      launch: { entry_role: 'product_marketing', allowed_next_roles: ['product_marketing', 'human'], exit_gate: 'launch_ready' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'], requires_human_approval: false },
      implementation_complete: { requires_files: ['.planning/acceptance-matrix.md'], requires_verification_pass: true },
      qa_ship_verdict: { requires_files: ['.planning/ship-verdict.md'], requires_human_approval: false },
      launch_ready: { requires_files: ['.planning/ANNOUNCEMENT.md'], requires_human_approval: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\n`);
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug98@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-98 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\nverified by qa\n`);
  }

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'qa',
    runtime_id: runtimeId,
    status: 'completed',
    summary: 'QA verified implementation and requested the wrong later phase.',
    decisions: [
      {
        id: 'DEC-001',
        statement: 'QA accepted implementation evidence.',
        rationale: 'Verification passed and required QA artifacts were updated.',
        category: 'verification',
      },
    ],
    objections: [],
    files_changed: changedFiles,
    verification: {
      status: 'pass',
      commands: ['node -e "process.exit(0)"'],
      evidence_summary: 'Smoke command passed.',
      machine_evidence: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'launch',
    phase_transition_request: 'launch',
    run_completion_request: null,
    needs_human_reason: null,
    ...turnResultOverrides,
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
        assigned_sequence: 1,
        baseline: headSha,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { implementation_complete: 'pending' },
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
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId };
}

describe('BUG-98: skip-forward phase transition normalization', () => {
  it('accepts a retained implementation QA turn that requested launch instead of qa', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.match(combined, /Turn Accepted|turn_accepted|Accepted/i, 'Output must confirm acceptance');

    const events = execSync('cat .agentxchain/events.jsonl', { cwd: root, encoding: 'utf8' });
    assert.match(events, /skip_forward_phase_corrected_to_next_phase/);
    assert.match(events, /aligned_to_corrected_phase_entry_role/);
  });

  it('rejects backward authoritative phase requests', () => {
    const { root, turnId } = createProject({
      proposed_next_role: 'dev',
      phase_transition_request: 'planning',
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'accept-turn must fail for backward phase requests');
    assert.match(combined, /Validation failed at stage protocol/);
    assert.match(combined, /phase_transition_request "planning" is invalid from phase "implementation"/);
  });
});
