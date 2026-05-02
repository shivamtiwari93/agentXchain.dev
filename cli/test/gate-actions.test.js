import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateV4Config } from '../src/lib/normalized-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(gateActions) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'gate-actions-fixture',
      name: 'Gate Actions Fixture',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Ship the requested slice.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['node', '-e', 'console.log(process.argv[1])', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {
      planning_signoff: {
        requires_human_approval: true,
        gate_actions: gateActions,
      },
    },
  };
}

function makeState() {
  return {
    schema_version: '1.1',
    run_id: 'run_gate_actions',
    project_id: 'gate-actions-fixture',
    status: 'paused',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 1,
    last_completed_turn_id: 'turn_001',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: {
      from: 'planning',
      to: 'implementation',
      gate: 'planning_signoff',
      requested_by_turn: 'turn_001',
      requested_at: '2026-04-16T16:00:00.000Z',
    },
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: {
      planning_signoff: 'pending',
    },
    budget_status: {
      spent_usd: 0,
      remaining_usd: 10,
    },
  };
}

function createFixture(gateActions) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-gate-actions-'));
  tempDirs.push(dir);

  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(makeConfig(gateActions), null, 2));
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(makeState(), null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

  return dir;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20_000,
  });
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readLedger(root) {
  const raw = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
  if (!raw) {
    return [];
  }
  return raw.split('\n').map((line) => JSON.parse(line));
}

