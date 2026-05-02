import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import {
  existsSync,
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

import { RUN_EXPORT_INCLUDED_ROOTS, RUN_RESTORE_ROOTS } from '../src/lib/export.js';

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

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-export-cli-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'export-test', name: 'Export Test', default_branch: 'main' },
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
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'export-test',
    run_id: 'run_export_001',
    status: 'active',
    phase: 'implementation',
    active_turns: {
      turn_001: {
        turn_id: 'turn_001',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        runtime_id: 'local-dev',
        assigned_sequence: 1,
      },
    },
    retained_turns: {
      turn_000: {
        turn_id: 'turn_000',
        assigned_role: 'dev',
        status: 'failed',
        attempt: 1,
        runtime_id: 'local-dev',
      },
    },
    turn_sequence: 1,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 1.2, remaining_usd: 8.8 },
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'dev', status: 'failed' },
    { turn_id: 'turn_001', role: 'dev', status: 'running' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Ship export command.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), [
    { phase: 'after_dispatch', hook: 'notify', verdict: 'allow' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-annotations.jsonl'), [
    { turn_id: 'turn_001', annotations: { note: 'captured' } },
  ]);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), [
    { event_type: 'run_blocked', notification_name: 'ops_webhook', delivered: true },
  ]);
  writeJson(join(root, '.agentxchain', 'continuous-session.json'), {
    session_id: 'cont_export_001',
    status: 'paused',
    vision_path: '.planning/VISION.md',
    runs_completed: 1,
    current_run_id: 'run_export_001',
  });
  writeJsonl(join(root, '.agentxchain', 'human-escalations.jsonl'), [
    { id: 'hesc_001', status: 'open', type: 'needs_decision' },
  ]);
  writeJson(join(root, '.agentxchain', 'sla-reminders.json'), {
    reminders: [{ escalation_id: 'hesc_001', last_sent_at: '2026-04-17T14:00:00.000Z' }],
  });

  writeFileSync(
    join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'),
    '# Prompt for turn_001\n',
  );
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001',
    role: 'dev',
  });
  writeJson(join(root, '.agentxchain', 'dispatch', 'index.json'), {
    turns: ['turn_001'],
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001',
    action: 'accept',
  });
  writeJsonl(join(root, '.agentxchain', 'intake', 'events', 'events.jsonl'), [
    { event_id: 'evt_001', category: 'schedule' },
  ]);
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    super_run_id: 'srun_001',
    status: 'active',
  });
  writeFileSync(join(root, 'TALK.md'), '# Export Talk\n');

  return root;
}

function createLegacyProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-export-legacy-'));
  writeJson(join(root, 'agentxchain.json'), {
    version: 3,
    project: 'Legacy Project',
    agents: {
      dev: { name: 'Developer', mandate: 'Build.' },
    },
  });
  return root;
}

