import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildRunExport } from '../../src/lib/export.js';
import { verifyExportArtifact } from '../../src/lib/export-verifier.js';

// BUG-88: Export writer crashes with "Invalid string length" on large accumulated state.
// Root cause: JSON.stringify on unbounded export object exceeds Node.js string limit
// for projects with many .planning/ files, large text content, and accumulated turns.
// Fix: maxExportFiles + maxTextDataBytes bounding in buildRunExport(), fallback serialization in run.js.

function writeJson(filePath, value) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function createLargeGovernedProject(fileCount = 600, textSizeKb = 200) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug88-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'bug88-test', name: 'BUG-88 Test', goal: 'Test export bounding', default_branch: 'main' },
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
    project_id: 'bug88-test',
    run_id: 'run_bug88_test',
    status: 'active',
    phase: 'implementation',
    turn_sequence: 1,
    active_turns: {},
    retained_turns: {},
    blocked_on: null,
    phase_gate_status: {},
    provenance: { trigger: 'intake', created_by: 'test' },
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_001', role: 'pm', status: 'accepted', timestamp: '2026-04-26T00:00:00Z' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'events.jsonl'), [
    { event_id: 'evt_001', event_type: 'turn_accepted', timestamp: '2026-04-26T00:00:00Z' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);

  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001', role: 'pm', phase: 'planning',
  });
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), 'Test prompt');
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'CONTEXT.md'), 'Test context');
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001', summary: 'test turn',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'transaction.json'), {
    turn_id: 'turn_001', accepted_at: '2026-04-26T00:00:00Z',
  });

  // Create many .planning/ files to pressure file-count limits
  mkdirSync(join(root, '.planning'), { recursive: true });
  const largeText = 'A'.repeat(textSizeKb * 1024);
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(root, '.planning', `spec-${String(i).padStart(4, '0')}.md`), largeText);
  }

  return root;
}

describe('BUG-88: export writer bounding for large accumulated state', () => {
  it('maxExportFiles caps total files with priority ordering', () => {
    const root = createLargeGovernedProject(100, 1);
    try {
      const result = buildRunExport(root, {
        maxJsonlEntries: 100,
        maxBase64Bytes: 1024 * 1024,
        maxExportFiles: 20,
        maxTextDataBytes: 131072,
      });

      assert.ok(result.ok, `export should succeed: ${result.error || 'unknown error'}`);
      const fileCount = Object.keys(result.export.files).length;
      assert.ok(fileCount <= 20, `expected <= 20 files, got ${fileCount}`);

      // Core governance files should be prioritized over .planning/ files
      const coreFiles = Object.keys(result.export.files).filter(
        (p) => !p.startsWith('.planning/'),
      );
      assert.ok(coreFiles.length > 0, 'core governance files should be included');

      // Summary should report truncation
      assert.strictEqual(result.export.summary.export_files_truncated, true);
      assert.ok(result.export.summary.total_collected_files > 20);
      assert.strictEqual(result.export.summary.included_files, fileCount);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maxTextDataBytes truncates large text file data', () => {
    const root = createLargeGovernedProject(2, 200);
    try {
      const result = buildRunExport(root, {
        maxJsonlEntries: 100,
        maxBase64Bytes: 1024 * 1024,
        maxExportFiles: 500,
        maxTextDataBytes: 1024, // 1KB cap
      });

      assert.ok(result.ok, 'export should succeed');

      // Find a .planning/ text file
      const planningFile = Object.entries(result.export.files).find(
        ([p]) => p.startsWith('.planning/'),
      );
      assert.ok(planningFile, 'should have at least one .planning/ file');

      const [, fileObj] = planningFile;
      assert.ok(fileObj.truncated, 'large text file should be truncated');
      assert.ok(typeof fileObj.data === 'string', 'data should be a string');
      assert.ok(fileObj.data.length <= 1024, `data should be <= 1024 chars, got ${fileObj.data.length}`);
      assert.strictEqual(fileObj.content_base64, null, 'truncated file should skip base64');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('export with 600+ files completes with bounding and serializes to JSON', () => {
    const root = createLargeGovernedProject(600, 10);
    try {
      const result = buildRunExport(root, {
        maxJsonlEntries: 100,
        maxBase64Bytes: 65536,
        maxExportFiles: 200,
        maxTextDataBytes: 4096,
      });

      assert.ok(result.ok, 'export should succeed');
      const fileCount = Object.keys(result.export.files).length;
      assert.ok(fileCount <= 200, `expected <= 200 files, got ${fileCount}`);

      // Must serialize without Invalid string length
      const json = JSON.stringify(result.export);
      assert.ok(json.length > 0, 'serialized export should be non-empty');
      assert.ok(json.length < 50 * 1024 * 1024, 'serialized export should be under 50MB');

      // Must round-trip through parse
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.schema_version, result.export.schema_version);
      assert.strictEqual(parsed.summary.export_files_truncated, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounded export passes verifier with truncated text entries', () => {
    const root = createLargeGovernedProject(5, 200);
    try {
      const result = buildRunExport(root, {
        maxJsonlEntries: 100,
        maxBase64Bytes: 1024 * 1024,
        maxExportFiles: 500,
        maxTextDataBytes: 2048, // truncate large text
      });

      assert.ok(result.ok, 'export should succeed');

      // Verify the export artifact passes the BUG-86 verifier
      const verifyResult = verifyExportArtifact(result.export);
      assert.strictEqual(verifyResult.ok, true, `verifier should pass: ${JSON.stringify(verifyResult.errors)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('unbounded export without maxExportFiles includes all files', () => {
    const root = createLargeGovernedProject(10, 1);
    try {
      const result = buildRunExport(root, {
        maxJsonlEntries: 100,
        maxBase64Bytes: 1024 * 1024,
        // No maxExportFiles or maxTextDataBytes — unbounded
      });

      assert.ok(result.ok, 'export should succeed');
      const planningFiles = Object.keys(result.export.files).filter(
        (p) => p.startsWith('.planning/'),
      );
      assert.strictEqual(planningFiles.length, 10, 'all 10 .planning/ files should be included');
      assert.strictEqual(result.export.summary.export_files_truncated, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
