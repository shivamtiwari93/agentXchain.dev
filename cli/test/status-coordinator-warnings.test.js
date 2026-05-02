import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeGovernedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-status-coord-warn-'));
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'test', name: 'Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', 'test'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['human'] },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    run_id: 'run-test',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    accepted_count: 1,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
  });

  return root;
}

function appendEvent(root, event) {
  appendFileSync(
    join(root, '.agentxchain/events.jsonl'),
    JSON.stringify(event) + '\n',
  );
}

function runStatusJson(root) {
  const result = spawnSync(process.execPath, [CLI_BIN, 'status', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`status --json failed (exit ${result.status}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('status command — coordinator projection warnings', () => {
  it('AT-STATUS-COORD-WARN-001: JSON output includes coordinator_warnings with count 0 when no warnings exist', () => {
    const root = makeGovernedWorkspace();
    const output = runStatusJson(root);
    assert.ok(output.coordinator_warnings, 'coordinator_warnings field must exist');
    assert.equal(output.coordinator_warnings.count, 0);
    assert.equal(output.coordinator_warnings.reconciliation_required, false);
    assert.deepStrictEqual(output.coordinator_warnings.warnings, []);
  });

  it('AT-STATUS-COORD-WARN-002: JSON output surfaces coordinator_retry_projection_warning events with correct payload', () => {
    const root = makeGovernedWorkspace();
    appendEvent(root, {
      event_id: 'evt_test001',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'run-test',
      phase: 'implementation',
      status: 'active',
      turn: null,
      intent_id: null,
      payload: {
        workstream_id: 'ws-alpha',
        repo_id: 'repo-a',
        reissued_turn_id: 'turn-retry-001',
        warning_code: 'coordinator_acceptance_projection_incomplete',
        warning_message: 'Projection failed after successful retry',
      },
    });
    const output = runStatusJson(root);
    assert.equal(output.coordinator_warnings.count, 1);
    assert.equal(output.coordinator_warnings.reconciliation_required, true);
    assert.equal(output.coordinator_warnings.warnings.length, 1);
    const w = output.coordinator_warnings.warnings[0];
    assert.equal(w.workstream_id, 'ws-alpha');
    assert.equal(w.repo_id, 'repo-a');
    assert.equal(w.warning_code, 'coordinator_acceptance_projection_incomplete');
  });

  it('AT-STATUS-COORD-WARN-003: multiple warnings are all surfaced', () => {
    const root = makeGovernedWorkspace();
    appendEvent(root, {
      event_id: 'evt_test002',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'run-test',
      payload: { workstream_id: 'ws-1', repo_id: 'r1', warning_code: 'coordinator_acceptance_projection_incomplete' },
    });
    appendEvent(root, {
      event_id: 'evt_test003',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'run-test',
      payload: { workstream_id: 'ws-2', repo_id: 'r2', warning_code: 'coordinator_acceptance_projection_incomplete' },
    });
    // Also append a non-warning event to prove filtering works
    appendEvent(root, {
      event_id: 'evt_test004',
      event_type: 'turn_dispatched',
      timestamp: new Date().toISOString(),
      payload: {},
    });
    const output = runStatusJson(root);
    assert.equal(output.coordinator_warnings.count, 2);
    assert.equal(output.coordinator_warnings.reconciliation_required, true);
    assert.equal(output.coordinator_warnings.warnings[0].workstream_id, 'ws-1');
    assert.equal(output.coordinator_warnings.warnings[1].workstream_id, 'ws-2');
  });

  it('AT-STATUS-COORD-WARN-004: JSON output ignores projection warnings from prior runs', () => {
    const root = makeGovernedWorkspace();
    appendEvent(root, {
      event_id: 'evt_old_run',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'run-old',
      payload: {
        workstream_id: 'ws-old',
        repo_id: 'repo-old',
        warning_code: 'coordinator_acceptance_projection_incomplete',
      },
    });
    appendEvent(root, {
      event_id: 'evt_current_run',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'run-test',
      payload: {
        workstream_id: 'ws-current',
        repo_id: 'repo-current',
        reissued_turn_id: 'turn-current',
        warning_code: 'coordinator_acceptance_projection_incomplete',
        warning_message: 'Projection incomplete for current run',
      },
    });

    const output = runStatusJson(root);
    assert.equal(output.coordinator_warnings.count, 1);
    assert.equal(output.coordinator_warnings.warnings[0].workstream_id, 'ws-current');
    assert.equal(output.coordinator_warnings.warnings[0].repo_id, 'repo-current');
    assert.equal(output.coordinator_warnings.warnings[0].reissued_turn_id, 'turn-current');
    assert.equal(output.coordinator_warnings.warnings[0].warning_message, 'Projection incomplete for current run');
  });
});
