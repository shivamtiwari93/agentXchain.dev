import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
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
const REPO_ROOT = join(__dirname, '..', '..');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args, extra = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    ...extra,
  });
}

function createProjectWithCheckpoint(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-cont-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'cont-test', name: 'Continuity Test', default_branch: 'main' },
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
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
    },
    budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
    gates: {},
    hooks: {},
  });

  const runId = opts.staleCheckpoint ? 'run_different_001' : 'run_cont_001';

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'cont-test',
    run_id: 'run_cont_001',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: {},
    protocol_mode: 'governed',
  });

  writeJson(join(root, '.agentxchain', 'session.json'), {
    session_id: 'session_abc123',
    run_id: runId,
    started_at: '2026-04-09T10:00:00.000Z',
    last_checkpoint_at: '2026-04-09T12:30:00.000Z',
    last_turn_id: 'turn_001',
    last_phase: 'implementation',
    last_role: 'dev',
    run_status: 'active',
    checkpoint_reason: 'turn_accepted',
    agent_context: { adapter: 'anthropic', dispatch_dir: null },
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001', role: 'dev', status: 'completed',
      summary: 'Built continuity surface',
      decisions: [], objections: [], files_changed: ['src/lib/report.js'],
      cost: { total_usd: 0.08 }, accepted_at: '2026-04-09T12:30:00.000Z', accepted_sequence: 1,
    },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Prompt\n');
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), { turn_id: 'turn_001', role: 'dev' });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), { turn_id: 'turn_001', status: 'completed' });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), { turn_id: 'turn_001', action: 'accept' });

  return root;
}

describe('report continuity surface', () => {
  it('export includes session.json when present', () => {
    const root = createProjectWithCheckpoint();
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);
      const artifact = JSON.parse(result.stdout);
      assert.ok(artifact.files['.agentxchain/session.json'], 'session.json must be in export artifact');
      const sessionData = artifact.files['.agentxchain/session.json'].data;
      assert.equal(sessionData.session_id, 'session_abc123');
      assert.equal(sessionData.checkpoint_reason, 'turn_accepted');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('JSON report includes continuity metadata from session checkpoint', () => {
    const root = createProjectWithCheckpoint();
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const reportResult = runCli(root, ['report', '--input', join(root, 'artifact.json'), '--format', 'json']);
      assert.equal(reportResult.status, 0, reportResult.stderr);
      const report = JSON.parse(reportResult.stdout);

      assert.equal(report.subject.kind, 'governed_run');
      const continuity = report.subject.run.continuity;
      assert.ok(continuity, 'report must include continuity field');
      assert.equal(continuity.session_id, 'session_abc123');
      assert.equal(continuity.last_turn_id, 'turn_001');
      assert.equal(continuity.last_role, 'dev');
      assert.equal(continuity.last_phase, 'implementation');
      assert.equal(continuity.checkpoint_reason, 'turn_accepted');
      assert.equal(continuity.stale_checkpoint, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('text report renders continuity section', () => {
    const root = createProjectWithCheckpoint();
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const result = runCli(root, ['report', '--input', join(root, 'artifact.json')]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Continuity:/, 'text report must include Continuity section');
      assert.match(result.stdout, /Session: session_abc123/);
      assert.match(result.stdout, /Checkpoint: turn_accepted/);
      assert.match(result.stdout, /Last turn: turn_001/);
      assert.match(result.stdout, /Last role: dev/);
      assert.match(result.stdout, /Last phase: implementation/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('markdown report renders continuity section', () => {
    const root = createProjectWithCheckpoint();
    try {
      const rawArtifact = runCli(root, ['export']);
      assert.equal(rawArtifact.status, 0, rawArtifact.stderr);

      const result = runCli(root, ['report', '--format', 'markdown'], { input: rawArtifact.stdout });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /## Continuity/, 'markdown must include Continuity heading');
      assert.match(result.stdout, /`session_abc123`/);
      assert.match(result.stdout, /`turn_accepted`/);
      assert.match(result.stdout, /`turn_001`/);
      assert.match(result.stdout, /`dev`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stale checkpoint is flagged in JSON and text reports', () => {
    const root = createProjectWithCheckpoint({ staleCheckpoint: true });
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const jsonResult = runCli(root, ['report', '--input', join(root, 'artifact.json'), '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.run.continuity.stale_checkpoint, true);

      const textResult = runCli(root, ['report', '--input', join(root, 'artifact.json')]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /WARNING: checkpoint tracks run run_different_001/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('report omits continuity when no session.json exists', () => {
    const root = createProjectWithCheckpoint();
    try {
      rmSync(join(root, '.agentxchain', 'session.json'));
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const jsonResult = runCli(root, ['report', '--input', join(root, 'artifact.json'), '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.run.continuity, null, 'continuity must be null when no checkpoint');

      const textResult = runCli(root, ['report', '--input', join(root, 'artifact.json')]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.ok(!textResult.stdout.includes('Continuity:'), 'text report must omit Continuity section');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dashboard state-reader continuity contract', () => {
  it('RESOURCE_MAP includes /api/continuity pointing to session.json', () => {
    const stateReaderSrc = readFileSync(join(REPO_ROOT, 'cli/src/lib/dashboard/state-reader.js'), 'utf8');
    assert.match(stateReaderSrc, /['"]\/api\/continuity['"]\s*:\s*SESSION_FILE/);
  });

  it('export includes session.json in RUN_EXPORT_INCLUDED_ROOTS', () => {
    const exportSrc = readFileSync(join(REPO_ROOT, 'cli/src/lib/export.js'), 'utf8');
    assert.match(exportSrc, /\.agentxchain\/session\.json/);
  });
});
