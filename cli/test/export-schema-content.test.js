import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildCoordinatorExport, buildRunExport } from '../src/lib/export.js';
import { verifyExportArtifact } from '../src/lib/export-verifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const EXPORT_DOCS = read('website-v2/docs/export-schema.mdx');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const PROTOCOL_REFERENCE_DOCS = read('website-v2/docs/protocol-reference.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const SPEC = read('.planning/EXPORT_SCHEMA_REFERENCE_SPEC.md');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertMentionsFields(doc, fields) {
  for (const field of fields) {
    assert.match(
      doc,
      new RegExp('`' + escapeRegex(field) + '`'),
      `expected docs to mention \`${field}\``,
    );
  }
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-export-schema-run-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'export-schema-test', name: 'Export Schema Test', default_branch: 'main' },
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
    project_id: 'export-schema-test',
    run_id: 'run_export_schema_001',
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
    budget_status: { spent_usd: 0.5, remaining_usd: 9.5 },
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'dev', status: 'failed' },
    { turn_id: 'turn_001', role: 'dev', status: 'running' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Document export schema.' },
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
  writeJsonl(join(root, '.agentxchain', 'intake', 'events', 'events.jsonl'), [
    { event_id: 'evt_001', category: 'schedule' },
  ]);
  writeFileSync(
    join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'),
    '# Prompt for turn_001\n',
  );
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001',
    role: 'dev',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001',
    action: 'accept',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    super_run_id: 'srun_001',
    status: 'active',
  });

  return root;
}

function createCoordinatorWorkspace({ brokenChild = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-export-schema-coord-'));
  const webRoot = join(root, 'repos', 'web');
  const cliRoot = join(root, 'repos', 'cli');
  createGovernedProjectAt(webRoot, 'web-app');

  if (!brokenChild) {
    createGovernedProjectAt(cliRoot, 'cli-tool');
  }

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-export-schema', name: 'Coordinator Export Schema' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      cli: { path: './repos/cli', default_branch: 'main', required: true },
    },
    workstreams: {
      sync: {
        phase: 'implementation',
        repos: ['web', 'cli'],
        entry_repo: 'web',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'sync' },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_export_schema_001',
    project_id: 'coord-export-schema',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
      cli: { run_id: 'run_cli_001', status: brokenChild ? 'errored' : 'initialized', phase: 'implementation' },
    },
    pending_gate: null,
    phase_gate_status: {},
    created_at: '2026-04-04T00:00:00Z',
    updated_at: '2026-04-04T00:00:00Z',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
    barrier_001: {
      workstream_id: 'sync',
      type: 'all_repos_accepted',
      status: 'pending',
      required_repos: ['web', 'cli'],
      satisfied_repos: [],
    },
  });
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    { type: 'run_initialized', super_run_id: 'srun_export_schema_001' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    { id: 'DEC-COORD-001', statement: 'Coordinator export ready.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [
    { barrier_id: 'barrier_001', to: 'pending' },
  ]);

  return root;
}

function createGovernedProjectAt(root, projectId) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
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
        allowed_next_roles: ['dev'],
      },
    },
    gates: {},
    hooks: {},
  });
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: `run_${projectId}_001`,
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 0,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: {},
    protocol_mode: 'governed',
  });
  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'dev', status: 'completed' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Repo ready.' },
  ]);
}

describe('export schema docs surface', () => {
  it('AT-EXPORT-REF-001: wires export-schema into docs navigation and planning surface spec', () => {
    assert.match(SIDEBARS, /'export-schema'/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/export-schema/);
    assert.match(CLI_DOCS, /Export Schema Reference/);
  });

  it('AT-EXPORT-REF-002/006: keeps the boundary explicit and linked from protocol reference', () => {
    assert.match(EXPORT_DOCS, /protocol v6 conformance/i);
    assert.match(EXPORT_DOCS, /not part of the current protocol-v6 proof set/i);
    assert.match(PROTOCOL_REFERENCE_DOCS, /Export Schema Reference/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /stable operator contracts but not protocol-v6 proof surfaces/i);
  });

  it('ships the standalone spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-EXPORT-REF-001/);
    assert.match(SPEC, /AT-EXPORT-REF-006/);
  });
});

