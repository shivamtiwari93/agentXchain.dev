import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { recordRunHistory, queryRunHistory, getRunHistoryPath, isInheritable } from '../src/lib/run-history.js';
import { RUN_EXPORT_INCLUDED_ROOTS, RUN_RESTORE_ROOTS } from '../src/lib/export.js';
import { ORCHESTRATOR_STATE_FILES } from '../src/lib/repo-observer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

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
        { run_id: 'run_abc123', role: 'dev', phase: 'planning', accepted_at: '2026-04-10T11:55:00.000Z', status: 'accepted', summary: 'Implemented the governed slice.' },
        { run_id: 'run_abc123', role: 'qa', phase: 'qa', accepted_at: '2026-04-10T11:58:00.000Z', status: 'accepted', summary: 'Verified the governed slice and requested release prep.', proposed_next_role: 'release_manager' },
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
      assert.equal(entries[0].retrospective.headline, 'Verified the governed slice and requested release prep.');
      assert.equal(entries[0].retrospective.terminal_reason, 'completed');
      assert.equal(entries[0].retrospective.next_operator_action, null);
      assert.match(entries[0].retrospective.follow_on_hint, /--continue-from run_abc123 --inherit-context/);
      assert.match(entries[0].retrospective.follow_on_hint, /release_manager/);
    });

    it('AT-RH-002: appends second run with different run_id', () => {
      writeHistory(root, [{ run_id: 'run_first', role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({ run_id: 'run_first' }), makeConfig(), 'completed');

      // Reset history for second run — BUG-50: entries must carry run_id for correct filtering
      writeHistory(root, [{ run_id: 'run_second', role: 'dev', phase: 'planning' }, { run_id: 'run_second', role: 'qa', phase: 'qa' }]);
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
      writeHistory(root, [{ run_id: 'run_abc123', role: 'dev', phase: 'planning' }]);
      const state = makeState({
        status: 'blocked',
        blocked_on: 'timeout:turn',
        blocked_reason: {
          category: 'timeout',
          recovery: {
            typed_reason: 'timeout',
            owner: 'operator',
            recovery_action: 'agentxchain resume',
            turn_retained: false,
            detail: 'turn timeout exceeded',
          },
        },
        completed_at: null,
      });
      const result = recordRunHistory(root, state, makeConfig(), 'blocked');
      assert.ok(result.ok);

      const entries = queryRunHistory(root);
      assert.strictEqual(entries[0].status, 'blocked');
      assert.strictEqual(entries[0].blocked_reason, 'timeout:turn');
      assert.equal(entries[0].retrospective.headline, 'turn timeout exceeded');
      assert.equal(entries[0].retrospective.terminal_reason, 'timeout');
      assert.equal(entries[0].retrospective.next_operator_action, 'agentxchain resume');
      assert.equal(entries[0].retrospective.follow_on_hint, null);
    });

    it('AT-RTSA-003: rejects reserved run-level failed status instead of writing it', () => {
      writeHistory(root, [{ role: 'dev', phase: 'planning' }]);
      const result = recordRunHistory(root, makeState({ status: 'failed' }), makeConfig(), 'failed');
      assert.equal(result.ok, false);
      assert.match(result.error, /completed or blocked only/);
      assert.deepStrictEqual(queryRunHistory(root), []);
    });

    it('records phases and roles from history entries', () => {
      writeHistory(root, [
        { run_id: 'run_abc123', role: 'pm', phase: 'planning' },
        { run_id: 'run_abc123', role: 'dev', phase: 'implementation' },
        { run_id: 'run_abc123', role: 'qa', phase: 'qa' },
      ]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries[0].phases_completed, ['planning', 'implementation', 'qa']);
      assert.deepStrictEqual(entries[0].roles_used, ['pm', 'dev', 'qa']);
    });

    it('records connector and model from config', () => {
      writeHistory(root, [{ run_id: 'run_abc123', role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.strictEqual(entries[0].connector_used, 'api_proxy');
      assert.strictEqual(entries[0].model_used, 'claude-haiku-4-5-20251001');
    });

    it('records gate results from state', () => {
      writeHistory(root, [{ run_id: 'run_abc123', role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries[0].gate_results, { planning_gate: 'passed', qa_gate: 'passed' });
    });

    it('records normalized provenance from governed state', () => {
      writeHistory(root, [{ run_id: 'run_abc123', role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({
        provenance: {
          trigger: 'continuation',
          parent_run_id: 'run_parent_001',
          trigger_reason: 'Continue after blocked QA review',
          created_by: 'operator',
        },
      }), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(entries[0].provenance, {
        trigger: 'continuation',
        parent_run_id: 'run_parent_001',
        trigger_reason: 'Continue after blocked QA review',
        intake_intent_id: null,
        created_by: 'operator',
      });
    });

    it('AT-RH-010: records bounded inheritance snapshot for later child-run context inheritance', () => {
      writeHistory(root, [
        { run_id: 'run_abc123', turn_id: 'turn_1', role: 'pm', phase: 'planning', status: 'accepted', summary: 'Planning summary' },
        { run_id: 'run_abc123', turn_id: 'turn_2', role: 'dev', phase: 'implementation', status: 'accepted', summary: 'Implementation summary' },
        { run_id: 'run_abc123', turn_id: 'turn_3', role: 'qa', phase: 'qa', status: 'accepted', summary: 'QA summary' },
        { run_id: 'run_abc123', turn_id: 'turn_4', role: 'pm', phase: 'qa', status: 'rejected', summary: 'Rejected summary should be excluded' },
      ]);
      writeLedger(root, [
        { id: 'DEC-001', statement: 'Decision 1', role: 'pm', phase: 'planning' },
        { id: 'DEC-002', statement: 'Decision 2', role: 'dev', phase: 'implementation' },
        { id: 'DEC-003', statement: 'Decision 3', role: 'qa', phase: 'qa' },
        { id: 'DEC-004', statement: 'Decision 4', role: 'pm', phase: 'qa' },
        { id: 'DEC-005', statement: 'Decision 5', role: 'pm', phase: 'qa' },
        { id: 'DEC-006', statement: 'Decision 6', role: 'pm', phase: 'qa' },
      ]);

      recordRunHistory(root, makeState(), makeConfig(), 'completed');

      const entries = queryRunHistory(root);
      assert.deepStrictEqual(
        entries[0].inheritance_snapshot.recent_decisions.map((entry) => entry.id),
        ['DEC-002', 'DEC-003', 'DEC-004', 'DEC-005', 'DEC-006']
      );
      assert.deepStrictEqual(
        entries[0].inheritance_snapshot.recent_accepted_turns.map((entry) => entry.turn_id),
        ['turn_1', 'turn_2', 'turn_3']
      );
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
      writeHistory(root, [{ run_id: 'run_abc123', role: 'dev', phase: 'planning' }]);
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

  it('default table shows trigger column with provenance and legacy fallback', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeHistory(root, [{ run_id: 'run_legacy_001', role: 'dev', phase: 'planning' }]);
      recordRunHistory(root, makeState({
        run_id: 'run_legacy_001',
        provenance: null,
      }), makeConfig(), 'completed');
      recordRunHistory(root, makeState({
        run_id: 'run_cont_001',
        provenance: {
          trigger: 'continuation',
          parent_run_id: 'run_parent_001',
          created_by: 'operator',
        },
      }), makeConfig(), 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--dir', root, '--limit', '2'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1', TZ: 'UTC' },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Trigger/);
      assert.match(result.stdout, /continuation/);
      assert.match(result.stdout, /legacy/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('default table shows retrospective headline column', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeHistory(root, [
        {
          run_id: 'run_headline_001',
          role: 'qa',
          phase: 'qa',
          status: 'completed',
          accepted_at: '2026-04-11T15:00:00.000Z',
          summary: 'Validated the governed release candidate and requested follow-up docs alignment for the operator handoff.',
        },
      ]);
      writeLedger(root, [{ id: 'DEC-001', statement: 'Ship it', role: 'qa', phase: 'qa' }]);
      recordRunHistory(root, makeState({ run_id: 'run_headline_001' }), makeConfig(), 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--dir', root, '--limit', '1'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1', TZ: 'UTC', NO_COLOR: '1' },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Headline/);
      assert.match(result.stdout, /Validated the governed release candidat…/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-HDOS-001 / AT-HDOS-002: default table shows derived Outcome and next action digest', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeHistory(root, [
        {
          run_id: 'run_blocked_operator_001',
          role: 'qa',
          phase: 'qa',
          status: 'accepted',
          accepted_at: '2026-04-11T15:00:00.000Z',
          summary: 'Blocked on release signoff.',
          proposed_next_role: 'release_manager',
        },
      ]);
      writeLedger(root, [{ id: 'DEC-001', statement: 'Wait for release signoff', role: 'qa', phase: 'qa' }]);
      recordRunHistory(root, makeState({
        run_id: 'run_blocked_operator_001',
        status: 'blocked',
        blocked_on: 'approval:release',
        blocked_reason: {
          category: 'approval',
          recovery: {
            typed_reason: 'needs_human',
            owner: 'operator',
            recovery_action: 'agentxchain approve-transition --phase release',
            turn_retained: true,
            detail: 'Waiting for release approval',
          },
        },
        completed_at: null,
      }), makeConfig(), 'blocked');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--dir', root, '--limit', '1'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1', TZ: 'UTC', NO_COLOR: '1' },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Outcome/);
      assert.match(result.stdout, /operator/);
      assert.match(result.stdout, /next: agentxchain approve-transition --phase release/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-HDOS-003: history --json includes outcome_summary', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeHistory(root, [
        { run_id: 'run_follow_on_001', role: 'qa', phase: 'qa', status: 'accepted', accepted_at: '2026-04-11T15:00:00.000Z', summary: 'Ready for release follow-on.' },
      ]);
      writeLedger(root, [{ id: 'DEC-001', statement: 'Prepare release follow-on', role: 'qa', phase: 'qa' }]);
      recordRunHistory(root, makeState({ run_id: 'run_follow_on_001' }), makeConfig(), 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--dir', root, '--limit', '1', '--json'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1', TZ: 'UTC' },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.length, 1);
      assert.equal(payload[0].outcome_summary.label, 'follow-on');
      assert.match(payload[0].outcome_summary.next_action, /agentxchain run --continue-from run_follow_on_001 --inherit-context/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    assert.ok(ORCHESTRATOR_STATE_FILES.includes('.agentxchain/run-history.jsonl'));
  });

  it('export.js includes run-history.jsonl in both export and restore roots', () => {
    assert.ok(RUN_EXPORT_INCLUDED_ROOTS.includes('.agentxchain/run-history.jsonl'));
    assert.ok(RUN_RESTORE_ROOTS.includes('.agentxchain/run-history.jsonl'));
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

  it('run-history dashboard component shows the Ctx and Headline columns plus inheritable indicator tooltip', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'components', 'run-history.js'),
      'utf8'
    );
    assert.match(source, /<th>Ctx<\/th>/);
    assert.match(source, /<th>Headline<\/th>/);
    assert.match(source, /Has inheritance snapshot/);
  });

  it('dashboard nav includes Run History as a named top-level view', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'dashboard', 'index.html'),
      'utf8'
    );
    assert.match(source, /<a href="#run-history">Run History<\/a>/);
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
    assert.match(docs, /`Trigger` column/);
    assert.match(docs, /`Outcome` column/);
    assert.match(docs, /`Ctx` column/);
    assert.match(docs, /`Headline` column/);
    assert.match(docs, /`next:` line/);
    assert.match(docs, /`inheritable`/);
    assert.match(docs, /`outcome_summary`/);
    assert.match(docs, /\[ctx\]/);
    assert.match(docs, /legacy/);
  });

  it('cli.mdx documents only completed and blocked as history status filters', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /agentxchain history \[--json\] \[--limit <n>\] \[--status completed\|blocked\]/);
    assert.match(docs, /Filter by terminal status: `completed` or `blocked`/);
    assert.doesNotMatch(docs, /Filter by terminal status: `completed`, `blocked`, or `failed`/);
  });

  it('cli.mdx command map includes history', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /\| `history` \|/);
  });

  it('dashboard docs classify Run History as a top-level dashboard view', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /The shipped dashboard surface has these top-level views:/);
    assert.match(docs, /\*\*Run History\*\*/);
  });

  it('dashboard docs include Run History view', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'),
      'utf8'
    );
    assert.match(docs, /\*\*Run History\*\*/);
    assert.match(docs, /status, outcome, trigger, context inheritance availability, phases, turns, cost, duration, retrospective headline, and compact `next:` cues/);
    assert.match(docs, /compact `next:` cues/);
  });
});

