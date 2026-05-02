import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { queryRunLineage, validateParentRun, getRunHistoryPath } from '../src/lib/run-history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function makeTmpDir() {
  const dir = join(tmpdir(), `provenance-lineage-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffoldProject(root) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'test-proj', name: 'Test Project' },
    template: 'generic',
  }));
}

function writeRunHistory(root, entries) {
  const filePath = join(root, '.agentxchain/run-history.jsonl');
  mkdirSync(dirname(filePath), { recursive: true });
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(filePath, lines);
}

// ── queryRunLineage tests ──────────────────────────────────────────────────

describe('queryRunLineage', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldProject(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('AT-7: walks lineage chain R1 → R2 → R3', () => {
    writeRunHistory(root, [
      {
        run_id: 'run_001',
        status: 'completed',
        phases_completed: ['planning', 'impl'],
        total_turns: 12,
        total_cost_usd: 0.42,
        provenance: { trigger: 'manual', parent_run_id: null, created_by: 'operator' },
      },
      {
        run_id: 'run_002',
        status: 'blocked',
        phases_completed: ['qa'],
        total_turns: 8,
        total_cost_usd: 0.18,
        provenance: { trigger: 'continuation', parent_run_id: 'run_001', created_by: 'operator' },
      },
      {
        run_id: 'run_003',
        status: 'completed',
        phases_completed: ['qa'],
        total_turns: 5,
        total_cost_usd: 0.10,
        provenance: { trigger: 'recovery', parent_run_id: 'run_002', created_by: 'operator' },
      },
    ]);

    const result = queryRunLineage(root, 'run_003');
    assert.ok(result.ok);
    assert.strictEqual(result.chain.length, 3);
    assert.strictEqual(result.chain[0].run_id, 'run_001');
    assert.strictEqual(result.chain[1].run_id, 'run_002');
    assert.strictEqual(result.chain[2].run_id, 'run_003');
    assert.strictEqual(result.chain[0].provenance.parent_run_id, null);
    assert.strictEqual(result.chain[1].provenance.parent_run_id, 'run_001');
    assert.strictEqual(result.chain[2].provenance.parent_run_id, 'run_002');
  });

  it('returns single entry for run with no parent', () => {
    writeRunHistory(root, [
      {
        run_id: 'run_solo',
        status: 'completed',
        provenance: { trigger: 'manual', parent_run_id: null },
      },
    ]);

    const result = queryRunLineage(root, 'run_solo');
    assert.ok(result.ok);
    assert.strictEqual(result.chain.length, 1);
    assert.strictEqual(result.chain[0].run_id, 'run_solo');
  });

  it('terminates with broken_link sentinel when parent is missing', () => {
    writeRunHistory(root, [
      {
        run_id: 'run_orphan',
        status: 'completed',
        provenance: { trigger: 'continuation', parent_run_id: 'run_deleted', created_by: 'operator' },
      },
    ]);

    const result = queryRunLineage(root, 'run_orphan');
    assert.ok(result.ok);
    assert.strictEqual(result.chain.length, 2);
    assert.strictEqual(result.chain[0].broken_link, true);
    assert.strictEqual(result.chain[0].missing_run_id, 'run_deleted');
    assert.strictEqual(result.chain[1].run_id, 'run_orphan');
  });

  it('returns error when run_id not found', () => {
    writeRunHistory(root, [
      { run_id: 'run_exists', status: 'completed', provenance: null },
    ]);

    const result = queryRunLineage(root, 'run_nonexistent');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /not found/);
  });

  it('returns error when no history file exists', () => {
    const result = queryRunLineage(root, 'run_any');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /No run history found/);
  });
});

// ── validateParentRun tests ────────────────────────────────────────────────

describe('validateParentRun', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldProject(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('AT-4: rejects non-existent run_id', () => {
    writeRunHistory(root, [
      { run_id: 'run_real', status: 'completed' },
    ]);

    const result = validateParentRun(root, 'FAKE');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /not found/);
  });

  it('AT-5: rejects active (non-terminal) run', () => {
    writeRunHistory(root, [
      { run_id: 'run_active', status: 'active' },
    ]);

    const result = validateParentRun(root, 'run_active');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /still active/);
  });

  it('accepts completed run', () => {
    writeRunHistory(root, [
      { run_id: 'run_done', status: 'completed' },
    ]);

    const result = validateParentRun(root, 'run_done');
    assert.ok(result.ok);
    assert.strictEqual(result.entry.run_id, 'run_done');
  });

  it('accepts blocked run', () => {
    writeRunHistory(root, [
      { run_id: 'run_blocked', status: 'blocked' },
    ]);

    const result = validateParentRun(root, 'run_blocked');
    assert.ok(result.ok);
  });

  it('returns error when no history file', () => {
    const result = validateParentRun(root, 'run_any');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /not found/);
  });
});

// ── CLI --lineage flag tests ───────────────────────────────────────────────

describe('history --lineage CLI', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldProject(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('--lineage --json returns ordered chain as JSON array', () => {
    writeRunHistory(root, [
      {
        run_id: 'run_a',
        status: 'completed',
        phases_completed: ['planning'],
        total_turns: 4,
        total_cost_usd: 0.10,
        provenance: { trigger: 'manual', parent_run_id: null },
      },
      {
        run_id: 'run_b',
        status: 'completed',
        phases_completed: ['impl'],
        total_turns: 6,
        total_cost_usd: 0.20,
        provenance: { trigger: 'continuation', parent_run_id: 'run_a' },
      },
    ]);

    const result = spawnSync(process.execPath, [
      CLI_BIN, 'history', '--lineage', 'run_b', '--json', '--dir', root,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15000,
    });

    assert.equal(result.status, 0, result.stderr);
    const chain = JSON.parse(result.stdout);
    assert.ok(Array.isArray(chain));
    assert.strictEqual(chain.length, 2);
    assert.strictEqual(chain[0].run_id, 'run_a');
    assert.strictEqual(chain[1].run_id, 'run_b');
  });

  it('--lineage text output shows tree format', () => {
    writeRunHistory(root, [
      {
        run_id: 'run_root',
        status: 'completed',
        phases_completed: ['planning'],
        total_turns: 3,
        total_cost_usd: 0.05,
        provenance: { trigger: 'manual', parent_run_id: null },
      },
      {
        run_id: 'run_child',
        status: 'blocked',
        phases_completed: ['qa'],
        total_turns: 2,
        total_cost_usd: 0.02,
        provenance: { trigger: 'continuation', parent_run_id: 'run_root' },
      },
    ]);

    const result = spawnSync(process.execPath, [
      CLI_BIN, 'history', '--lineage', 'run_child', '--dir', root,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Run Lineage for run_child/);
    assert.match(result.stdout, /run_root/);
    assert.match(result.stdout, /run_child/);
    assert.match(result.stdout, /continuation/);
  });

  it('--lineage exits with error for missing run', () => {
    writeRunHistory(root, [
      { run_id: 'run_exists', status: 'completed', provenance: null },
    ]);

    const result = spawnSync(process.execPath, [
      CLI_BIN, 'history', '--lineage', 'NOPE', '--dir', root,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15000,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not found/);
  });
});

// ── CLI --continue-from / --recover-from flag contracts ────────────────────

describe('run command provenance flags (source contract)', () => {
  it('AT-6: run.js rejects both --continue-from and --recover-from', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'commands', 'run.js'),
      'utf8'
    );
    assert.match(source, /continueFrom && recoverFrom/);
    assert.match(source, /Cannot specify both/);
  });

  it('run.js imports validateParentRun', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'commands', 'run.js'),
      'utf8'
    );
    assert.match(source, /import.*validateParentRun.*from.*run-history/);
  });

  it('run.js builds provenance with trigger=continuation for --continue-from', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'commands', 'run.js'),
      'utf8'
    );
    assert.match(source, /trigger: continueFrom \? 'continuation' : 'recovery'/);
  });

  it('run.js passes provenance to runLoop options', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'commands', 'run.js'),
      'utf8'
    );
    assert.match(source, /runLoopOpts\.provenance = provenance/);
  });

  it('agentxchain.js registers --continue-from and --recover-from on run', () => {
    const source = readFileSync(
      join(__dirname, '..', 'bin', 'agentxchain.js'),
      'utf8'
    );
    assert.match(source, /--continue-from <run_id>/);
    assert.match(source, /--recover-from <run_id>/);
  });

  it('agentxchain.js registers --lineage on history', () => {
    const source = readFileSync(
      join(__dirname, '..', 'bin', 'agentxchain.js'),
      'utf8'
    );
    assert.match(source, /--lineage <run_id>/);
  });

  it('run-loop.js passes provenance to initRun', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'run-loop.js'),
      'utf8'
    );
    assert.match(source, /options\.provenance/);
    assert.match(source, /initRun\(root, config, initOpts\)/);
  });
});