describe('run export schema docs contract', () => {
  it('AT-EXPORT-REF-003: documents the actual run export keys and file-entry contract', () => {
    const root = createGovernedProject();
    try {
      const result = buildRunExport(root);
      assert.equal(result.ok, true, result.error);
      const artifact = result.export;
      const fileEntry = artifact.files['agentxchain.json'];

      assert.equal(verifyExportArtifact(artifact).ok, true);
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact));
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact.project));
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact.summary));
      assertMentionsFields(EXPORT_DOCS, Object.keys(fileEntry));

      const formats = [...new Set(Object.values(artifact.files).map((entry) => entry.format))];
      assert.deepEqual(formats.sort(), ['json', 'jsonl', 'text']);
      for (const format of formats) {
        assert.match(EXPORT_DOCS, new RegExp('`' + escapeRegex(format) + '`'));
      }

      for (const relPath of [
        'agentxchain.json',
        '.agentxchain/state.json',
        '.agentxchain/history.jsonl',
        '.agentxchain/decision-ledger.jsonl',
        '.agentxchain/hook-audit.jsonl',
        '.agentxchain/hook-annotations.jsonl',
        '.agentxchain/notification-audit.jsonl',
        '.agentxchain/dispatch/**',
        '.agentxchain/staging/**',
        '.agentxchain/transactions/accept/**',
        '.agentxchain/intake/**',
        '.agentxchain/multirepo/**',
      ]) {
        assert.match(EXPORT_DOCS, new RegExp(escapeRegex(relPath)));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('verification report shape docs contract', () => {
  it('AT-VER-REPORT-001: documents all verification report fields', () => {
    const root = createGovernedProject();
    try {
      const result = buildRunExport(root);
      assert.equal(result.ok, true, result.error);
      const verification = verifyExportArtifact(result.export);
      const reportKeys = Object.keys(verification.report);

      for (const key of reportKeys) {
        assert.match(
          EXPORT_DOCS,
          new RegExp('`' + escapeRegex(key) + '`'),
          `expected export-schema.mdx to document verification report field \`${key}\``,
        );
      }

      assert.match(EXPORT_DOCS, /`"pass"`/);
      assert.match(EXPORT_DOCS, /`"fail"`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VER-REPORT-002: documents the command-error report shape', () => {
    assert.match(EXPORT_DOCS, /`"error"`/);
    assert.match(EXPORT_DOCS, /`message`/);
    assert.match(EXPORT_DOCS, /Command Error Shape/);
    assert.match(EXPORT_DOCS, /exit code `2`/i);
  });

  it('AT-VER-REPORT-003: report fields match actual verifier output from source', () => {
    const verifierSource = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'export-verifier.js'),
      'utf8',
    );
    const commandSource = readFileSync(
      join(__dirname, '..', 'src', 'commands', 'verify.js'),
      'utf8',
    );

    assert.match(verifierSource, /overall:/);
    assert.match(verifierSource, /schema_version:/);
    assert.match(verifierSource, /export_kind:/);
    assert.match(verifierSource, /file_count:/);
    assert.match(verifierSource, /repo_count:/);
    assert.match(verifierSource, /errors/);

    assert.match(commandSource, /overall: 'error'/);
    assert.match(commandSource, /input: loaded\.input/);
    assert.match(commandSource, /message: loaded\.error/);
  });

  it('AT-VER-REPORT-004: real export verification report keys match documented set', () => {
    const root = createGovernedProject();
    try {
      const result = buildRunExport(root);
      assert.equal(result.ok, true, result.error);
      const verification = verifyExportArtifact(result.export);

      const expectedKeys = ['overall', 'schema_version', 'export_kind', 'file_count', 'repo_count', 'errors'];
      for (const key of expectedKeys) {
        assert.ok(
          key in verification.report,
          `expected verifier report to contain \`${key}\``,
        );
      }

      assert.equal(verification.report.overall, 'pass');
      assert.equal(verification.report.schema_version, '0.2');
      assert.equal(verification.report.export_kind, 'agentxchain_run_export');
      assert.ok(Array.isArray(verification.report.errors));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VER-REPORT-005: coordinator verification report includes repo_count', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = buildCoordinatorExport(root);
      assert.equal(result.ok, true, result.error);
      const verification = verifyExportArtifact(result.export);

      assert.equal(verification.report.overall, 'pass');
      assert.equal(verification.report.export_kind, 'agentxchain_coordinator_export');
      assert.ok(verification.report.repo_count >= 1, 'coordinator export must have repo_count >= 1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator export schema docs contract', () => {
  it('AT-EXPORT-REF-004: documents the actual coordinator export keys and nested repo contract', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = buildCoordinatorExport(root);
      assert.equal(result.ok, true, result.error);
      const artifact = result.export;
      assert.equal(verifyExportArtifact(artifact).ok, true);

      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact));
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact.coordinator));
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact.summary));
      assertMentionsFields(EXPORT_DOCS, Object.keys(artifact.repos.web));
      assert.match(EXPORT_DOCS, /agentxchain_run_export/);
      assert.match(EXPORT_DOCS, /agentxchain_coordinator_export/);
      assert.match(EXPORT_DOCS, /agentxchain-multi\.json/);
      assert.match(EXPORT_DOCS, /\.agentxchain\/multirepo\/barrier-ledger\.jsonl/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-REF-005: documents child repo failure as per-repo error, not coordinator export failure', () => {
    const root = createCoordinatorWorkspace({ brokenChild: true });
    try {
      const result = buildCoordinatorExport(root);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.export.repos.cli.ok, false);
      assert.equal(typeof result.export.repos.cli.error, 'string');
      assert.match(EXPORT_DOCS, /`ok: false`/i);
      assert.match(EXPORT_DOCS, /coordinator export does \*\*not\*\* fail/i);
      assert.match(EXPORT_DOCS, /`error`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
