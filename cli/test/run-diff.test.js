import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');

function makeTmpDir() {
  const dir = join(tmpdir(), `run-diff-test-${randomBytes(6).toString('hex')}`);
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
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), lines);
}

function makeEntry(overrides = {}) {
  return {
    run_id: 'run_alpha_1234567890',
    status: 'completed',
    template: 'generic',
    total_turns: 2,
    decisions_count: 1,
    total_cost_usd: 0.05,
    budget_limit_usd: 1.5,
    duration_ms: 30_000,
    phases_completed: ['planning'],
    roles_used: ['dev'],
    gate_results: { planning_signoff: 'passed' },
    connector_used: 'local-dev',
    model_used: 'claude-sonnet',
    provenance: { trigger: 'manual', created_by: 'operator' },
    retrospective: { headline: 'Planning completed cleanly' },
    inheritance_snapshot: { recent_decisions: [], recent_accepted_turns: [] },
    recorded_at: '2026-04-12T23:00:00.000Z',
    ...overrides,
  };
}

describe('agentxchain diff', () => {
  it('AT-RD-001: text mode compares two run-history entries', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({
          run_id: 'run_beta_9876543210',
          status: 'blocked',
          total_turns: 4,
          decisions_count: 3,
          total_cost_usd: 0.08,
          duration_ms: 45_000,
          phases_completed: ['planning', 'implementation'],
          roles_used: ['dev', 'qa'],
          gate_results: { planning_signoff: 'passed', implementation_complete: 'pending' },
          blocked_reason: 'Missing API key',
          provenance: { trigger: 'continuation', parent_run_id: 'run_alpha_1234567890', created_by: 'operator' },
          retrospective: { headline: 'Blocked on external credential' },
          inheritance_snapshot: { recent_decisions: [{ id: 'DEC-001' }], recent_accepted_turns: [] },
          recorded_at: '2026-04-12T23:10:00.000Z',
        }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha_1234567890', 'run_beta_9876543210', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Run Diff/);
      assert.match(result.stdout, /Status: completed -> blocked/);
      assert.match(result.stdout, /Trigger: manual -> continuation/);
      assert.match(result.stdout, /Turns: 2 -> 4 \(\+2\)/);
      assert.match(result.stdout, /Phases added: implementation/);
      assert.match(result.stdout, /Roles added: qa/);
      assert.match(result.stdout, /implementation_complete: — -> pending/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-002: --json returns structured diff output', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({ run_id: 'run_beta_9876543210', total_turns: 5, roles_used: ['dev', 'qa'] }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha_1234567890', 'run_beta_9876543210', '--json', '--dir', root], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.left.run_id, 'run_alpha_1234567890');
      assert.equal(payload.right.run_id, 'run_beta_9876543210');
      assert.equal(payload.numeric_changes.total_turns.delta, 3);
      assert.deepEqual(payload.list_changes.roles_used.added, ['qa']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-003: unique prefixes resolve', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({ run_id: 'run_beta_9876543210' }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha', 'run_beta', '--json', '--dir', root], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.left.run_id, 'run_alpha_1234567890');
      assert.equal(payload.right.run_id, 'run_beta_9876543210');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-004: ambiguous prefixes fail closed', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry({ run_id: 'run_same_prefix_a' }),
        makeEntry({ run_id: 'run_same_prefix_b' }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_same_prefix', 'run_same_prefix_b', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /ambiguous/);
      assert.match(result.stderr, /run_same_prefix_a/);
      assert.match(result.stderr, /run_same_prefix_b/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run diff docs contract', () => {
  const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');

  it('AT-RD-005: cli docs map and section document diff truthfully', () => {
    assert.match(CLI_DOCS, /\| `diff` \| Observability \| Compare two recorded governed runs and summarize what changed \|/);
    assert.match(CLI_DOCS, /### `diff`/);
    assert.match(CLI_DOCS, /agentxchain diff <left_run_id> <right_run_id>/);
    assert.match(CLI_DOCS, /full run IDs or unique prefixes/i);
    assert.match(CLI_DOCS, /ambiguous prefixes fail closed/i);
  });
});
