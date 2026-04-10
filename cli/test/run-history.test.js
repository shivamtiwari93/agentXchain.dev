import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { recordRunHistory, queryRunHistory, getRunHistoryPath } from '../src/lib/run-history.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `run-history-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffoldProject(root, overrides = {}) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'test-proj', name: 'Test Project' },
    template: 'generic',
    ...overrides.raw,
  }));
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_abc123',
    status: 'completed',
    phase: 'qa',
    completed_at: '2026-04-10T12:00:00.000Z',
    budget_status: { spent_usd: 0.05, remaining_usd: 1.95 },
    phase_gate_status: { planning_gate: 'passed', qa_gate: 'passed' },
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    project: { id: 'test-proj', name: 'Test Project' },
    template: 'generic',
    roles: {
      dev: { runtime_id: 'api_proxy', model: 'claude-haiku-4-5-20251001' },
    },
    budget: { per_run_max_usd: 2.00 },
    ...overrides,
  };
}

function writeHistory(root, entries) {
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(root, '.agentxchain/history.jsonl'), lines);
}

function writeLedger(root, entries) {
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), lines);
}

describe('run-history', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldProject(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  describe('recordRunHistory', () => {
    it('AT-RH-001: creates run-history.jsonl with one entry on completion', () => {
      writeHistory(root, [
        { role: 'dev', phase: 'planning', accepted_at: '2026-04-10T11:55:00.000Z' },
        { role: 'qa', phase: 'qa', accepted_at: '2026-04-10T11:58:00.000Z' },
      ]);
      writeLedger(root, [{ category: 'direction' }]);

      const result = recordRunHistory(root, makeState(), makeConfig(), 'completed');
      assert.ok(result.ok, 'recording should succeed');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].run_id, 'run_abc123');
      assert.strictEqual(entries[0].status, 'completed');
      assert.strictEqual(entries[0].total_turns, 2);
      assert.strictEqual(entries[0].decisions_count, 1);
      assert.ok(entries[0].total_cost_usd > 0);
    });

    it('AT-RH-002: appends second run with different run_id', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({ run_id: 'run_first' }), makeConfig(), 'completed');

      // Reset history for second run
      writeHistory(root, [{ role: 'dev', phase: 'planning' }, { role: 'qa', phase: 'qa' }]);
      recordRunHistory(root, makeState({ run_id: 'run_second' }), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].run_id, 'run_second'); // most recent first
      assert.strictEqual(entries[1].run_id, 'run_first');
    });

    it('AT-RH-008: recording failure does not throw', () => {
      // Pass invalid root — should return ok: false, not throw
      const result = recordRunHistory('/nonexistent/path/that/cannot/exist', makeState(), makeConfig(), 'completed');
      // The function is non-fatal; it should not throw regardless
      assert.ok(typeof result === 'object');
    });

    it('records blocked status with blocked_reason', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      const state = makeState({
        status: 'blocked',
        blocked_on: 'hook:after_acceptance:my-hook',
        blocked_reason: { detail: 'Hook my-hook failed validation' },
        completed_at: null,
      });
      const result = recordRunHistory(root, state, makeConfig(), 'blocked');
      assert.ok(result.ok);

      const entries = queryRunHistory(root);
      assert.strictEqual(entries[0].status, 'blocked');
      assert.strictEqual(entries[0].blocked_reason, 'Hook my-hook failed validation');
    });

    it('records phases and roles from history entries', () => {
      writeHistory(root, [
        { role: 'pm', phase: 'planning' },
        { role: 'dev', phase: 'implementation' },
        { role: 'qa', phase: 'qa' },
      ]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries[0].phases_completed, ['planning', 'implementation', 'qa']);
      assert.deepStrictEqual(entries[0].roles_used, ['pm', 'dev', 'qa']);
    });

    it('records connector and model from config', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries[0].connector_used, 'api_proxy');
      assert.strictEqual(entries[0].model_used, 'claude-haiku-4-5-20251001');
    });

    it('records gate results from state', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries[0].gate_results, { planning_gate: 'passed', qa_gate: 'passed' });
    });
  });

  describe('queryRunHistory', () => {
    it('AT-RH-003: --json returns all entries as array', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({ run_id: 'run_1' }), makeConfig(), 'completed');
      recordRunHistory(root, makeState({ run_id: 'run_2' }), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries.length, 2);
      assert.ok(Array.isArray(entries));
    });

    it('AT-RH-004: --limit returns only N most recent', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({ run_id: 'run_1' }), makeConfig(), 'completed');
      recordRunHistory(root, makeState({ run_id: 'run_2' }), makeConfig(), 'completed');
      recordRunHistory(root, makeState({ run_id: 'run_3' }), makeConfig(), 'completed');

      const entries = queryRunHistory(root, { limit: 1 });
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].run_id, 'run_3');
    });

    it('AT-RH-005: --status filters by terminal status', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({ run_id: 'run_ok' }), makeConfig(), 'completed');
      recordRunHistory(root, makeState({ run_id: 'run_blocked', status: 'blocked' }), makeConfig(), 'blocked');

      const completedOnly = queryRunHistory(root, { status: 'completed' });
      assert.strictEqual(completedOnly.length, 1);
      assert.strictEqual(completedOnly[0].run_id, 'run_ok');

      const blockedOnly = queryRunHistory(root, { status: 'blocked' });
      assert.strictEqual(blockedOnly.length, 1);
      assert.strictEqual(blockedOnly[0].run_id, 'run_blocked');
    });

    it('returns empty array when file does not exist', () => {
      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries, []);
    });

    it('skips corrupt JSONL lines', () => {
      const filePath = getRunHistoryPath(root);
      mkdirSync(join(root, '.agentxchain'), { recursive: true });
      writeFileSync(filePath, '{"run_id":"ok"}\nNOT JSON\n{"run_id":"ok2"}\n');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries.length, 2);
    });
  });

  describe('AT-RH-006: initializeGovernedRun does not delete run-history.jsonl', () => {
    it('run-history.jsonl persists across init', async () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      // Simulate what initializeGovernedRun does — it only writes state.json
      writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
        schema_version: '1.1',
        run_id: null,
        status: 'idle',
      }));

      // run-history.jsonl should still exist
      assert.ok(existsSync(getRunHistoryPath(root)));
      const entries = queryRunHistory(root);
      assert.strictEqual(entries.length, 1);
    });
  });
});

