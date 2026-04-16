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
const COORD_SPEC = read('.planning/COORDINATOR_EXPORT_SPEC.md');
const EXPORT_VERIFIER_SOURCE = read('cli/src/lib/export-verifier.js');

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
    assert.match(EXPORT_DOCS, /protocol v7 conformance/i);
    assert.match(EXPORT_DOCS, /not part of the current protocol-v7 proof set/i);
    assert.match(PROTOCOL_REFERENCE_DOCS, /Export Schema Reference/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /stable operator contracts but not protocol-v7 proof surfaces/i);
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
        '.agentxchain-dashboard.pid',
        '.agentxchain-dashboard.json',
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

  it('documents repo decision operator-summary fields truthfully', () => {
    assert.match(EXPORT_DOCS, /summary\.repo_decisions/);
    assert.match(EXPORT_DOCS, /authority_level/);
    assert.match(EXPORT_DOCS, /authority_source/);
    assert.match(EXPORT_DOCS, /operator_summary/);
    assert.match(EXPORT_DOCS, /active_categories/);
    assert.match(EXPORT_DOCS, /highest_active_authority_level/);
    assert.match(EXPORT_DOCS, /superseding_active_count/);
    assert.match(EXPORT_DOCS, /overridden_with_successor_count/);
  });

  it('AT-EXPORT-REF-009: distinguishes export-time snapshot metadata from history-derived summary metadata', () => {
    assert.match(EXPORT_DOCS, /export-time operator snapshot/i);
    assert.match(EXPORT_DOCS, /validates only the stored object shape and status-consistent invariants/i);
    assert.match(EXPORT_DOCS, /do \*\*not\*\* prove a live dashboard is still running/i);
    assert.match(EXPORT_DOCS, /derived export summary, not an independent authority ledger/i);
    assert.match(EXPORT_DOCS, /reconstructed from embedded `.agentxchain\/history\.jsonl` delegation records/i);
    assert.match(EXPORT_DOCS, /underlying history remains the authority inside the artifact/i);
    assert.match(SPEC, /AT-EXPORT-REF-009/);
    assert.match(SPEC, /protocol v7 conformance/i);
    assert.match(SPEC, /export-time local snapshot/i);
    assert.match(SPEC, /history-derived summary/i);
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
      assert.equal(verification.report.schema_version, '0.3');
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

describe('phase-order conformance docs contract', () => {
  it('documents workflow_phase_order verifier invariants truthfully', () => {
    assert.match(EXPORT_DOCS, /workflow_phase_order/);
    assert.match(EXPORT_DOCS, /must be non-empty/i);
    assert.match(EXPORT_DOCS, /include `summary\.phase`/i);
    assert.match(EXPORT_VERIFIER_SOURCE, /must not be empty when present/);
    assert.match(EXPORT_VERIFIER_SOURCE, /must not contain duplicate phase/);
    assert.match(EXPORT_VERIFIER_SOURCE, /must appear in summary\.workflow_phase_order when workflow_phase_order is present/);
  });

  it('documents conservative phase-order drift behavior for export diffs', () => {
    assert.match(CLI_DOCS, /`workflow_phase_order` embedded in the export summary/i);
    assert.match(CLI_DOCS, /only runs when both exports declare the same phase order/i);
    assert.match(CLI_DOCS, /explicit warning and skips guessing/i);
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

  it('AT-EXPORT-REF-009: documents intentional downstream degradation for failed child repo exports', () => {
    assert.match(EXPORT_DOCS, /partial-export shape is intentional/i);
    assert.match(EXPORT_DOCS, /verify export.*only `ok: true` child exports/i);
    assert.match(EXPORT_DOCS, /report.*audit.*per-repo export health/i);
    assert.match(EXPORT_DOCS, /drill-down fields.*stay absent/i);
    assert.match(EXPORT_DOCS, /replay export.*minimal placeholder governed repo/i);
    assert.match(COORD_SPEC, /AT-COORD-EXPORT-009/);
    assert.match(COORD_SPEC, /first-class artifact shape/i);
    assert.match(COORD_SPEC, /drill-down fields.*stay absent/i);
    assert.match(COORD_SPEC, /minimal placeholder governed repo/i);
  });

  it('AT-EXPORT-REF-008: distinguishes raw coordinator snapshot metadata from authority-first report/diff truth', () => {
    assert.match(EXPORT_DOCS, /raw coordinator repo status snapshot/i);
    assert.match(EXPORT_DOCS, /coordinator-state metadata/i);
    assert.match(EXPORT_DOCS, /must not treat it as the primary repo-status truth/i);
    assert.match(EXPORT_DOCS, /nested child export is readable/i);
    assert.match(EXPORT_DOCS, /agentxchain diff --export/);
    assert.match(EXPORT_DOCS, /agentxchain report/);
    assert.match(EXPORT_DOCS, /agentxchain audit/);
    assert.match(SPEC, /AT-EXPORT-REF-008/);
    assert.match(SPEC, /raw coordinator-state snapshot/i);
    assert.match(SPEC, /report\/audit\/diff/i);
  });

  it('AT-EXPORT-REF-007: documents aggregated_events verification truthfully', () => {
    assert.match(EXPORT_DOCS, /aggregated_events/i);
    assert.match(EXPORT_DOCS, /embedded child-repo `events\.jsonl` data/i);
    assert.match(CLI_DOCS, /summary\.aggregated_events/i);
    assert.match(CLI_DOCS, /fails closed if the summary claims events from a repo whose nested export was not embedded/i);
  });
});
