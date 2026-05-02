/**
 * BUG-67: Report generation "Invalid string length" crash.
 *
 * Verifies that buildRunExport() with maxJsonlEntries and maxBase64Bytes
 * correctly truncates large JSONL files and skips base64 for oversized files,
 * preventing V8 string length crashes during auto-report generation.
 *
 * Spec: .planning/BUG_67_REPORT_STRING_LENGTH_SPEC.md
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildRunExport } = await import(join(cliRoot, 'src', 'lib', 'export.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function createGovernedProject(entryCount) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug67-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'bug67-test', name: 'BUG-67 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: { requires_human_approval: false } },
    protocol_mode: 'governed',
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'bug67-test',
    status: 'idle',
    phase: 'implementation',
    run_id: 'run_test',
    turn_sequence: 0,
    active_turns: {},
  });

  // Generate JSONL entries
  const events = [];
  for (let i = 0; i < entryCount; i++) {
    events.push({
      type: 'turn_dispatched',
      timestamp: new Date(Date.now() - (entryCount - i) * 1000).toISOString(),
      run_id: 'run_test',
      turn_id: `turn_${String(i).padStart(4, '0')}`,
      role: 'dev',
      phase: 'implementation',
      payload: { data: 'x'.repeat(200) },
    });
  }
  writeJsonl(join(root, '.agentxchain', 'events.jsonl'), events);

  const history = [];
  for (let i = 0; i < Math.min(entryCount, 50); i++) {
    history.push({
      turn_id: `turn_${String(i).padStart(4, '0')}`,
      run_id: 'run_test',
      role: 'dev',
      phase: 'implementation',
      status: 'accepted',
      files_changed: [],
      assigned_sequence: i,
      accepted_at: new Date().toISOString(),
    });
  }
  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), history);

  return root;
}

const roots = [];
afterEach(() => {
  while (roots.length > 0) {
    try { rmSync(roots.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BUG-67: report generation string length guard', () => {
  it('AT-BUG67-001: truncates JSONL to last N entries when maxJsonlEntries is set', () => {
    const root = createGovernedProject(200);
    roots.push(root);
    const result = buildRunExport(root, { maxJsonlEntries: 50 });

    assert.ok(result.ok, 'export should succeed');

    const eventsFile = result.export.files['.agentxchain/events.jsonl'];
    assert.ok(eventsFile, 'events.jsonl should be in export');
    assert.strictEqual(eventsFile.truncated, true, 'should be marked truncated');
    assert.strictEqual(eventsFile.total_entries, 200, 'total_entries should be 200');
    assert.strictEqual(eventsFile.retained_entries, 50, 'retained_entries should be 50');
    assert.strictEqual(eventsFile.data.length, 50, 'data array should have 50 entries');
    assert.strictEqual(eventsFile.content_base64, null, 'base64 should be null when truncated');

    // Verify we kept the TAIL (most recent entries)
    assert.strictEqual(eventsFile.data[0].turn_id, 'turn_0150', 'first retained entry should be entry 150');
    assert.strictEqual(eventsFile.data[49].turn_id, 'turn_0199', 'last retained entry should be entry 199');
  });

  it('AT-BUG67-002: skips base64 for files exceeding maxBase64Bytes', () => {
    const root = createGovernedProject(10);
    roots.push(root);
    // events.jsonl with 10 entries is small; set a very low threshold
    const result = buildRunExport(root, { maxBase64Bytes: 100 });

    assert.ok(result.ok, 'export should succeed');

    const eventsFile = result.export.files['.agentxchain/events.jsonl'];
    assert.ok(eventsFile, 'events.jsonl should be in export');
    // The file should exceed 100 bytes with 10 entries
    assert.ok(eventsFile.bytes > 100, 'file should exceed the threshold');
    assert.strictEqual(eventsFile.content_base64, null, 'base64 should be null');
    assert.strictEqual(eventsFile.content_base64_skipped, true, 'should have skipped marker');
    // Data should NOT be truncated
    assert.strictEqual(eventsFile.data.length, 10, 'data should have all 10 entries');
    assert.strictEqual(eventsFile.truncated, undefined, 'should not be marked truncated');
  });

  it('AT-BUG67-003: no truncation when entry count is within limit', () => {
    const root = createGovernedProject(30);
    roots.push(root);
    const result = buildRunExport(root, { maxJsonlEntries: 50 });

    assert.ok(result.ok, 'export should succeed');

    const eventsFile = result.export.files['.agentxchain/events.jsonl'];
    assert.ok(eventsFile, 'events.jsonl should be in export');
    assert.strictEqual(eventsFile.data.length, 30, 'all 30 entries retained');
    assert.strictEqual(eventsFile.truncated, undefined, 'should not be marked truncated');
    assert.ok(eventsFile.content_base64, 'base64 should be present');
  });

  it('AT-BUG67-004: no options means full export (backward compat)', () => {
    const root = createGovernedProject(100);
    roots.push(root);
    const result = buildRunExport(root);

    assert.ok(result.ok, 'export should succeed');

    const eventsFile = result.export.files['.agentxchain/events.jsonl'];
    assert.strictEqual(eventsFile.data.length, 100, 'all 100 entries');
    assert.strictEqual(eventsFile.truncated, undefined, 'no truncation');
    assert.ok(eventsFile.content_base64, 'base64 present');
  });

  it('AT-BUG67-005: capped JSONL export does not stringify the whole large JSONL buffer', () => {
    const root = createGovernedProject(200);
    roots.push(root);

    const originalToString = Buffer.prototype.toString;
    Buffer.prototype.toString = function guardedToString(encoding, start, end) {
      if ((encoding === 'utf8' || encoding === undefined)
        && start === undefined
        && end === undefined
        && this.length > 1000) {
        throw new Error('BUG-67 regression: attempted whole-buffer UTF-8 conversion');
      }
      return originalToString.call(this, encoding, start, end);
    };

    try {
      const result = buildRunExport(root, { maxJsonlEntries: 50 });
      assert.ok(result.ok, 'export should succeed');
      const eventsFile = result.export.files['.agentxchain/events.jsonl'];
      assert.strictEqual(eventsFile.truncated, true, 'should still truncate');
      assert.strictEqual(eventsFile.data.length, 50, 'should retain capped tail');
      assert.strictEqual(eventsFile.data[0].turn_id, 'turn_0150', 'first retained entry should be entry 150');
    } finally {
      Buffer.prototype.toString = originalToString;
    }
  });
});
