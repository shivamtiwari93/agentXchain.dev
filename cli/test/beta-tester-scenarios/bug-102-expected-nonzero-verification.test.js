/**
 * BUG-102 beta-tester scenario: a tusq.dev QA turn reported
 * verification.status="pass" while including deliberate negative-case CLI
 * checks with exit_code=1. The validator must accept explicitly expected
 * non-zero evidence without accepting accidental failures.
 */

import { afterEach, describe, it } from 'vitest';
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

function createProject({ machineEvidence, evidenceSummary }) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug102-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const changedFiles = [
    '.planning/acceptance-matrix.md',
    '.planning/ship-verdict.md',
    '.planning/RELEASE_NOTES.md',
  ];
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug102-cli-test', id: `bug102-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
      dev: {
        title: 'Developer',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-qa': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'dev', 'human'], exit_gate: 'qa_ship_verdict' },
      launch: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    gates: {
      qa_ship_verdict: {
        requires_files: changedFiles,
        requires_human_approval: false,
      },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'qa',
    runtime_id: 'local-qa',
    status: 'completed',
    summary: 'QA verified the milestone including expected negative CLI checks.',
    decisions: [
      { id: 'DEC-001', category: 'quality', statement: 'QA accepts expected negative checks as passing evidence.', rationale: 'The negative commands prove error handling.' },
    ],
    objections: [],
    files_changed: changedFiles,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: machineEvidence.map((entry) => entry.command),
      evidence_summary: evidenceSummary,
      machine_evidence: machineEvidence,
    },
    artifact: { type: 'workspace' },
    proposed_next_role: 'dev',
    phase_transition_request: 'launch',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  for (const file of changedFiles) {
    writeFileSync(join(root, file), `# ${file}\n`);
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug102@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-102 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  for (const file of changedFiles) {
    writeFileSync(join(root, file), `# ${file}\n\nUpdated by QA.\n`);
  }
  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  const state = {
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        run_id: runId,
        assigned_role: 'qa',
        status: 'failed_acceptance',
        attempt: 1,
        runtime_id: 'local-qa',
        assigned_sequence: 1,
        baseline: headSha,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { qa_ship_verdict: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: 'qa',
  };

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId };
}

describe('BUG-102: expected non-zero verification evidence', () => {
  it('accept-turn allows explicit expected_exit_code on a passing QA turn', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0 },
        { command: 'node bin/tusq.js signature index --first-type STRING', exit_code: 1, expected_exit_code: 1 },
      ],
      evidenceSummary: 'npm test passes; uppercase --first-type STRING is an expected negative check.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must accept expected non-zero evidence. Output:\n${combined}`);
  });

  it('accept-turn infers expected negative checks from exact evidence summary wording', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0 },
        { command: 'node bin/tusq.js signature index --manifest tests/fixtures/express-sample/tusq.manifest.json --first-type STRING', exit_code: 1 },
        { command: 'node bin/tusq.js signature index --manifest tests/fixtures/express-sample/tusq.manifest.json --first-type boolean', exit_code: 1 },
      ],
      evidenceSummary: '--first-type STRING exits 1 as expected; --first-type boolean exits 1 as expected.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must infer explicitly described negative checks. Output:\n${combined}`);
  });

  it('BUG-106: normalizes undeclared non-zero machine evidence when verification.status is pass', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0 },
        { command: 'node bin/tusq.js signature index --first-type STRING', exit_code: 1 },
      ],
      evidenceSummary: 'npm test passes.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    // BUG-106: normalizer auto-sets expected_exit_code when verification.status is "pass"
    assert.equal(result.status, 0, `accept-turn must accept after BUG-106 normalization. Output:\n${combined}`);
  });
});
