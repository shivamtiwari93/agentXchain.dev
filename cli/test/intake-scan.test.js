import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-scan-'));
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    project: 'test-scan',
    protocol_mode: 'governed',
    version: '1.0',
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  return dir;
}

function runCli(args, cwd, input) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    input,
  });
}

function readIntakeFiles(dir, subdir) {
  const path = join(dir, '.agentxchain', 'intake', subdir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'))
    .map(f => JSON.parse(readFileSync(join(path, f), 'utf8')));
}

function makeSnapshot(source, items) {
  return {
    source,
    captured_at: new Date().toISOString(),
    items,
  };
}

function validCiItem(overrides = {}) {
  return {
    signal: { workflow: 'build', run_id: '123', status: 'failed' },
    evidence: [{ type: 'url', value: 'https://example.com/runs/123' }],
    category: 'delivery_regression',
    ...overrides,
  };
}

describe('intake scan', () => {
  let dir;
  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S4-001: scan creates new event and linked detected intent
  it('creates a new event and detected intent for a valid ci_failure item', () => {
    const snapshot = makeSnapshot('ci_failure', [validCiItem()]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.source, 'ci_failure');
    assert.equal(out.scanned, 1);
    assert.equal(out.created, 1);
    assert.equal(out.deduplicated, 0);
    assert.equal(out.rejected, 0);
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].status, 'created');
    assert.match(out.results[0].event_id, /^evt_\d+_[0-9a-f]{4}$/);
    assert.match(out.results[0].intent_id, /^intent_\d+_[0-9a-f]{4}$/);

    // Verify files on disk
    const events = readIntakeFiles(dir, 'events');
    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'ci_failure');
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 1);
    assert.equal(intents[0].status, 'detected');
  });

  // AT-V3S4-002: dedup on second scan
  it('returns deduplicated on second scan of the same snapshot', () => {
    const snapshot = makeSnapshot('ci_failure', [validCiItem()]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    // First scan
    runCli(['intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json'], dir);

    // Second scan — same content
    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.scanned, 1);
    assert.equal(out.created, 0);
    assert.equal(out.deduplicated, 1);
    assert.equal(out.results[0].status, 'deduplicated');

    // Still only one event and one intent on disk
    assert.equal(readIntakeFiles(dir, 'events').length, 1);
    assert.equal(readIntakeFiles(dir, 'intents').length, 1);
  });

  // AT-V3S4-003: stdin input with git_ref_change
  it('accepts stdin snapshots for git_ref_change source', () => {
    const snapshot = makeSnapshot('git_ref_change', [{
      signal: { ref: 'refs/tags/v3.0.0', action: 'created' },
      evidence: [{ type: 'text', value: 'tag push detected' }],
    }]);

    const result = runCli(
      ['intake', 'scan', '--source', 'git_ref_change', '--stdin', '--json'],
      dir,
      JSON.stringify(snapshot),
    );

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.source, 'git_ref_change');
    assert.equal(out.created, 1);
  });

  // AT-V3S4-004: malformed items rejected, valid siblings still recorded
  it('rejects malformed items without preventing valid sibling items', () => {
    const snapshot = makeSnapshot('ci_failure', [
      validCiItem(),
      { signal: {}, evidence: [] }, // bad: empty evidence
      validCiItem({ signal: { workflow: 'deploy', run_id: '456', status: 'failed' } }),
    ]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.scanned, 3);
    assert.equal(out.created, 2);
    assert.equal(out.rejected, 1);
    assert.equal(out.results[1].status, 'rejected');
    assert.ok(out.results[1].error.includes('evidence'));
  });

  // AT-V3S4-005: source mismatch
  it('fails deterministically on source mismatch', () => {
    const snapshot = makeSnapshot('git_ref_change', [validCiItem()]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('source mismatch'));
  });

  // AT-V3S4-006: manual rejected as scan source
  it('rejects manual as a scan source', () => {
    const snapshot = makeSnapshot('manual', [validCiItem()]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'manual', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('unknown scan source'));
    assert.ok(out.error.includes('manual'));
  });

  // AT-V3S4-007: scan never transitions intents past detected
  it('never transitions intents past detected', () => {
    const snapshot = makeSnapshot('ci_failure', [
      validCiItem(),
      validCiItem({ signal: { workflow: 'test', run_id: '789', status: 'failed' } }),
    ]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 0);
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 2);
    for (const intent of intents) {
      assert.equal(intent.status, 'detected', `intent ${intent.intent_id} should be detected, got ${intent.status}`);
    }
  });

  // Edge: missing --file and --stdin
  it('fails when neither --file nor --stdin is provided', () => {
    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('--file') || out.error.includes('--stdin'));
  });

  // Edge: both --file and --stdin
  it('fails when both --file and --stdin are provided', () => {
    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', 'x.json', '--stdin', '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('mutually exclusive'));
  });

  // Edge: unreadable file
  it('exits 2 for non-existent snapshot file', () => {
    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', '/tmp/no-such-file.json', '--json',
    ], dir);

    assert.equal(result.status, 2);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
  });

  // Edge: invalid JSON
  it('fails on invalid JSON in snapshot file', () => {
    const badPath = join(dir, 'bad.json');
    writeFileSync(badPath, '{ not valid json }');

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', badPath, '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
  });

  // Edge: empty items array
  it('fails when the snapshot items array is empty', () => {
    const snapshot = makeSnapshot('ci_failure', []);
    const snapshotPath = join(dir, 'snapshot-empty.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('non-empty items array'));
  });

  // Edge: all items rejected exits 1
  it('exits 1 when all items are rejected', () => {
    const snapshot = makeSnapshot('ci_failure', [
      { signal: {}, evidence: [] },
      { bad: true },
    ]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('all scanned items were rejected'));
    assert.equal(out.rejected, 2);
  });

  // Edge: schedule source
  it('accepts schedule as a valid scan source', () => {
    const snapshot = makeSnapshot('schedule', [{
      signal: { check: 'stale_release', last_release: '2026-03-15' },
      evidence: [{ type: 'text', value: 'release is 19 days old' }],
    }]);
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = runCli([
      'intake', 'scan', '--source', 'schedule', '--file', snapshotPath, '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.source, 'schedule');
    assert.equal(out.created, 1);
  });

  // Edge: no project root
  it('exits 2 when no agentxchain.json exists', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'axc-scan-empty-'));
    try {
      const snapshot = makeSnapshot('ci_failure', [validCiItem()]);
      const snapshotPath = join(emptyDir, 'snapshot.json');
      writeFileSync(snapshotPath, JSON.stringify(snapshot));

      const result = runCli([
        'intake', 'scan', '--source', 'ci_failure', '--file', snapshotPath, '--json',
      ], emptyDir);

      assert.equal(result.status, 2);
      const out = JSON.parse(result.stdout);
      assert.equal(out.ok, false);
      assert.ok(out.error.includes('agentxchain.json'));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // Edge: multi-item with mixed new and duplicate
  it('handles mixed new and duplicate items in one scan', () => {
    // First scan — record item A
    const snapshotA = makeSnapshot('ci_failure', [validCiItem()]);
    const pathA = join(dir, 'a.json');
    writeFileSync(pathA, JSON.stringify(snapshotA));
    runCli(['intake', 'scan', '--source', 'ci_failure', '--file', pathA, '--json'], dir);

    // Second scan — item A (dup) + item B (new)
    const snapshotMixed = makeSnapshot('ci_failure', [
      validCiItem(),
      validCiItem({ signal: { workflow: 'lint', run_id: '999', status: 'failed' } }),
    ]);
    const pathMixed = join(dir, 'mixed.json');
    writeFileSync(pathMixed, JSON.stringify(snapshotMixed));

    const result = runCli([
      'intake', 'scan', '--source', 'ci_failure', '--file', pathMixed, '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.scanned, 2);
    assert.equal(out.created, 1);
    assert.equal(out.deduplicated, 1);
  });
});
