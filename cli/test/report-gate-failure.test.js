import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runReport(root) {
  const exp = spawnSync(process.execPath, [CLI_BIN, 'export', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (exp.status !== 0) throw new Error(`export failed: ${exp.stderr}${exp.stdout}`);

  const rep = spawnSync(process.execPath, [CLI_BIN, 'report', '--input', '-', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    input: exp.stdout,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (rep.status !== 0) throw new Error(`report failed: ${rep.stderr}${rep.stdout}`);

  return JSON.parse(rep.stdout);
}

function createProjectWithGateFailure() {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-gf-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'gf-report-test', name: 'Gate Failure Report Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan safely.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'] },
    },
    budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'gf-report-test',
    run_id: 'run_gf_001',
    status: 'active',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 2,
    phase_gate_status: { planning_signoff: 'failed' },
    last_gate_failure: {
      gate_type: 'phase_transition',
      gate_id: 'planning_signoff',
      phase: 'planning',
      from_phase: 'planning',
      to_phase: 'implementation',
      requested_by_turn: 'turn_001',
      failed_at: '2026-04-11T09:00:00.000Z',
      queued_request: true,
      reasons: ['Missing file: .planning/PM_SIGNOFF.md'],
      missing_files: ['.planning/PM_SIGNOFF.md'],
      missing_verification: false,
    },
    protocol_mode: 'governed',
    created_at: '2026-04-11T08:55:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001',
      role: 'pm',
      status: 'accepted',
      summary: 'Queued planning transition.',
      decisions: [{ id: 'DEC-001' }],
      objections: [],
      files_changed: [],
      cost: { total_usd: 0.05 },
      accepted_at: '2026-04-11T08:58:00.000Z',
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', turn_id: 'turn_001', role: 'pm', phase: 'planning', statement: 'Queue the implementation transition.' },
    {
      type: 'gate_failure',
      gate_type: 'phase_transition',
      gate_id: 'planning_signoff',
      phase: 'planning',
      from_phase: 'planning',
      to_phase: 'implementation',
      requested_by_turn: 'turn_001',
      failed_at: '2026-04-11T09:00:00.000Z',
      queued_request: true,
      reasons: ['Missing file: .planning/PM_SIGNOFF.md'],
      missing_files: ['.planning/PM_SIGNOFF.md'],
      missing_verification: false,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), []);
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Plan\n');
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001',
    role: 'pm',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001',
    action: 'accept',
  });

  return root;
}

describe('report gate-failure surface', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('AT-GFV-005: report JSON exposes gate_failures with queued-drain context', () => {
    root = createProjectWithGateFailure();
    const report = runReport(root);

    const gateFailures = report.subject?.run?.gate_failures;
    assert.ok(Array.isArray(gateFailures), 'gate_failures must be an array');
    assert.equal(gateFailures.length, 1);
    assert.equal(gateFailures[0].gate_type, 'phase_transition');
    assert.equal(gateFailures[0].queued_request, true);
    assert.equal(gateFailures[0].requested_by_turn, 'turn_001');
    assert.deepStrictEqual(gateFailures[0].missing_files, ['.planning/PM_SIGNOFF.md']);
  });
});
