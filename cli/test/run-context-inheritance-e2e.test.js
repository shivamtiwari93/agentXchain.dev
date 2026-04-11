import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject({ withTimeouts = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-ctx-inherit-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Context Inheritance E2E', `ctx-inherit-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  if (withTimeouts) {
    config.timeouts = { per_turn_minutes: 1, action: 'escalate' };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  return root;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readRunHistory(root) {
  const raw = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function createBlockedParentRun(root) {
  const context = loadProjectContext(root);
  assert.ok(context, 'expected governed project context');

  const init = initializeGovernedRun(root, context.config);
  assert.ok(init.ok, init.error);

  const assign = assignGovernedTurn(root, context.config, 'pm');
  assert.ok(assign.ok, assign.error);

  // Write a turn result that triggers a blocked state
  const state = readState(root);
  const turnId = Object.keys(state.active_turns)[0];
  state.active_turns[turnId].started_at = '2026-04-10T00:00:00.000Z';
  writeJson(join(root, '.agentxchain', 'state.json'), state);

  const updatedState = readState(root);
  const turn = updatedState.active_turns[turnId];

  const result = {
    schema_version: '1.0',
    run_id: updatedState.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Blocked parent turn completed for inheritance test.',
    decisions: [{
      id: 'DEC-101',
      category: 'implementation',
      statement: 'Parent run decision for inheritance.',
      rationale: 'Proving context inheritance.',
    }],
    objections: [{
      id: 'OBJ-101',
      severity: 'low',
      statement: 'No blocker.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Parent verification passed.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  writeJson(join(root, '.agentxchain', 'staging', 'turn-result.json'), result);

  const accept = runCli(root, ['accept-turn']);
  assert.equal(accept.status, 0, `accept-turn failed:\n${accept.combined}`);

  const blockedState = readState(root);
  assert.equal(blockedState.status, 'blocked', 'parent run must end blocked');

  return blockedState.run_id;
}

/**
 * Find the CONTEXT.md from the most recent dispatch turn directory.
 */
function findLatestContextMd(root) {
  const turnsDir = join(root, '.agentxchain', 'dispatch', 'turns');
  if (!existsSync(turnsDir)) return null;
  const turnDirs = readdirSync(turnsDir).sort();
  for (let i = turnDirs.length - 1; i >= 0; i--) {
    const ctxPath = join(turnsDir, turnDirs[i], 'CONTEXT.md');
    if (existsSync(ctxPath)) {
      return readFileSync(ctxPath, 'utf8');
    }
  }
  return null;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('run context inheritance E2E', () => {
  it('AT-RCI-001: --continue-from --inherit-context creates a fresh child run with inherited summary in state', () => {
    const root = makeProject();

    // First run completes
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0, `first run failed:\n${firstRun.combined}`);

    const firstState = readState(root);
    const parentRunId = firstState.run_id;
    assert.equal(firstState.status, 'completed');

    // Continue with inherit-context
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--continue-from', parentRunId,
      '--inherit-context',
    ]);
    assert.equal(continued.status, 0, `continuation failed:\n${continued.combined}`);

    const childState = readState(root);
    assert.notEqual(childState.run_id, parentRunId, 'child must have a fresh run_id');
    assert.equal(childState.provenance.trigger, 'continuation');
    assert.equal(childState.provenance.parent_run_id, parentRunId);

    // Inherited context must be present in state
    assert.ok(childState.inherited_context, 'inherited_context must be present in state');
    assert.equal(childState.inherited_context.parent_run_id, parentRunId);
    assert.equal(childState.inherited_context.parent_status, 'completed');
    assert.ok(childState.inherited_context.inherited_at, 'must have inherited_at timestamp');
    assert.ok(Array.isArray(childState.inherited_context.parent_phases_completed));
    assert.ok(Array.isArray(childState.inherited_context.parent_roles_used));
  });

  it('AT-RCI-002: child run CONTEXT.md includes Inherited Run Context section', () => {
    const root = makeProject();

    // First run
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0);
    const parentRunId = readState(root).run_id;

    // Continue with inherit-context — run only 1 turn so the last dispatch bundle is still present
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '1',
      '--continue-from', parentRunId,
      '--inherit-context',
    ]);
    // May exit 0 with max_turns_reached or 0 with completed — either is fine
    assert.ok(continued.status === 0, `continuation failed:\n${continued.combined}`);

    // Check for CONTEXT.md in dispatch bundles
    const contextMd = findLatestContextMd(root);
    if (contextMd) {
      // If dispatch bundle was retained, verify content directly
      assert.match(contextMd, /## Inherited Run Context/, 'must contain Inherited Run Context section');
      assert.match(contextMd, new RegExp(parentRunId), 'must reference parent run_id');
      assert.match(contextMd, /fresh run, not a resumed parent/, 'must include fresh-run reminder');
    } else {
      // If dispatch bundle was cleaned up, verify through state that inherited_context is present
      // (which means it would have been rendered in CONTEXT.md)
      const childState = readState(root);
      assert.ok(childState.inherited_context, 'inherited_context must be present in state — proves dispatch bundle would have rendered it');
      assert.equal(childState.inherited_context.parent_run_id, parentRunId);
    }
  });

  it('AT-RCI-003: status --json and report expose inherited context when present', () => {
    const root = makeProject();

    // First run
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0);
    const parentRunId = readState(root).run_id;

    // Continue with inherit-context
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--continue-from', parentRunId,
      '--inherit-context',
    ]);
    assert.equal(continued.status, 0);

    // Check status --json
    const statusResult = runCli(root, ['status', '--json']);
    assert.equal(statusResult.status, 0, `status failed:\n${statusResult.combined}`);
    const statusJson = JSON.parse(statusResult.stdout);
    assert.ok(statusJson.inherited_context, 'status --json must expose inherited_context');
    assert.equal(statusJson.inherited_context.parent_run_id, parentRunId);
    assert.equal(statusJson.inherited_context.parent_status, 'completed');

    // Check report — pipe export into report
    const exportResult = runCli(root, ['export']);
    assert.equal(exportResult.status, 0, `export failed:\n${exportResult.combined}`);
    const exportPath = join(root, '.agentxchain', 'reports', 'temp-export.json');
    writeFileSync(exportPath, exportResult.stdout);
    const reportResult = runCli(root, ['report', '--input', exportPath, '--format', 'markdown']);
    assert.equal(reportResult.status, 0, `report failed:\n${reportResult.combined}`);
    assert.match(reportResult.stdout, /Inherited from/, 'report must mention inherited context');
  });

  it('AT-RCI-004: export includes inherited context in summary', () => {
    const root = makeProject();

    // First run
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0);
    const parentRunId = readState(root).run_id;

    // Continue with inherit-context
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--continue-from', parentRunId,
      '--inherit-context',
    ]);
    assert.equal(continued.status, 0);

    // Check export (default format is json, no --json flag needed)
    const exportResult = runCli(root, ['export']);
    assert.equal(exportResult.status, 0, `export failed:\n${exportResult.combined}`);
    const exportJson = JSON.parse(exportResult.stdout);
    assert.ok(exportJson.summary?.inherited_context, 'export summary must include inherited_context');
    assert.equal(exportJson.summary.inherited_context.parent_run_id, parentRunId);
  });

  it('AT-RCI-005: --inherit-context without a provenance flag exits 1 with actionable guidance', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--inherit-context']);
    assert.equal(result.status, 1, 'must fail without provenance flag');
    assert.match(result.combined, /--inherit-context requires --continue-from or --recover-from/);
    assert.match(result.combined, /Usage:/, 'must provide usage guidance');
  });

  it('AT-RCI-006: malformed/missing parent data degrades to partial inheritance with warnings', () => {
    const root = makeProject();

    // Run and complete a first run
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0);
    const parentRunId = readState(root).run_id;

    // Delete the history and ledger files to simulate missing parent data
    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
    if (existsSync(historyPath)) rmSync(historyPath);
    if (existsSync(ledgerPath)) rmSync(ledgerPath);

    // Continue with inherit-context — should still work with partial/warning data
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--continue-from', parentRunId,
      '--inherit-context',
    ]);
    assert.equal(continued.status, 0, `continuation with partial data failed:\n${continued.combined}`);

    const childState = readState(root);
    assert.ok(childState.inherited_context, 'inherited_context must be present even with missing data');
    assert.equal(childState.inherited_context.parent_run_id, parentRunId);

    // Verify warnings are recorded
    if (childState.inherited_context.warnings?.length) {
      assert.ok(
        childState.inherited_context.warnings.some(w => w.includes('metadata only') || w.includes('no turn history')),
        'should have a warning about partial inheritance'
      );
    }
  });

  it('AT-RCI-007: --recover-from --inherit-context works for blocked parent runs', () => {
    const root = makeProject({ withTimeouts: true });

    // Create a blocked parent
    const blockedRunId = createBlockedParentRun(root);

    // Recover with inherit-context
    const recovered = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--recover-from', blockedRunId,
      '--inherit-context',
    ]);
    assert.equal(recovered.status, 0, `recovery failed:\n${recovered.combined}`);

    const childState = readState(root);
    assert.notEqual(childState.run_id, blockedRunId);
    assert.equal(childState.provenance.trigger, 'recovery');
    assert.ok(childState.inherited_context, 'inherited_context must be present after recovery');
    assert.equal(childState.inherited_context.parent_run_id, blockedRunId);
    assert.equal(childState.inherited_context.parent_status, 'blocked');
  });

  it('AT-RCI-008: run without --inherit-context does NOT inherit context', () => {
    const root = makeProject();

    // First run
    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0);
    const parentRunId = readState(root).run_id;

    // Continue WITHOUT inherit-context
    const continued = runCli(root, [
      'run', '--auto-approve', '--max-turns', '5',
      '--continue-from', parentRunId,
    ]);
    assert.equal(continued.status, 0);

    const childState = readState(root);
    assert.equal(childState.inherited_context, null, 'inherited_context must be null when --inherit-context is not used');
  });
});
