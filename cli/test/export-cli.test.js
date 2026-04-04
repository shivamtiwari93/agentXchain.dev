import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
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
      assert.equal(exported.schema_version, '0.2');
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
      assert.equal(exported.summary.intake_present, true);
      assert.equal(exported.summary.coordinator_present, true);
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