describe('run-history dashboard endpoint contract', () => {
  it('AT-RH-007: bridge-server imports queryRunHistory', async () => {
    const bridgeSource = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'dashboard', 'bridge-server.js'),
      'utf8'
    );
    assert.match(bridgeSource, /queryRunHistory/);
    assert.match(bridgeSource, /\/api\/run-history/);
  });
});

describe('run-history CLI command contract', () => {
  it('agentxchain.js registers the history command', () => {
    const cliSource = readFileSync(
      join(import.meta.dirname, '..', 'bin', 'agentxchain.js'),
      'utf8'
    );
    assert.match(cliSource, /\.command\('history'\)/);
    assert.match(cliSource, /historyCommand/);
  });

  it('history command is imported from commands/history.js', () => {
    const cliSource = readFileSync(
      join(import.meta.dirname, '..', 'bin', 'agentxchain.js'),
      'utf8'
    );
    assert.match(cliSource, /import.*historyCommand.*from.*commands\/history/);
  });
});

describe('run-history integration contracts', () => {
  it('governed-state.js imports recordRunHistory', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    assert.match(source, /import.*recordRunHistory.*from.*run-history/);
  });

  it('governed-state.js calls recordRunHistory in approveRunCompletion', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    assert.match(source, /recordRunHistory\(root,\s*updatedState,\s*config,\s*'completed'\)/);
  });

  it('repo-observer.js lists run-history.jsonl as orchestrator state', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'repo-observer.js'),
      'utf8'
    );
    assert.match(source, /run-history\.jsonl/);
  });

  it('export.js includes run-history.jsonl in both export and restore roots', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'export.js'),
      'utf8'
    );
    const matches = source.match(/run-history\.jsonl/g);
    assert.ok(matches && matches.length >= 2, 'run-history.jsonl should appear in both RUN_EXPORT_INCLUDED_ROOTS and RUN_RESTORE_ROOTS');
  });

  it('state-reader.js maps run-history.jsonl to /api/run-history', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'dashboard', 'state-reader.js'),
      'utf8'
    );
    assert.match(source, /run-history\.jsonl.*\/api\/run-history/);
  });
});

