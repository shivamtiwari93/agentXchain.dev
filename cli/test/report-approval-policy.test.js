import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
  // export → pipe to report
  const exp = spawnSync(process.execPath, [CLI_BIN, 'export', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (exp.status !== 0) throw new Error(`export failed: ${exp.stderr}${exp.stdout}`);

  const rep = spawnSync(process.execPath, [CLI_BIN, 'report', '--input', '-', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 15000, input: exp.stdout,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (rep.status !== 0) throw new Error(`report failed: ${rep.stderr}${rep.stdout}`);

  return JSON.parse(rep.stdout);
}

/**
 * Creates a governed project fixture with both regular decisions and approval-policy
 * ledger entries.  Closely mirrors the fixture in report-cli.test.js.
 */
function createProjectWithApprovalPolicy() {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-ap-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'ap-report-test', name: 'AP Report Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
    },
    budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'ap-report-test',
    run_id: 'run_ap_001',
    status: 'completed',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 2,
    phase_gate_status: {
      planning_exit: 'passed',
      implementation_complete: 'passed',
    },
    budget_status: { spent_usd: 0.5, remaining_usd: 9.5 },
    protocol_mode: 'governed',
    created_at: '2026-04-10T00:00:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001', role: 'dev', status: 'accepted',
      summary: 'Planned the feature.',
      decisions: [{ id: 'DEC-001' }], objections: [], files_changed: ['PLAN.md'],
      cost: { total_usd: 0.05 }, accepted_at: '2026-04-10T00:01:00.000Z', accepted_sequence: 1,
    },
  ]);

  // Decision ledger with both regular decisions and approval-policy entries
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', turn_id: 'turn_001', role: 'dev', phase: 'planning', statement: 'Use modular architecture.' },
    {
      type: 'approval_policy',
      gate_type: 'phase_transition',
      action: 'auto_approve',
      matched_rule: { from: 'planning', action: 'auto_approve', when: { gate_passed: true } },
      from_phase: 'planning',
      to_phase: 'implementation',
      reason: 'Approval policy auto-approved planning exit gate.',
      gate_id: 'gate_planning_exit_001',
      timestamp: '2026-04-10T00:02:00.000Z',
    },
    {
      type: 'approval_policy',
      gate_type: 'run_completion',
      action: 'auto_approve',
      matched_rule: { action: 'auto_approve', when: { all_phases_visited: true, roles_participated: ['dev'] } },
      reason: 'All phases visited and required roles participated.',
      gate_id: 'gate_run_complete_001',
      timestamp: '2026-04-10T00:03:00.000Z',
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), [
    { event: 'after_acceptance', hook: 'notify', result: 'ok' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), []);

  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Plan\n');
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001', role: 'dev',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001', status: 'completed',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001', action: 'accept',
  });

  return root;
}

describe('report approval-policy surface', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('includes approval_policy_events with matched_rule in report JSON', () => {
    root = createProjectWithApprovalPolicy();
    const report = runReport(root);

    const apEvents = report.subject?.run?.approval_policy_events;
    assert.ok(Array.isArray(apEvents), 'approval_policy_events must be an array');
    assert.equal(apEvents.length, 2, 'both approval-policy ledger entries present');

    // Phase transition event
    const phaseEvent = apEvents.find((e) => e.gate_type === 'phase_transition');
    assert.ok(phaseEvent, 'phase_transition event present');
    assert.equal(phaseEvent.action, 'auto_approve');
    assert.equal(phaseEvent.from_phase, 'planning');
    assert.equal(phaseEvent.to_phase, 'implementation');
    assert.ok(phaseEvent.matched_rule, 'matched_rule preserved');
    assert.equal(phaseEvent.matched_rule.from, 'planning');
    assert.ok(phaseEvent.gate_id, 'gate_id preserved');
    assert.ok(phaseEvent.timestamp, 'timestamp preserved');

    // Run completion event
    const completionEvent = apEvents.find((e) => e.gate_type === 'run_completion');
    assert.ok(completionEvent, 'run_completion event present');
    assert.equal(completionEvent.action, 'auto_approve');
    assert.ok(completionEvent.matched_rule, 'matched_rule preserved');
    assert.deepStrictEqual(completionEvent.matched_rule.when.roles_participated, ['dev']);
  });

  it('regular decisions remain in the decisions array unchanged', () => {
    root = createProjectWithApprovalPolicy();
    const report = runReport(root);

    const decisions = report.subject?.run?.decisions;
    assert.ok(Array.isArray(decisions), 'decisions must be an array');
    assert.equal(decisions.length, 1, 'only DEC-001 in decisions (approval-policy entries excluded)');
    assert.equal(decisions[0].id, 'DEC-001');
    assert.equal(decisions[0].statement, 'Use modular architecture.');
  });

  it('approval_policy_events is empty array when no policy entries exist', () => {
    root = createProjectWithApprovalPolicy();

    // Overwrite decision ledger with only regular decisions (no approval-policy entries)
    writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
      { id: 'DEC-001', turn_id: 'turn_001', role: 'dev', phase: 'planning', statement: 'Use modular architecture.' },
    ]);

    const report = runReport(root);
    const apEvents = report.subject?.run?.approval_policy_events;
    assert.ok(Array.isArray(apEvents), 'approval_policy_events should be an array');
    assert.equal(apEvents.length, 0, 'empty when no policy entries exist');
  });
});