describe('isInheritable', () => {
  it('AT-IV-001: returns true when snapshot has decisions', () => {
    const entry = {
      inheritance_snapshot: {
        recent_decisions: [{ id: 'DEC-001', statement: 'test' }],
        recent_accepted_turns: [],
      },
    };
    assert.strictEqual(isInheritable(entry), true);
  });

  it('AT-IV-001b: returns true when snapshot has accepted turns', () => {
    const entry = {
      inheritance_snapshot: {
        recent_decisions: [],
        recent_accepted_turns: [{ turn_id: 'turn_1', role: 'dev' }],
      },
    };
    assert.strictEqual(isInheritable(entry), true);
  });

  it('AT-IV-002: returns false when snapshot is empty', () => {
    const entry = {
      inheritance_snapshot: {
        recent_decisions: [],
        recent_accepted_turns: [],
      },
    };
    assert.strictEqual(isInheritable(entry), false);
  });

  it('AT-IV-002b: returns false when snapshot is missing', () => {
    assert.strictEqual(isInheritable({}), false);
    assert.strictEqual(isInheritable(null), false);
    assert.strictEqual(isInheritable(undefined), false);
  });
});

describe('history CLI inheritance visibility', () => {
  it('AT-IV-003: history text table includes Ctx column header', () => {
    const tmpDir = makeTmpDir();
    try {
      scaffoldProject(tmpDir);
      writeFileSync(join(tmpDir, '.agentxchain', 'history.jsonl'),
        JSON.stringify({ turn_id: 'turn_1', role: 'dev', phase: 'planning', status: 'accepted', summary: 'test' }) + '\n');
      writeFileSync(join(tmpDir, '.agentxchain', 'decision-ledger.jsonl'),
        JSON.stringify({ id: 'DEC-001', statement: 'test', role: 'dev', phase: 'planning' }) + '\n');
      const state = { run_id: 'run_ctx_test', completed_at: new Date().toISOString() };
      const config = { project: { id: 'test', name: 'Test' }, template: 'generic', roles: {} };
      recordRunHistory(tmpDir, state, config, 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--dir', tmpDir], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.match(result.stdout, /Ctx/);
      assert.match(result.stdout, /Headline/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('AT-IV-001c: history --json includes inheritable: true for runs with snapshot data', () => {
    const tmpDir = makeTmpDir();
    try {
      scaffoldProject(tmpDir);
      writeFileSync(join(tmpDir, '.agentxchain', 'history.jsonl'),
        JSON.stringify({ turn_id: 'turn_1', role: 'dev', phase: 'planning', status: 'accepted', summary: 'test' }) + '\n');
      writeFileSync(join(tmpDir, '.agentxchain', 'decision-ledger.jsonl'),
        JSON.stringify({ id: 'DEC-001', statement: 'test', role: 'dev', phase: 'planning' }) + '\n');
      const state = { run_id: 'run_json_test', completed_at: new Date().toISOString() };
      const config = { project: { id: 'test', name: 'Test' }, template: 'generic', roles: {} };
      recordRunHistory(tmpDir, state, config, 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--json', '--dir', tmpDir], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });
      const entries = JSON.parse(result.stdout);
      assert.strictEqual(entries[0].inheritable, true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('AT-IV-002c: history --json includes inheritable: false for runs without snapshot data', () => {
    const tmpDir = makeTmpDir();
    try {
      scaffoldProject(tmpDir);
      // No history.jsonl or decision-ledger.jsonl — empty snapshot
      const state = { run_id: 'run_empty_test', completed_at: new Date().toISOString() };
      const config = { project: { id: 'test', name: 'Test' }, template: 'generic', roles: {} };
      recordRunHistory(tmpDir, state, config, 'completed');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--json', '--dir', tmpDir], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });
      const entries = JSON.parse(result.stdout);
      assert.strictEqual(entries[0].inheritable, false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('AT-IV-004: history --lineage adds [ctx] marker for inheritable runs', () => {
    const tmpDir = makeTmpDir();
    try {
      scaffoldProject(tmpDir);
      writeFileSync(join(tmpDir, '.agentxchain', 'run-history.jsonl'), [
        {
          run_id: 'run_parent',
          status: 'completed',
          phases_completed: ['planning'],
          total_turns: 3,
          total_cost_usd: 0.05,
          provenance: { trigger: 'manual', parent_run_id: null },
          inheritance_snapshot: {
            recent_decisions: [{ id: 'DEC-001', statement: 'carry this forward' }],
            recent_accepted_turns: [],
          },
        },
        {
          run_id: 'run_child',
          status: 'completed',
          phases_completed: ['implementation'],
          total_turns: 2,
          total_cost_usd: 0.03,
          provenance: { trigger: 'continuation', parent_run_id: 'run_parent' },
          inheritance_snapshot: {
            recent_decisions: [],
            recent_accepted_turns: [],
          },
        },
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--lineage', 'run_child', '--dir', tmpDir], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /run_parent.*\[ctx\]/);
      assert.doesNotMatch(result.stdout, /run_child.*\[ctx\]/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('AT-IV-005: history --lineage shows retrospective headline', () => {
    const tmpDir = makeTmpDir();
    try {
      scaffoldProject(tmpDir);
      writeFileSync(join(tmpDir, '.agentxchain', 'run-history.jsonl'), [
        {
          run_id: 'run_parent',
          status: 'completed',
          phases_completed: ['planning'],
          total_turns: 2,
          total_cost_usd: 0.04,
          provenance: { trigger: 'manual', parent_run_id: null },
          retrospective: { headline: 'Initial planning completed', terminal_reason: 'completed' },
          inheritance_snapshot: { recent_decisions: [], recent_accepted_turns: [] },
        },
        {
          run_id: 'run_child',
          status: 'blocked',
          phases_completed: ['implementation'],
          total_turns: 1,
          total_cost_usd: 0.02,
          provenance: { trigger: 'continuation', parent_run_id: 'run_parent' },
          retrospective: { headline: 'Blocked on missing API key', terminal_reason: 'blocked' },
          inheritance_snapshot: { recent_decisions: [], recent_accepted_turns: [] },
        },
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n');

      const result = spawnSync(process.execPath, [CLI_BIN, 'history', '--lineage', 'run_child', '--dir', tmpDir], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /run_parent.*Initial planning completed/);
      assert.match(result.stdout, /run_child.*Blocked on missing API key/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
