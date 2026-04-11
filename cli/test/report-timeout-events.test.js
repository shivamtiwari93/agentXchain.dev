import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
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

function runReport(root, format = 'json') {
  const exp = spawnSync(process.execPath, [CLI_BIN, 'export', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (exp.status !== 0) throw new Error(`export failed: ${exp.stderr}${exp.stdout}`);

  const rep = spawnSync(process.execPath, [CLI_BIN, 'report', '--input', '-', '--format', format], {
    cwd: root, encoding: 'utf8', timeout: 15000, input: exp.stdout,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (rep.status !== 0) throw new Error(`report failed: ${rep.stderr}${rep.stdout}`);

  return format === 'json' ? JSON.parse(rep.stdout) : rep.stdout;
}

function createProjectWithTimeoutEvents() {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-to-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'timeout-report-test', name: 'Timeout Report Test', default_branch: 'main' },
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
    timeouts: {
      per_turn_minutes: 30,
      per_phase_minutes: 120,
      per_run_minutes: 480,
      action: 'escalate',
    },
    budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'timeout-report-test',
    run_id: 'run_001',
    status: 'blocked',
    phase: 'implementation',
    turn_sequence: 2,
    active_turns: {},
    retained_turns: {},
    phase_gate_status: {},
    budget_status: { spent_usd: 0.5, remaining_usd: 9.5 },
    protocol_mode: 'governed',
    created_at: '2026-04-10T10:00:00Z',
    phase_entered_at: '2026-04-10T10:30:00Z',
    blocked_on: 'timeout:turn',
    blocked_reason: {
      category: 'timeout',
      recovery: {
        typed_reason: 'timeout:turn',
        owner: 'operator',
        recovery_action: 'agentxchain resume',
        turn_retained: true,
        detail: 'Turn exceeded 30m limit (elapsed 45m, exceeded by 15m)',
      },
      blocked_at: '2026-04-10T11:15:00Z',
      turn_id: 'turn_002',
    },
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001',
      role: 'dev',
      phase: 'planning',
      status: 'accepted',
      summary: 'Planned the feature.',
      decisions: [{ id: 'DEC-001' }],
      objections: [],
      files_changed: ['plan.md'],
      cost: { total_usd: 0.05 },
      accepted_at: '2026-04-10T10:25:00Z',
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-001',
      turn_id: 'turn_001',
      role: 'dev',
      phase: 'planning',
      statement: 'Start implementation phase',
    },
    {
      type: 'timeout_warning',
      scope: 'phase',
      phase: 'implementation',
      turn_id: 'turn_001',
      limit_minutes: 120,
      elapsed_minutes: 90,
      exceeded_by_minutes: 0,
      action: 'warn',
      timestamp: '2026-04-10T12:00:00Z',
    },
    {
      type: 'timeout',
      scope: 'turn',
      phase: 'implementation',
      turn_id: 'turn_002',
      limit_minutes: 30,
      elapsed_minutes: 45,
      exceeded_by_minutes: 15,
      action: 'escalate',
      timestamp: '2026-04-10T11:15:00Z',
    },
    {
      type: 'timeout_skip_failed',
      scope: 'phase',
      phase: 'implementation',
      turn_id: 'turn_002',
      limit_minutes: 120,
      elapsed_minutes: 135,
      exceeded_by_minutes: 15,
      action: 'skip_phase',
      timestamp: '2026-04-10T12:15:00Z',
    },
  ]);

  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'dispatch.json'), {
    turn_id: 'turn_001', assigned_role: 'dev', phase: 'planning',
  });

  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'result.json'), {
    turn_id: 'turn_001', role: 'dev', phase: 'planning', status: 'ok',
    files: [{ path: 'plan.md', action: 'created' }],
    decisions: [{ id: 'DEC-001', statement: 'Start implementation phase' }],
  });

  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'meta.json'), {
    turn_id: 'turn_001', result: 'ok',
  });

  return root;
}

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('report timeout events', () => {
  it('JSON report includes timeout_events with all four types', () => {
    const root = createProjectWithTimeoutEvents();
    dirs.push(root);

    const report = runReport(root, 'json');
    const run = report.subject.run;

    assert.ok(Array.isArray(run.timeout_events), 'timeout_events should be an array');
    assert.equal(run.timeout_events.length, 3, 'should have 3 timeout events');

    const warning = run.timeout_events.find((e) => e.type === 'timeout_warning');
    assert.ok(warning, 'should have a timeout_warning event');
    assert.equal(warning.scope, 'phase');
    assert.equal(warning.limit_minutes, 120);
    assert.equal(warning.elapsed_minutes, 90);
    assert.equal(warning.action, 'warn');

    const escalation = run.timeout_events.find((e) => e.type === 'timeout');
    assert.ok(escalation, 'should have a timeout escalation event');
    assert.equal(escalation.scope, 'turn');
    assert.equal(escalation.exceeded_by_minutes, 15);
    assert.equal(escalation.action, 'escalate');

    const skipFailed = run.timeout_events.find((e) => e.type === 'timeout_skip_failed');
    assert.ok(skipFailed, 'should have a timeout_skip_failed event');
    assert.equal(skipFailed.action, 'skip_phase');
  });

  it('text report renders Timeout Events section', () => {
    const root = createProjectWithTimeoutEvents();
    dirs.push(root);

    const text = runReport(root, 'text');

    assert.ok(text.includes('Timeout Events:'), 'text report should have Timeout Events section');
    assert.ok(text.includes('warning'), 'should render warning label');
    assert.ok(text.includes('escalation'), 'should render escalation label');
    assert.ok(text.includes('skip failed'), 'should render skip failed label');
    assert.ok(text.includes('turn scope'), 'should render scope');
    assert.ok(text.includes('45m/30m'), 'should render elapsed/limit');
    assert.ok(text.includes('(+15m)'), 'should render exceeded_by');
  });

  it('markdown report renders ## Timeout Events section', () => {
    const root = createProjectWithTimeoutEvents();
    dirs.push(root);

    const md = runReport(root, 'markdown');

    assert.ok(md.includes('## Timeout Events'), 'markdown report should have ## Timeout Events heading');
    assert.ok(md.includes('**Warning**'), 'should render bold Warning label');
    assert.ok(md.includes('**Escalation**'), 'should render bold Escalation label');
    assert.ok(md.includes('**Skip Failed**'), 'should render bold Skip Failed label');
    assert.ok(md.includes('`turn` scope'), 'should render scope in backticks');
    assert.ok(md.includes('(+15m)'), 'should render exceeded_by');
  });

  it('empty timeout_events array when no timeout ledger entries exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-report-to-empty-'));
    dirs.push(root);
    mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

    writeJson(join(root, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: 'no-timeout-test', name: 'No Timeout Test', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'Code.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' } },
      routing: { planning: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
      budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
      gates: {},
      hooks: {},
    });

    writeJson(join(root, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'no-timeout-test',
      run_id: 'run_001', status: 'active', phase: 'planning', turn_sequence: 1,
      active_turns: {}, retained_turns: {},
      phase_gate_status: {},
      budget_status: { spent_usd: 0.1, remaining_usd: 9.9 },
      protocol_mode: 'governed',
      created_at: '2026-04-10T10:00:00Z',
    });

    writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [{
      turn_id: 'turn_001', role: 'dev', phase: 'planning', status: 'accepted',
      summary: 'Done.', decisions: [], objections: [], files_changed: [],
      cost: { total_usd: 0.01 },
      accepted_at: '2026-04-10T10:25:00Z', accepted_sequence: 1,
    }]);

    writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [{
      id: 'DEC-001', turn_id: 'turn_001', role: 'dev', phase: 'planning', statement: 'Plan done',
    }]);

    writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'dispatch.json'), {
      turn_id: 'turn_001', assigned_role: 'dev', phase: 'planning',
    });
    writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'result.json'), {
      turn_id: 'turn_001', role: 'dev', phase: 'planning', status: 'ok',
      files: [], decisions: [],
    });
    writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'meta.json'), {
      turn_id: 'turn_001', result: 'ok',
    });

    const report = runReport(root, 'json');
    assert.ok(Array.isArray(report.subject.run.timeout_events), 'timeout_events should exist');
    assert.equal(report.subject.run.timeout_events.length, 0, 'should be empty');

    const text = runReport(root, 'text');
    assert.ok(!text.includes('Timeout Events'), 'text should not have Timeout Events section');
  });
});