describe('gate actions', () => {
  it('AT-GA-001: config validation rejects gate_actions on a non-human gate', () => {
    const config = makeConfig([{ label: 'publish', run: 'echo publish' }]);
    config.gates.planning_signoff.requires_human_approval = false;

    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((entry) => entry.includes('gate_actions require requires_human_approval: true')));
  });

  it('AT-GA-007: config validation rejects invalid timeout_ms values on gate actions', () => {
    const config = makeConfig([{ label: 'publish', run: 'echo publish', timeout_ms: 999 }]);

    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((entry) => entry.includes('timeout_ms must be an integer between 1000 and 3600000')));
  });

  it('AT-GA-002: approve-transition --dry-run previews gate actions without mutating state or side effects', () => {
    const root = createFixture([
      { label: 'write preview file', run: 'node scripts/write-success.mjs preview.txt dry-run' },
    ]);

    writeFileSync(
      join(root, 'scripts', 'write-success.mjs'),
      "import { writeFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nwriteFileSync(file, value + '\\n');\n",
    );

    const result = runCli(root, ['approve-transition', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry Run: gate approval preview only/);
    assert.match(result.stdout, /write preview file/);
    assert.equal(existsSync(join(root, 'preview.txt')), false);
    assert.equal(readLedger(root).length, 0);
    assert.equal(readState(root).pending_phase_transition?.gate, 'planning_signoff');
  });

  it('AT-GA-003: successful gate actions run sequentially and phase approval completes', () => {
    const root = createFixture([
      { label: 'write marker', run: 'node scripts/write-success.mjs gate-actions.txt one' },
      { label: 'append marker', run: 'node scripts/append-success.mjs gate-actions.txt two' },
    ]);

    writeFileSync(
      join(root, 'scripts', 'write-success.mjs'),
      "import { writeFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nwriteFileSync(file, value + '\\n');\n",
    );
    writeFileSync(
      join(root, 'scripts', 'append-success.mjs'),
      "import { appendFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nappendFileSync(file, value + '\\n');\n",
    );

    const result = runCli(root, ['approve-transition']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Phase advanced: planning → implementation|Phase advanced: planning -> implementation/);
    assert.match(result.stdout, /Gate actions:\s+2 completed/);

    const state = readState(root);
    assert.equal(state.phase, 'implementation');
    assert.equal(state.status, 'active');
    assert.equal(state.pending_phase_transition, null);

    const file = readFileSync(join(root, 'gate-actions.txt'), 'utf8');
    assert.equal(file, 'one\ntwo\n');

    const ledger = readLedger(root).filter((entry) => entry.type === 'gate_action');
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0].status, 'succeeded');
    assert.equal(ledger[1].status, 'succeeded');
  });

  it('AT-GA-004/005: failing gate action blocks the run, preserves the pending gate, and status shows the latest failure', () => {
    const root = createFixture([
      { label: 'write once', run: 'node scripts/write-success.mjs partial.txt one' },
      { label: 'fail publish', run: 'node scripts/fail-step.mjs' },
    ]);

    writeFileSync(
      join(root, 'scripts', 'write-success.mjs'),
      "import { writeFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nwriteFileSync(file, value + '\\n');\n",
    );
    writeFileSync(
      join(root, 'scripts', 'fail-step.mjs'),
      "console.error('publish failed hard');\nprocess.exit(7);\n",
    );

    const result = runCli(root, ['approve-transition']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Blocked By Gate Action/);
    assert.match(result.stdout + result.stderr, /fail publish/);

    const state = readState(root);
    assert.equal(state.status, 'blocked');
    assert.equal(state.pending_phase_transition?.gate, 'planning_signoff');
    assert.equal(state.blocked_reason?.category, 'gate_action_failed');

    const ledger = readLedger(root).filter((entry) => entry.type === 'gate_action');
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0].status, 'succeeded');
    assert.equal(ledger[1].status, 'failed');
    assert.equal(ledger[1].exit_code, 7);

    const status = runCli(root, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Gate actions:\s+failed/);
    assert.match(status.stdout, /fail publish/);
    assert.match(status.stdout, /publish failed hard/);
  });

  it('AT-GA-006: report json exposes gate action execution evidence', () => {
    const root = createFixture([
      { label: 'write once', run: 'node scripts/write-success.mjs partial.txt one' },
      { label: 'fail publish', run: 'node scripts/fail-step.mjs' },
    ]);

    writeFileSync(
      join(root, 'scripts', 'write-success.mjs'),
      "import { writeFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nwriteFileSync(file, value + '\\n');\n",
    );
    writeFileSync(
      join(root, 'scripts', 'fail-step.mjs'),
      "console.error('publish failed hard');\nprocess.exit(7);\n",
    );

    const approval = runCli(root, ['approve-transition']);
    assert.notEqual(approval.status, 0);

    const exported = runCli(root, ['export']);
    assert.equal(exported.status, 0, exported.stderr);

    const report = runCli(root, ['report', '--input', '-', '--format', 'json']);
    assert.notEqual(report.status, 0, 'report should require stdin when input is "-" without piped data');

    const reportFromStdin = spawnSync(process.execPath, [CLI_BIN, 'report', '--input', '-', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      input: exported.stdout,
      timeout: 20_000,
    });
    assert.equal(reportFromStdin.status, 0, reportFromStdin.stderr);
    const payload = JSON.parse(reportFromStdin.stdout);
    assert.equal(Array.isArray(payload.subject.run.gate_actions), true);
    assert.equal(payload.subject.run.gate_actions.length, 2);
    assert.equal(payload.subject.run.gate_actions[1].status, 'failed');
    assert.equal(payload.subject.run.gate_actions[1].exit_code, 7);
  });

  it('AT-GA-010: dry-run shows per-action timeout_ms when configured', () => {
    const root = createFixture([
      { label: 'deploy to prod', run: 'echo deploy', timeout_ms: 60000 },
      { label: 'notify slack', run: 'echo notify' },
    ]);

    const result = runCli(root, ['approve-transition', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deploy to prod.*timeout: 60000ms/i, 'dry-run should show timeout for configured actions');
    assert.match(result.stdout, /notify slack/, 'dry-run should show actions without timeout');
    assert.ok(!result.stdout.match(/notify slack.*timeout/i), 'actions without explicit timeout should not show timeout hint');
  });

  it('AT-GA-009: timeout metadata surfaces in status, report text, report markdown, and report html', () => {
    const root = createFixture([
      { label: 'hang deploy', run: 'node scripts/hang-step.mjs', timeout_ms: 1000 },
    ]);

    writeFileSync(
      join(root, 'scripts', 'hang-step.mjs'),
      "setInterval(() => {}, 1000);\n",
    );

    const approval = runCli(root, ['approve-transition']);
    assert.notEqual(approval.status, 0);

    // status must distinguish timed out from generic failure
    const status = runCli(root, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /timed out after 1000ms/i, 'status should show timeout label');

    // export for report piping
    const exported = runCli(root, ['export']);
    assert.equal(exported.status, 0, exported.stderr);

    function pipeReport(format) {
      return spawnSync(process.execPath, [CLI_BIN, 'report', '--input', '-', '--format', format], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        input: exported.stdout,
        timeout: 20_000,
      });
    }

    // text report
    const textReport = pipeReport('text');
    assert.equal(textReport.status, 0, textReport.stderr);
    assert.match(textReport.stdout, /timed_out after 1000ms/, 'text report should show timeout tag');

    // markdown report
    const mdReport = pipeReport('markdown');
    assert.equal(mdReport.status, 0, mdReport.stderr);
    assert.match(mdReport.stdout, /timed out after 1000ms/i, 'markdown report should show timeout');

    // html report
    const htmlReport = pipeReport('html');
    assert.equal(htmlReport.status, 0, htmlReport.stderr);
    assert.match(htmlReport.stdout, /timed out after 1000ms/i, 'html report should show timeout');
  });

  it('AT-GA-008: timed-out gate actions block approval and record timeout evidence', () => {
    const root = createFixture([
      { label: 'hang publish', run: 'node scripts/hang-step.mjs', timeout_ms: 1000 },
    ]);

    writeFileSync(
      join(root, 'scripts', 'hang-step.mjs'),
      "setInterval(() => {}, 1000);\n",
    );

    const result = runCli(root, ['approve-transition']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Blocked By Gate Action/);
    assert.match(result.stdout + result.stderr, /timeout after 1000ms/i);

    const state = readState(root);
    assert.equal(state.status, 'blocked');
    assert.equal(state.pending_phase_transition?.gate, 'planning_signoff');
    assert.equal(state.blocked_reason?.category, 'gate_action_failed');
    assert.equal(state.blocked_reason?.gate_action?.timed_out, true);
    assert.equal(state.blocked_reason?.gate_action?.timeout_ms, 1000);

    const ledger = readLedger(root).filter((entry) => entry.type === 'gate_action');
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].status, 'failed');
    assert.equal(ledger[0].timed_out, true);
    assert.equal(ledger[0].timeout_ms, 1000);
    assert.match(ledger[0].stderr_tail || '', /Timed out after 1000ms/);
  });
});
