/**
 * BUG-106 beta-tester scenario: a tusq.dev dev turn declared
 * verification.status="pass" but 2 machine_evidence commands had
 * exit_code=1 without expected_exit_code set (intentional failure tests).
 * The normalizer must auto-set expected_exit_code to match exit_code
 * when the overall verification status is "pass".
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

function createProject({ machineEvidence, evidenceSummary, verificationStatus }) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug106-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const changedFiles = ['src/index.js', 'tests/index.test.js'];
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug106-cli-test', id: `bug106-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work safely.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    approval_policy: { triage: 'auto', gates: 'auto' },
    intent_coverage_mode: 'lenient',
  };

  // Create directory structure and config at project root (not in .agentxchain/)
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nApproved.\n');
  for (const f of changedFiles) {
    const dir = join(root, ...f.split('/').slice(0, -1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, f), `# ${f}\n`);
  }

  // Initialize git repo
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug106@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-106 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  // Create dirty files AFTER the initial commit so they appear as workspace changes
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\nUpdated by dev.\n`);
  }

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Implemented divisor index with case validation tests',
    decisions: [
      { id: 'DEC-001', category: 'implementation', statement: 'Case-sensitive divisor name validation added.', rationale: 'Divisor names must be lowercase per spec.' },
    ],
    objections: [],
    files_changed: changedFiles,
    artifacts_created: [],
    verification: {
      status: verificationStatus || 'pass',
      commands: machineEvidence.map((e) => e.command),
      evidence_summary: evidenceSummary || 'All tests pass. Negative-case tests confirm error handling.',
      machine_evidence: machineEvidence,
    },
    artifact: { type: 'workspace' },
    proposed_next_role: 'qa',
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
        assigned_role: 'dev',
        status: 'failed_acceptance',
        attempt: 1,
        runtime_id: 'local-dev',
        assigned_sequence: 1,
        baseline: headSha,
      },
    },
    turn_sequence: 2,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { planning_signoff: 'passed', implementation_complete: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: 'dev',
  };

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId, runId };
}

describe('BUG-106: verification.status=pass with undeclared non-zero exits', () => {

  it('normalizes undeclared non-zero exit_code when verification.status is pass', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0, stdout: 'PASS' },
        { command: 'node bin/tusq.js divisor index --divisor MULTIPLE_CONSTRAINED --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 1, stdout: 'Error: invalid case' },
        { command: 'node bin/tusq.js divisor index --divisor multiple_unconstrained --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 1, stdout: 'Error: not found' },
      ],
      evidenceSummary: 'All tests pass. Case-sensitive divisor names correctly rejected.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId, '--checkpoint']);
    assert.equal(result.status, 0, `accept-turn should succeed after normalization. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      !result.stderr.includes('non-zero exit codes that are not explicitly declared'),
      'Should not report undeclared non-zero exits after normalization',
    );
  });

  it('does NOT normalize when verification.status is NOT pass', () => {
    const { root, turnId } = createProject({
      verificationStatus: 'fail',
      machineEvidence: [
        { command: 'npm test', exit_code: 0, stdout: 'PASS' },
        { command: 'node bin/app.js --invalid', exit_code: 1, stdout: 'Error' },
      ],
      evidenceSummary: 'Tests failed.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId, '--checkpoint']);
    const output = result.stdout + result.stderr;
    assert.ok(
      !output.includes('verification_pass_expected_exit_code_inferred'),
      'Should not normalize expected_exit_code when status is not pass',
    );
  });

  it('preserves already-declared expected_exit_code', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0, stdout: 'PASS' },
        { command: 'node bin/app.js --bad', exit_code: 2, expected_exit_code: 2, stdout: 'Error' },
      ],
      evidenceSummary: 'All tests pass.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId, '--checkpoint']);
    assert.equal(result.status, 0, `accept-turn should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const output = result.stdout + result.stderr;
    assert.ok(
      !output.includes('verification_pass_expected_exit_code_inferred'),
      'Should not normalize already-declared expected_exit_code',
    );
  });

  it('exact tester reproduction: tusq.dev divisor index commands', () => {
    const { root, turnId } = createProject({
      machineEvidence: [
        { command: 'npm test', exit_code: 0, stdout: '42 tests pass' },
        { command: 'node bin/tusq.js help | grep -c \'^  [a-z]\'', exit_code: 0, stdout: '8' },
        { command: 'node bin/tusq.js divisor index --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 0, stdout: 'Indexed 3 divisors' },
        { command: 'node bin/tusq.js divisor index --divisor MULTIPLE_CONSTRAINED --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 1, stdout: 'Error: divisor name must be lowercase' },
        { command: 'node bin/tusq.js divisor index --divisor multiple_constrained --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 1, stdout: 'Error: not found' },
        { command: 'node bin/tusq.js divisor index --divisor multiple_unconstrained --manifest tests/fixtures/express-sample/tusq.manifest.json', exit_code: 0, stdout: 'Indexed 1 divisor' },
      ],
      evidenceSummary: 'All tests pass. Negative-case tests for case-sensitive divisor names correctly rejected. Valid divisors index cleanly.',
    });

    const result = runCli(root, ['accept-turn', '--turn', turnId, '--checkpoint']);
    assert.equal(result.status, 0, `accept-turn should succeed on exact tester reproduction. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  });
});
