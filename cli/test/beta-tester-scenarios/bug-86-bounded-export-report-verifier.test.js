import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRunExport } from '../../src/lib/export.js';
import { verifyExportArtifact } from '../../src/lib/export-verifier.js';
import { buildGovernanceReport } from '../../src/lib/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');

const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function createLargeReportProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug86-'));
  roots.push(root);

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'cli-tool',
    project: { id: 'bug86', name: 'BUG 86', goal: 'Reproduce bounded report export' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', 'ok'], prompt_transport: 'stdin' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] } },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    run_id: 'run_bug86',
    project_id: 'bug86',
    status: 'completed',
    phase: 'implementation',
    turn_sequence: 0,
    active_turns: {},
    blocked_on: null,
    phase_gate_status: {},
  });

  writeJson(join(root, '.agentxchain', 'session.json'), {
    session_id: 'session_bug86',
    run_id: 'run_bug86',
    run_status: 'completed',
    phase: 'implementation',
  });

  const manyEvents = Array.from({ length: 120 }, (_, index) => ({
    event_id: `evt_${index}`,
    event_type: index % 2 === 0 ? 'turn_dispatched' : 'turn_accepted',
    timestamp: `2026-04-26T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
    run_id: 'run_bug86',
    phase: 'implementation',
    status: 'active',
    turn: { turn_id: `turn_${index}`, role_id: 'dev' },
    payload: { index },
  }));
  writeJsonl(join(root, '.agentxchain', 'events.jsonl'), manyEvents);
  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);

  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_big'), { recursive: true });
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_big', 'stdout.log'), 'x'.repeat(4096));
  writeJson(join(root, '.agentxchain', 'reports', 'export-run_previous.json'), {
    huge: 'y'.repeat(4096),
  });

  return root;
}

describe('BUG-86: bounded run exports remain reportable', () => {
  it('accepts truncated JSONL and byte-skipped files in governance reports', () => {
    const root = createLargeReportProject();
    const result = buildRunExport(root, { maxJsonlEntries: 10, maxBase64Bytes: 1024 });

    assert.equal(result.ok, true);
    assert.equal(result.export.files['.agentxchain/events.jsonl'].content_base64, null);
    assert.equal(result.export.files['.agentxchain/events.jsonl'].truncated, true);
    assert.equal(result.export.files['.agentxchain/dispatch/turns/turn_big/stdout.log'].content_base64, null);
    assert.equal(result.export.files['.agentxchain/dispatch/turns/turn_big/stdout.log'].content_base64_skipped, true);

    const verification = verifyExportArtifact(result.export);
    assert.equal(verification.ok, true, verification.report.errors.join('\n'));

    const report = buildGovernanceReport(result.export, { input: 'bug86-export.json' });
    assert.equal(report.ok, true);
    assert.equal(report.report.overall, 'pass');
  });

  it('keeps null content_base64 invalid without an explicit bounded-export marker', () => {
    const root = createLargeReportProject();
    const result = buildRunExport(root);
    assert.equal(result.ok, true);

    result.export.files['.agentxchain/events.jsonl'].content_base64 = null;

    const verification = verifyExportArtifact(result.export);
    assert.equal(verification.ok, false);
    assert.match(verification.report.errors.join('\n'), /content_base64 may be null only when truncated or content_base64_skipped is true/);
  });

  it('supports the real CLI report command on a bounded export artifact', () => {
    const root = createLargeReportProject();
    const result = buildRunExport(root, { maxJsonlEntries: 10, maxBase64Bytes: 1024 });
    const exportPath = join(root, '.agentxchain', 'reports', 'export-run_bug86.json');
    writeJson(exportPath, result.export);

    const cli = spawnSync(process.execPath, [CLI_BIN, 'report', '--input', exportPath, '--format', 'markdown'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /AgentXchain Governance Report/);
    assert.doesNotMatch(cli.stdout, /content_base64 must be a string/);
  });
});
