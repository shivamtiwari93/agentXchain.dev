/**
 * BUG-54 operator-facing vocabulary regression.
 *
 * Public CLI docs (website-v2/docs/cli.mdx) document exactly two operator-visible
 * startup-failure subtypes: `runtime_spawn_failed` and `stdout_attach_failed`.
 * The raw adapter signal `no_subprocess_output` is an internal classification
 * fallback and must not leak into operator-facing CLI output. Prior to the
 * Turn 83 fix, `agentxchain status` rendered the raw signal as the Reason
 * field when `failed_start_reason` was the raw value or was missing entirely.
 *
 * This test exercises the command-chain through a child-process spawn of
 * `agentxchain status` (per discipline rule #13) and asserts the operator
 * never sees `no_subprocess_output` on the Reason line.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug54-vocab', name: 'BUG-54 Vocab', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement the requested change.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: 'node', args: ['-e', 'console.log("ok")'] },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'implementation_signoff',
      },
    },
    gates: { implementation_signoff: {} },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0 },
  };
}

function createFailedStartFixture(failed_start_reason) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug54-vocab-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-54 vocab\n');
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const turnId = 'turn_bug54_vocab_fixture';
  const nowIso = new Date().toISOString();
  const state = {
    schema_version: '1.0',
    project_id: 'bug54-vocab',
    run_id: 'run_bug54_vocab_fixture',
    status: 'blocked',
    phase: 'implementation',
    turn_sequence: 1,
    last_completed_turn_id: null,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: 'dev',
        runtime_id: 'local-dev',
        attempt: 1,
        status: 'failed_start',
        assigned_at: nowIso,
        dispatched_at: nowIso,
        started_at: nowIso,
        failed_start_at: nowIso,
        failed_start_reason,
        failed_start_previous_status: 'starting',
        failed_start_threshold_ms: 30000,
        failed_start_running_ms: 45000,
        recovery_command: `agentxchain reissue-turn --turn ${turnId} --reason ghost`,
      },
    },
    blocked_on: `turn:failed_start:${turnId}`,
    blocked_reason: {
      category: 'ghost_turn',
      blocked_at: nowIso,
      turn_id: turnId,
      recovery: {
        typed_reason: 'ghost_turn',
        owner: 'human',
        recovery_action: `agentxchain reissue-turn --turn ${turnId} --reason ghost`,
        turn_retained: true,
        detail: `agentxchain reissue-turn --turn ${turnId} --reason ghost`,
      },
    },
    phase_gate_status: {},
    budget_reservations: {},
    accepted_integration_ref: null,
    delegation_queue: [],
  };
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  return { root, turnId };
}

function runStatus(root) {
  const result = spawnSync(process.execPath, [CLI_PATH, 'status'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

describe('BUG-54: status command vocabulary discipline', () => {
  it('renders the typed subtype stdout_attach_failed when failed_start_reason is the raw no_subprocess_output signal', () => {
    const { root } = createFailedStartFixture('no_subprocess_output');
    const { stdout } = runStatus(root);
    // Operator must see the typed subtype.
    assert.match(stdout, /Reason:\s+stdout_attach_failed/);
    // Operator must NOT see the raw adapter signal anywhere in the status render.
    assert.doesNotMatch(stdout, /no_subprocess_output/);
  });

  it('renders the typed subtype when failed_start_reason is missing entirely', () => {
    const { root } = createFailedStartFixture(null);
    const { stdout } = runStatus(root);
    assert.match(stdout, /Reason:\s+stdout_attach_failed/);
    assert.doesNotMatch(stdout, /no_subprocess_output/);
  });

  it('passes through runtime_spawn_failed unchanged because it is already a typed operator subtype', () => {
    const { root } = createFailedStartFixture('runtime_spawn_failed');
    const { stdout } = runStatus(root);
    assert.match(stdout, /Reason:\s+runtime_spawn_failed/);
    assert.doesNotMatch(stdout, /no_subprocess_output/);
    // Must not silently rewrite a real typed subtype.
    assert.doesNotMatch(stdout, /Reason:\s+stdout_attach_failed/);
  });

  it('passes through stdout_attach_failed unchanged because it is already a typed operator subtype', () => {
    const { root } = createFailedStartFixture('stdout_attach_failed');
    const { stdout } = runStatus(root);
    assert.match(stdout, /Reason:\s+stdout_attach_failed/);
    assert.doesNotMatch(stdout, /no_subprocess_output/);
  });
});