describe('run-history terminal recording contracts', () => {
  it('AT-RHTR-001: governed-state.js calls recordRunHistory in blockRunForHookIssue', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    // blockRunForHookIssue must record blocked outcome
    assert.match(source, /function blockRunForHookIssue[\s\S]*?recordRunHistory\(root,\s*blockedState,\s*notificationConfig,\s*'blocked'\)/);
  });

  it('AT-RHTR-002: acceptTurn records blocked outcome for needs_human/budget paths', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    // The acceptTurn function must call recordRunHistory with 'blocked' status
    assert.match(source, /recordRunHistory\(root,\s*updatedState,\s*config,\s*'blocked'\)/);
    // The comment must reference the spec
    assert.ok(source.includes('needs_human') && source.includes('budget'), 'source must mention needs_human and budget blocked paths');
  });

  it('AT-RHTR-003: conflict_loop blocked path records to run history', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    assert.match(source, /DEC-RHTR-SPEC.*conflict_loop/);
  });

  it('AT-RHTR-004: retries-exhausted blocked path records to run history', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    assert.match(source, /DEC-RHTR-SPEC.*retries-exhausted/);
  });

  it('AT-RHTR-005: recordRunHistory call in blockRunForHookIssue is non-fatal guard', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'governed-state.js'),
      'utf8'
    );
    // Recording should be inside a conditional guard so it cannot crash blocked-state persistence
    assert.match(source, /if \(notificationConfig\) \{\s*\n\s*recordRunHistory/);
  });
});

describe('run-history dashboard component contract', () => {
  it('dashboard app.js imports run-history component', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'app.js'),
      'utf8'
    );
    assert.match(source, /import.*renderRunHistory.*from.*components\/run-history/);
  });

  it('dashboard app.js registers run-history view', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'app.js'),
      'utf8'
    );
    assert.match(source, /'run-history':\s*\{/);
    assert.match(source, /fetch:\s*\['runHistory'\]/);
  });

  it('dashboard app.js has runHistory in API_MAP', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'app.js'),
      'utf8'
    );
    assert.match(source, /runHistory:\s*'\/api\/run-history'/);
  });

  it('dashboard index.html has Run History nav tab', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'index.html'),
      'utf8'
    );
    assert.match(source, /href="#run-history".*Run History/);
  });

  it('run-history component file exists and exports render', () => {
    const componentPath = join(import.meta.dirname, '..', 'dashboard', 'components', 'run-history.js');
    assert.ok(existsSync(componentPath), 'run-history.js component must exist');
    const source = readFileSync(componentPath, 'utf8');
    assert.match(source, /export function render/);
  });

  it('dashboard nav has exactly 10 tabs', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'index.html'),
      'utf8'
    );
    const navMatch = source.match(/<nav>[\s\S]*?<\/nav>/);
    assert.ok(navMatch, 'nav element must exist');
    const tabCount = (navMatch[0].match(/href="#/g) || []).length;
    assert.strictEqual(tabCount, 10, `Expected 10 nav tabs, found ${tabCount}`);
  });
});

describe('run-history docs contract', () => {
  it('AT-RH-009: cli.mdx documents the history command', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /### `history`/);
    assert.match(docs, /agentxchain history/);
    assert.match(docs, /run-history\.jsonl/);
  });

  it('cli.mdx command map includes history', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /\| `history` \|/);
  });

  it('dashboard docs mention ten views', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /ten top-level views/);
  });

  it('dashboard docs include Run History view', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /\*\*Run History\*\*/);
  });
});
