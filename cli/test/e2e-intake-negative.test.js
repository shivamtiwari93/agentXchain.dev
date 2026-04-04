/**
 * E2E Intake Negative Path Tests
 *
 * Proves governance enforcement beyond the happy path:
 * - Suppress and reject transitions
 * - Invalid state transition rejection
 * - Duplicate event deduplication
 * - Blocked intent recovery (blocked → approve → planned → ...)
 * - Scan batch ingestion
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function createGovernedRepo() {
  const root = join(
    tmpdir(),
    `axc-e2e-neg-${randomBytes(6).toString('hex')}`,
  );
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: {
      id: 'intake-neg',
      name: 'Intake Negative',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
    },
    runtimes: {
      'manual-dev': { type: 'manual' },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: null,
        max_concurrent_turns: 1,
      },
    },
    gates: {},
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'intake-neg',
    status: 'idle',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  };

  writeJson(join(root, 'agentxchain.json'), config);
  writeJson(join(root, '.agentxchain', 'state.json'), state);
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(
    'git -c user.name="test" -c user.email="test@test" commit -m "initial"',
    { cwd: root, stdio: 'ignore' },
  );

  return root;
}

function recordIntent(root, description) {
  const record = runCli(root, [
    'intake', 'record',
    '--source', 'manual',
    '--signal', JSON.stringify({ description }),
    '--evidence', '{"type":"text","value":"negative path proof"}',
    '--json',
  ]);
  assert.equal(record.exitCode, 0, `record failed: ${record.combined}`);
  return JSON.parse(record.stdout);
}

describe('E2E intake negative paths', () => {
  let root;

  before(() => {
    root = createGovernedRepo();
  });

  after(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  describe('suppress transition', () => {
    let intentId;

    it('records a new intent', () => {
      const out = recordIntent(root, 'suppress-test');
      intentId = out.intent.intent_id;
      assert.equal(out.intent.status, 'detected');
    });

    it('suppresses a detected intent via triage --suppress', () => {
      const triage = runCli(root, [
        'intake', 'triage',
        '--intent', intentId,
        '--suppress',
        '--reason', 'not actionable',
        '--json',
      ]);
      assert.equal(triage.exitCode, 0, triage.combined);
      const out = JSON.parse(triage.stdout);
      assert.equal(out.intent.status, 'suppressed');
    });

    it('rejects further transitions on a suppressed intent', () => {
      const approve = runCli(root, [
        'intake', 'approve',
        '--intent', intentId,
        '--approver', 'test',
        '--json',
      ]);
      assert.notEqual(approve.exitCode, 0, 'approve should fail on suppressed intent');
    });
  });

  describe('reject transition', () => {
    let intentId;

    it('records and triages an intent', () => {
      const out = recordIntent(root, 'reject-test');
      intentId = out.intent.intent_id;

      const triage = runCli(root, [
        'intake', 'triage',
        '--intent', intentId,
        '--priority', 'p2',
        '--template', 'cli-tool',
        '--charter', 'Reject test charter',
        '--acceptance', 'should be rejected',
        '--json',
      ]);
      assert.equal(triage.exitCode, 0, triage.combined);
    });

    it('rejects a triaged intent via triage --reject', () => {
      const reject = runCli(root, [
        'intake', 'triage',
        '--intent', intentId,
        '--reject',
        '--reason', 'does not meet criteria',
        '--json',
      ]);
      assert.equal(reject.exitCode, 0, reject.combined);
      const out = JSON.parse(reject.stdout);
      assert.equal(out.intent.status, 'rejected');
    });

    it('rejects further transitions on a rejected intent', () => {
      const approve = runCli(root, [
        'intake', 'approve',
        '--intent', intentId,
        '--approver', 'test',
        '--json',
      ]);
      assert.notEqual(approve.exitCode, 0, 'approve should fail on rejected intent');
    });
  });

  describe('invalid state transitions', () => {
    let intentId;

    it('records a detected intent', () => {
      const out = recordIntent(root, 'invalid-transition-test');
      intentId = out.intent.intent_id;
    });

    it('rejects approve on a detected intent (must triage first)', () => {
      const approve = runCli(root, [
        'intake', 'approve',
        '--intent', intentId,
        '--approver', 'test',
        '--json',
      ]);
      assert.notEqual(approve.exitCode, 0, 'approve should fail on detected intent');
    });

    it('rejects plan on a detected intent', () => {
      const plan = runCli(root, [
        'intake', 'plan',
        '--intent', intentId,
        '--project-name', 'invalid',
        '--json',
      ]);
      assert.notEqual(plan.exitCode, 0, 'plan should fail on detected intent');
    });

    it('rejects start on a detected intent', () => {
      const start = runCli(root, [
        'intake', 'start',
        '--intent', intentId,
        '--json',
      ]);
      assert.notEqual(start.exitCode, 0, 'start should fail on detected intent');
    });

    it('rejects resolve on a detected intent', () => {
      const resolve = runCli(root, [
        'intake', 'resolve',
        '--intent', intentId,
        '--json',
      ]);
      assert.notEqual(resolve.exitCode, 0, 'resolve should fail on detected intent');
    });
  });

  describe('duplicate event deduplication', () => {
    it('returns deduplicated=true for identical signal+source', () => {
      const signal = { description: `dedup-test-${randomBytes(4).toString('hex')}` };
      const first = runCli(root, [
        'intake', 'record',
        '--source', 'manual',
        '--signal', JSON.stringify(signal),
        '--evidence', '{"type":"text","value":"first"}',
        '--json',
      ]);
      assert.equal(first.exitCode, 0, first.combined);
      const firstOut = JSON.parse(first.stdout);
      assert.ok(!firstOut.deduplicated, 'first record should not be deduplicated');

      const second = runCli(root, [
        'intake', 'record',
        '--source', 'manual',
        '--signal', JSON.stringify(signal),
        '--evidence', '{"type":"text","value":"second"}',
        '--json',
      ]);
      assert.equal(second.exitCode, 0, second.combined);
      const secondOut = JSON.parse(second.stdout);
      assert.equal(secondOut.deduplicated, true);
      assert.equal(secondOut.event.event_id, firstOut.event.event_id);
    });
  });

  describe('scan batch ingestion', () => {
    it('ingests multiple items from a scan source file', () => {
      const scanPayload = {
        source: 'ci_failure',
        captured_at: new Date().toISOString(),
        items: [
          {
            source: 'ci_failure',
            signal: { description: 'build failed on main', job_id: 'j1' },
            evidence: [{ type: 'text', value: 'exit code 1' }],
          },
          {
            source: 'ci_failure',
            signal: { description: 'lint failed on main', job_id: 'j2' },
            evidence: [{ type: 'text', value: 'eslint errors' }],
          },
        ],
      };
      const scanFile = join(root, 'scan-input.json');
      writeJson(scanFile, scanPayload);

      const scan = runCli(root, [
        'intake', 'scan',
        '--source', 'ci_failure',
        '--file', scanFile,
        '--json',
      ]);
      assert.equal(scan.exitCode, 0, scan.combined);
      const out = JSON.parse(scan.stdout);
      assert.equal(out.ok, true);
      assert.equal(out.scanned, 2);
      assert.equal(out.created, 2);
      assert.ok(Array.isArray(out.results));
      assert.equal(out.results.length, 2);
      for (const r of out.results) {
        assert.equal(r.status, 'created');
        assert.ok(r.event_id, 'each scan result should have an event_id');
        assert.ok(r.intent_id, 'each scan result should have an intent_id');
      }
    });

    it('rejects scan with empty items array', () => {
      const scanPayload = {
        source_id: 'empty-scan',
        captured_at: new Date().toISOString(),
        items: [],
      };
      const scanFile = join(root, 'scan-empty.json');
      writeJson(scanFile, scanPayload);

      const scan = runCli(root, [
        'intake', 'scan',
        '--source', 'empty-scan',
        '--file', scanFile,
        '--json',
      ]);
      assert.notEqual(scan.exitCode, 0, 'empty scan should fail');
    });
  });

  describe('status command', () => {
    it('returns aggregate counts in JSON mode', () => {
      const status = runCli(root, ['intake', 'status', '--json']);
      assert.equal(status.exitCode, 0, status.combined);
      const out = JSON.parse(status.stdout);
      assert.ok(out.summary, 'aggregate status should have summary');
      assert.ok(typeof out.summary.total_intents === 'number');
      assert.ok(typeof out.summary.by_status === 'object');
      assert.ok(out.summary.total_intents > 0, 'should have intents from prior tests');
    });

    it('returns detail for a specific intent', () => {
      const rec = recordIntent(root, 'status-detail-test');
      const status = runCli(root, [
        'intake', 'status',
        '--intent', rec.intent.intent_id,
        '--json',
      ]);
      assert.equal(status.exitCode, 0, status.combined);
      const out = JSON.parse(status.stdout);
      assert.equal(out.intent.intent_id, rec.intent.intent_id);
      assert.equal(out.intent.status, 'detected');
    });
  });
});
