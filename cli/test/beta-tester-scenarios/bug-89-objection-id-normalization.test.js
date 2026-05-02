/**
 * BUG-89 beta-tester scenario: QA turn emits objection with id "OBJ-002-M31"
 * which does not match the required /^OBJ-\d+$/ pattern. The normalizer must
 * rewrite invalid IDs to deterministic OBJ-001, OBJ-002, ... before schema
 * validation, so the turn accepts without manual staging JSON surgery.
 *
 * This is a BUG-79-class regression: same staged-result field-shape mismatch,
 * different field (id instead of statement).
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function createProject(roleId, objections) {
  const root = mkdtempSync(join(tmpdir(), `axc-bug89-${roleId}-`));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = `local-${roleId}`;
  const changedFiles = ['.planning/ROADMAP.md', '.planning/ship-verdict.md'];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug89-cli-test', id: `bug89-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      [roleId]: {
        title: roleId === 'qa' ? 'QA' : roleId === 'pm' ? 'Product Manager' : 'Product Marketing',
        mandate: 'Perform governed review and QA work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement accepted planning work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      [runtimeId]: { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: roleId, allowed_next_roles: [roleId, 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: roleId, allowed_next_roles: [roleId, 'human'] },
    },
    gates: {
      planning_signoff: { type: 'automatic', required: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(root, 'README.md'), '# BUG-89 fixture\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n- [ ] M31 item\n');
  writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship verdict\n\nInitial.\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug89@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-89 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add README.md agentxchain.json .gitignore .planning', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  const baseline = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  // Simulate QA work
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n- [x] M31 item\n');
  writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship verdict\n\nInitial.\n\n## M31 Verification\n\nAll criteria pass. Ship verdict: SHIP.\n');

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'planning',
    accepted_integration_ref: `git:${baseline}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: roleId,
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
    budget_reservations: {},
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');

  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary: 'Challenged dev M31 implementation, ran independent verification, ship verdict SHIP.',
    decisions: [{ id: 'DEC-001', category: 'quality', statement: 'M31 verification complete.', rationale: 'All acceptance criteria pass.' }],
    objections,
    files_changed: changedFiles,
    artifacts_created: changedFiles,
    verification: { status: 'pass', commands: ['npm test'], evidence_summary: 'All tests pass.', machine_evidence: [{ command: 'npm test', exit_code: 0 }] },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { usd: 0 },
  }, null, 2));

  return { root, turnId };
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function acceptAndRead(root, turnId, extraArgs = []) {
  const accept = runCli(root, ['accept-turn', '--turn', turnId, ...extraArgs]);
  assert.equal(accept.status, 0, `accept-turn must succeed:\n${accept.stdout}\n${accept.stderr}`);
  return {
    history: readJsonl(join(root, '.agentxchain', 'history.jsonl')),
    events: readJsonl(join(root, '.agentxchain', 'events.jsonl')),
  };
}

describe('BUG-89: objection ID normalization', () => {
  it('normalizes "OBJ-002-M31" suffix to OBJ-001 (exact tester reproduction)', () => {
    const { root, turnId } = createProject('qa', [{
      id: 'OBJ-002-M31',
      severity: 'low',
      statement: 'Flag value assertions not independently smoke-asserted. Non-blocking at V1.12.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].id'
      && e.payload?.original_value === 'OBJ-002-M31'
      && e.payload?.rationale === 'invalid_objection_id_rewritten'));
  });

  it('normalizes empty string ID to OBJ-001', () => {
    const { root, turnId } = createProject('qa', [{
      id: '',
      severity: 'medium',
      statement: 'Test coverage gap.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].id'
      && e.payload?.rationale === 'invalid_objection_id_rewritten'));
  });

  it('normalizes wrong-case "obj-1" to OBJ-001', () => {
    const { root, turnId } = createProject('pm', [{
      id: 'obj-1',
      severity: 'low',
      statement: 'Minor observation.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.original_value === 'obj-1'));
  });

  it('does not normalize valid OBJ-001 ID', () => {
    const { root, turnId } = createProject('qa', [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'Valid objection with correct ID.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.ok(!events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].id'));
  });

  it('normalizes multiple objections with invalid IDs to sequential OBJ-001, OBJ-002', () => {
    const { root, turnId } = createProject('qa', [
      {
        id: 'OBJ-002-M31',
        severity: 'low',
        statement: 'First objection with suffixed ID.',
        status: 'raised',
      },
      {
        id: 'OBJECTION-TWO',
        severity: 'medium',
        statement: 'Second objection with completely wrong format.',
        status: 'raised',
      },
    ]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.equal(history.at(-1).objections[1].id, 'OBJ-002');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].id'));
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[1].id'));
  });

  it('normalizes null ID to OBJ-001', () => {
    const { root, turnId } = createProject('product_marketing', [{
      id: null,
      severity: 'low',
      statement: 'Null ID objection.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.original_value === null
      && e.payload?.rationale === 'invalid_objection_id_rewritten'));
  });

  it('preserves BUG-79 statement normalization alongside ID normalization', () => {
    const { root, turnId } = createProject('qa', [{
      id: 'OBJ-002-M31',
      severity: 'low',
      summary: 'Statement came as summary instead.',
      status: 'raised',
    }]);
    const { history, events } = acceptAndRead(root, turnId);

    // Both normalizations should have fired
    assert.equal(history.at(-1).objections[0].id, 'OBJ-001');
    assert.equal(history.at(-1).objections[0].statement, 'Statement came as summary instead.');
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].id'));
    assert.ok(events.some((e) => e.event_type === 'staged_result_auto_normalized'
      && e.payload?.field === 'objections[0].statement'));
  });
});
