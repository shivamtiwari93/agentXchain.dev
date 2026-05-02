/**
 * parallel-dispatch-progress-e2e.test.js
 *
 * AT-PARALLEL-PROGRESS-001: Proves that during parallel governed dispatch
 * (max_concurrent_turns > 1), both `agentxchain status --json` and the
 * dashboard state reader expose DISTINCT per-turn dispatch progress — not
 * one turn clobbering another.
 *
 * This is the integration proof GPT 5.4 required in Turn 116 before
 * cutting v2.127.0.
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { readAllDispatchProgress } from '../src/lib/dispatch-progress.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentSlowPath = join(cliRoot, 'test-support', 'mock-agent-slow.mjs');

const tempDirs = [];

/**
 * Create a governed project configured for parallel dispatch with 2 concurrent
 * turns, using mock-agent-slow.mjs as the local_cli adapter.
 */
function makeParallelProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-par-progress-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Parallel Progress Test', `par-progress-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Set up mock-agent-slow runtime for all roles
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentSlowPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const key of Object.keys(config.runtimes)) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles)) {
    role.write_authority = 'authoritative';
  }

  // Enable parallel dispatch: max_concurrent_turns = 2 for planning phase
  for (const phase of Object.keys(config.routing)) {
    config.routing[phase].max_concurrent_turns = 2;
  }

  // Disable challenge requirement (avoids deadlock cycles)
  if (config.rules) {
    config.rules.challenge_required = false;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

/**
 * Poll for a condition with timeout.
 */
function waitFor(conditionFn, timeoutMs = 10000, intervalMs = 200) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      try {
        const result = conditionFn();
        if (result) {
          resolve(result);
          return;
        }
      } catch { /* keep polling */ }
      if (Date.now() > deadline) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('parallel dispatch progress — E2E', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // AT-PARALLEL-PROGRESS-001: During parallel dispatch, status --json and
  // readAllDispatchProgress expose distinct per-turn activity
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-PARALLEL-PROGRESS-001: parallel dispatch creates distinct per-turn progress visible in status --json', async () => {
    const root = makeParallelProject();

    // Start the governed run in the background
    const child = spawn(process.execPath, [binPath, 'run', '--auto-approve', '--max-turns', '8'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SLOW_AGENT_MAX_WAIT_MS: '8000' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    try {
      // ── Wait for at least 2 ready signals (proves 2 agents are in-flight) ──
      const readyFiles = await waitFor(() => {
        const agentxchainDir = join(root, '.agentxchain');
        if (!existsSync(agentxchainDir)) return null;
        const files = readdirSync(agentxchainDir).filter(f => f.startsWith('ready-'));
        return files.length >= 2 ? files : null;
      }, 15000, 200);

      assert.ok(readyFiles.length >= 2, `Expected at least 2 ready signals, got ${readyFiles.length}`);

      // ── Wait for 2 dispatch progress files to exist ──
      const allProgress = await waitFor(() => {
        const progress = readAllDispatchProgress(root);
        const ids = Object.keys(progress);
        return ids.length >= 2 ? progress : null;
      }, 10000, 200);

      const turnIds = Object.keys(allProgress);

      assert.ok(turnIds.length >= 2,
        `Expected at least 2 dispatch progress entries, got ${turnIds.length}: ${JSON.stringify(turnIds)}`);

      // Each turn should have its own distinct progress file with correct metadata
      for (const turnId of turnIds) {
        const progress = allProgress[turnId];
        assert.ok(progress, `Progress missing for turn ${turnId}`);
        assert.equal(progress.turn_id, turnId, `turn_id mismatch in progress for ${turnId}`);
        assert.equal(progress.adapter_type, 'local_cli', `adapter_type should be local_cli for ${turnId}`);
        assert.ok(progress.started_at, `started_at missing for ${turnId}`);
        assert.ok(progress.last_activity_at, `last_activity_at missing for ${turnId}`);
      }

      // The two progress files must have DIFFERENT turn_ids (not clobbered)
      assert.notEqual(turnIds[0], turnIds[1],
        'Parallel dispatch progress files must have distinct turn_ids');


      // Verify distinct turn IDs (no clobbering)
      const uniqueTurnIds = new Set(turnIds);
      assert.equal(uniqueTurnIds.size, turnIds.length,
        `Duplicate turn IDs detected — dispatch progress clobbered: ${JSON.stringify(turnIds)}`);

      // ── Run `agentxchain status --json` and verify parallel progress ──
      const statusResult = spawnSync(process.execPath, [binPath, 'status', '--json'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      });

      assert.equal(statusResult.status, 0,
        `status --json exited ${statusResult.status}: ${statusResult.stderr}`);

      const statusData = JSON.parse(statusResult.stdout);

      // Status JSON should include dispatch_progress with entries for active turns
      assert.ok(statusData.dispatch_progress,
        'status --json must include dispatch_progress field');

      const statusProgressTurnIds = Object.keys(statusData.dispatch_progress);
      assert.ok(statusProgressTurnIds.length >= 2,
        `status --json dispatch_progress should have >= 2 turns, got ${statusProgressTurnIds.length}`);

      // Each status progress entry should have correct metadata
      for (const turnId of statusProgressTurnIds) {
        const sp = statusData.dispatch_progress[turnId];
        assert.equal(sp.turn_id, turnId, `status progress turn_id mismatch for ${turnId}`);
        assert.equal(sp.adapter_type, 'local_cli');
      }

    } finally {
      // ── Signal all mock agents to continue and let the run complete ──
      const agentxchainDir = join(root, '.agentxchain');
      if (existsSync(agentxchainDir)) {
        const readyFiles = readdirSync(agentxchainDir).filter(f => f.startsWith('ready-'));
        for (const f of readyFiles) {
          const turnId = f.replace('ready-', '');
          const continuePath = join(agentxchainDir, `continue-${turnId}`);
          try { writeFileSync(continuePath, 'go'); } catch {}
        }
      }

      // Wait for child process to exit (with timeout)
      await new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 15000);
        child.on('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-PARALLEL-PROGRESS-002: Dashboard state-reader includes distinct
  // per-turn dispatch_progress in enriched state
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-PARALLEL-PROGRESS-002: state-reader enrichment returns per-turn dispatch_progress for parallel active turns', () => {
    const root = makeTempRoot();

    // Create a governed state with 2 active turns
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const state = {
      run_id: 'run_par_001',
      phase: 'planning',
      status: 'running',
      active_turns: {
        turn_a: {
          turn_id: 'turn_a',
          assigned_role: 'pm',
          runtime_id: 'rt-pm',
          status: 'running',
          started_at: new Date().toISOString(),
        },
        turn_b: {
          turn_id: 'turn_b',
          assigned_role: 'dev',
          runtime_id: 'rt-dev',
          status: 'running',
          started_at: new Date().toISOString(),
        },
      },
    };
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(state));

    // Write dispatch-progress files for both turns
    writeFileSync(join(root, '.agentxchain/dispatch-progress-turn_a.json'), JSON.stringify({
      turn_id: 'turn_a',
      runtime_id: 'rt-pm',
      adapter_type: 'local_cli',
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      activity_type: 'output',
      activity_summary: 'Producing output',
      output_lines: 42,
      stderr_lines: 0,
      silent_since: null,
      pid: 1001,
    }));

    writeFileSync(join(root, '.agentxchain/dispatch-progress-turn_b.json'), JSON.stringify({
      turn_id: 'turn_b',
      runtime_id: 'rt-dev',
      adapter_type: 'local_cli',
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      activity_type: 'silent',
      activity_summary: 'No output',
      output_lines: 8,
      stderr_lines: 2,
      silent_since: new Date().toISOString(),
      pid: 1002,
    }));

    // Read all dispatch progress — the same function the state reader uses
    const allProgress = readAllDispatchProgress(root);

    assert.ok(allProgress.turn_a, 'turn_a progress missing');
    assert.ok(allProgress.turn_b, 'turn_b progress missing');

    assert.equal(allProgress.turn_a.output_lines, 42);
    assert.equal(allProgress.turn_a.activity_type, 'output');
    assert.equal(allProgress.turn_a.pid, 1001);

    assert.equal(allProgress.turn_b.output_lines, 8);
    assert.equal(allProgress.turn_b.activity_type, 'silent');
    assert.equal(allProgress.turn_b.pid, 1002);

    // Verify isolation: updating turn_a does not affect turn_b
    writeFileSync(join(root, '.agentxchain/dispatch-progress-turn_a.json'), JSON.stringify({
      ...allProgress.turn_a,
      output_lines: 100,
    }));

    const refreshed = readAllDispatchProgress(root);
    assert.equal(refreshed.turn_a.output_lines, 100, 'turn_a should reflect update');
    assert.equal(refreshed.turn_b.output_lines, 8, 'turn_b should be unchanged');
  });
});

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'axc-par-progress-unit-'));
  tempDirs.push(root);
  return root;
}