describe('export CLI', () => {
  it('AT-EXPORT-001: export --help shows the supported flags', () => {
    const result = runCli(process.cwd(), ['export', '--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--format <format>/);
    assert.match(result.stdout, /--output <path>/);
  });

  it('AT-EXPORT-002/003/004: export emits a governed audit artifact with parsed files', () => {
    const root = createGovernedProject();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.schema_version, '0.3');
      assert.equal(exported.export_kind, 'agentxchain_run_export');
      assert.equal(exported.project.id, 'export-test');
      assert.equal(exported.summary.run_id, 'run_export_001');
      assert.deepEqual(exported.summary.active_turn_ids, ['turn_001']);
      assert.deepEqual(exported.summary.retained_turn_ids, ['turn_000']);

      assert.equal(exported.files['agentxchain.json'].format, 'json');
      assert.ok(exported.files['agentxchain.json'].content_base64);
      assert.equal(exported.files['.agentxchain/history.jsonl'].format, 'jsonl');
      assert.equal(exported.files['.agentxchain/hook-audit.jsonl'].data[0].phase, 'after_dispatch');
      assert.equal(
        exported.files['.agentxchain/dispatch/turns/turn_001/PROMPT.md'].data,
        '# Prompt for turn_001\n',
      );
      assert.equal(
        exported.files['.agentxchain/staging/turn_001/turn-result.json'].data.status,
        'completed',
      );
      assert.equal(
        exported.files['.agentxchain/intake/events/events.jsonl'].data[0].event_id,
        'evt_001',
      );
      assert.equal(
        exported.files['.agentxchain/multirepo/state.json'].data.super_run_id,
        'srun_001',
      );
      assert.equal(
        exported.files['.agentxchain/continuous-session.json'].data.session_id,
        'cont_export_001',
      );
      assert.equal(
        exported.files['.agentxchain/human-escalations.jsonl'].data[0].id,
        'hesc_001',
      );
      assert.equal(
        exported.files['.agentxchain/sla-reminders.json'].data.reminders[0].escalation_id,
        'hesc_001',
      );
      assert.equal(exported.files['TALK.md'].data, '# Export Talk\n');
      assert.equal(exported.summary.intake_present, true);
      assert.equal(exported.summary.coordinator_present, true);
      assert.equal(exported.summary.notification_audit_entries, 1);
      assert.equal(exported.workspace.git.is_repo, false);
      assert.equal(exported.workspace.git.restore_supported, false);
      assert.equal(
        exported.files['.agentxchain/notification-audit.jsonl'].data[0].event_type,
        'run_blocked',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps continuous-session, human-escalations, and sla-reminders in both export and restore roots', () => {
    for (const relPath of [
      '.agentxchain/continuous-session.json',
      '.agentxchain/human-escalations.jsonl',
      '.agentxchain/sla-reminders.json',
    ]) {
      assert.ok(RUN_EXPORT_INCLUDED_ROOTS.includes(relPath), `${relPath} missing from RUN_EXPORT_INCLUDED_ROOTS`);
      assert.ok(RUN_RESTORE_ROOTS.includes(relPath), `${relPath} missing from RUN_RESTORE_ROOTS`);
    }
  });

  it('AT-EXPORT-DASH-001/002: export snapshots dashboard session status truthfully', () => {
    const root = createGovernedProject();
    try {
      let result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      let exported = JSON.parse(result.stdout);
      assert.deepEqual(exported.summary.dashboard_session, {
        status: 'not_running',
        pid: null,
        url: null,
        started_at: null,
      });

      writeFileSync(join(root, '.agentxchain-dashboard.pid'), `${process.pid}\n`);
      writeJson(join(root, '.agentxchain-dashboard.json'), {
        pid: process.pid,
        port: 3847,
        url: 'http://localhost:3847',
        started_at: '2026-04-14T12:30:00.000Z',
      });

      result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      exported = JSON.parse(result.stdout);
      assert.deepEqual(exported.summary.dashboard_session, {
        status: 'running',
        pid: process.pid,
        url: 'http://localhost:3847',
        started_at: '2026-04-14T12:30:00.000Z',
      });
      assert.equal(exported.files['.agentxchain-dashboard.pid'].format, 'text');
      assert.equal(exported.files['.agentxchain-dashboard.json'].format, 'json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-005: export --output writes the artifact to disk', () => {
    const root = createGovernedProject();
    try {
      const outputRel = 'artifacts/run-export.json';
      const result = runCli(root, ['export', '--output', outputRel]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Exported governed run audit/);

      const outputPath = join(root, outputRel);
      assert.ok(existsSync(outputPath));

      const exported = JSON.parse(readFileSync(outputPath, 'utf8'));
      assert.equal(exported.project.id, 'export-test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-006: export rejects legacy projects', () => {
    const root = createLegacyProject();
    try {
      const result = runCli(root, ['export']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /governed project/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-007: export rejects unsupported formats', () => {
    const root = createGovernedProject();
    try {
      const result = runCli(root, ['export', '--format', 'tar']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unsupported export format/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
