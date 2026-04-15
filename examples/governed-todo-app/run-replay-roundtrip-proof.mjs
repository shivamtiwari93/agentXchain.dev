#!/usr/bin/env node

/**
 * Replay round-trip proof — governed run variant.
 *
 * Proves the full export → replay → dashboard endpoint fidelity path:
 *   1. Scaffold a governed project with local_cli mock agent
 *   2. Run `agentxchain run --auto-approve` to completion
 *   3. Run `agentxchain export --output export.json`
 *   4. Start `agentxchain replay export export.json --json --no-open`
 *   5. Hit dashboard endpoints and verify data matches the original run
 *   6. Verify replay mode constraints (gate approval blocked)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'replay-roundtrip-mock-agent.mjs');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
      ...env,
    },
  });
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'Replay Roundtrip Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'replay-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(port, path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function waitForServer(port, maxWait = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await httpGet(port, '/api/session');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `replay-roundtrip-${randomBytes(4).toString('hex')}`,
      name: 'Replay Roundtrip Proof',
      description: 'Prove export → replay → dashboard fidelity.',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement and ship.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [mockAgentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      delivery: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    phases: ['delivery'],
    gates: {},
    budget: {
      per_turn_max_usd: 1,
      per_run_max_usd: 5,
    },
    rules: {
      challenge_required: false,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function scaffoldProject(root) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), makeConfig());
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'replay-roundtrip',
    status: 'idle',
    phase: 'delivery',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  });
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'src', 'mock.js'), 'export const ok = true;\n');
  writeFileSync(join(root, 'TALK.md'), '# Replay Roundtrip Proof\n');
  gitInit(root);
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'replay-roundtrip-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result,
    artifacts,
    traces,
    errors,
  };
}

function printPayload(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.log(`Replay Roundtrip Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run ID:     ${payload.artifacts?.run_id || 'n/a'}`);
    console.log(`  Checks:     ${payload.artifacts?.checks_passed || 0} passed`);
    console.log('  Result:     PASS — export → replay → dashboard round-trip verified');
  } else {
    console.log('  Result:     FAIL');
    for (const error of payload.errors) {
      console.log(`  Error:      ${error}`);
    }
  }
}

async function main() {
  const root = join(tmpdir(), `axc-replay-roundtrip-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  const errors = [];
  const traces = [];
  let replayProc = null;
  const port = 30000 + Math.floor(Math.random() * 10000);

  try {
    // ── Step 1: Scaffold and run governed flow ──────────────────────────────
    scaffoldProject(root);
    traces.push({ step: 'scaffold_complete' });

    const run1 = runCli(root, ['run', '--auto-approve']);
    if (run1.status !== 0) {
      throw new Error(`governed run failed:\n${run1.stdout}\n${run1.stderr}`);
    }

    const stateAfterRun = readJson(join(root, '.agentxchain', 'state.json'));
    if (stateAfterRun.status !== 'completed') {
      throw new Error(`run expected status completed, got ${stateAfterRun.status}`);
    }
    traces.push({ step: 'run_complete', run_id: stateAfterRun.run_id });

    // ── Step 2: Export ──────────────────────────────────────────────────────
    const exportPath = join(root, 'export.json');
    const exportResult = runCli(root, ['export', '--output', 'export.json']);
    if (exportResult.status !== 0) {
      throw new Error(`export failed:\n${exportResult.stdout}\n${exportResult.stderr}`);
    }
    if (!existsSync(exportPath)) {
      throw new Error('export.json not created');
    }

    const exportData = readJson(exportPath);
    if (exportData.export_kind !== 'agentxchain_run_export') {
      throw new Error(`unexpected export_kind: ${exportData.export_kind}`);
    }
    traces.push({ step: 'export_complete', export_kind: exportData.export_kind, run_id: exportData.summary?.run_id });

    // ── Step 3: Replay ──────────────────────────────────────────────────────
    replayProc = spawn(process.execPath, [binPath, 'replay', 'export', exportPath, '--port', String(port), '--json', '--no-open'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });

    const ready = await waitForServer(port);
    if (!ready) {
      throw new Error('replay server did not start within 8s');
    }
    traces.push({ step: 'replay_server_started', port });

    // ── Step 4: Verify dashboard endpoints ──────────────────────────────────
    let checksPassed = 0;

    // Check 1: /api/session shows replay_mode
    const session = await httpGet(port, '/api/session');
    const sessionData = JSON.parse(session.body);
    if (!sessionData.replay_mode) {
      errors.push('session.replay_mode expected true');
    } else {
      checksPassed++;
    }
    if (sessionData.capabilities?.approve_gate !== false) {
      errors.push('session.capabilities.approve_gate expected false');
    } else {
      checksPassed++;
    }

    // Check 2: /api/state matches run state
    const stateResp = await httpGet(port, '/api/state');
    const stateData = JSON.parse(stateResp.body);
    if (stateData.run_id !== stateAfterRun.run_id) {
      errors.push(`state.run_id mismatch: ${stateData.run_id} vs ${stateAfterRun.run_id}`);
    } else {
      checksPassed++;
    }
    if (stateData.status !== 'completed') {
      errors.push(`state.status expected completed, got ${stateData.status}`);
    } else {
      checksPassed++;
    }

    // Check 3: /api/history has at least one turn
    const historyResp = await httpGet(port, '/api/history');
    const historyData = JSON.parse(historyResp.body);
    if (!Array.isArray(historyData) || historyData.length === 0) {
      errors.push('history expected at least one turn entry');
    } else {
      checksPassed++;
    }

    // Check 4: /api/events has ordered events
    const eventsResp = await httpGet(port, '/api/events');
    const eventsData = JSON.parse(eventsResp.body);
    if (!Array.isArray(eventsData) || eventsData.length < 2) {
      errors.push(`events expected >= 2 entries, got ${Array.isArray(eventsData) ? eventsData.length : 'non-array'}`);
    } else {
      const firstType = eventsData[0].event_type;
      const lastType = eventsData[eventsData.length - 1].event_type;
      if (firstType !== 'run_started') {
        errors.push(`first event expected run_started, got ${firstType}`);
      } else {
        checksPassed++;
      }
      if (lastType !== 'run_completed') {
        errors.push(`last event expected run_completed, got ${lastType}`);
      } else {
        checksPassed++;
      }
    }

    // Check 5: /api/events run_id matches
    if (Array.isArray(eventsData) && eventsData.length > 0) {
      const eventRunId = eventsData[0].run_id;
      if (eventRunId !== stateAfterRun.run_id) {
        errors.push(`events run_id mismatch: ${eventRunId} vs ${stateAfterRun.run_id}`);
      } else {
        checksPassed++;
      }
    }

    // Check 6: Gate approval is blocked in replay mode
    const gateResp = await httpPost(port, '/api/actions/approve-gate', { gate_id: 'test' });
    if (gateResp.status !== 403) {
      errors.push(`gate approval expected 403, got ${gateResp.status}`);
    } else {
      const gateBody = JSON.parse(gateResp.body);
      if (gateBody.code !== 'replay_mode') {
        errors.push(`gate rejection code expected replay_mode, got ${gateBody.code}`);
      } else {
        checksPassed++;
      }
    }

    // Check 7: Export run_id matches state run_id
    if (exportData.summary?.run_id !== stateAfterRun.run_id) {
      errors.push(`export summary run_id mismatch: ${exportData.summary?.run_id} vs ${stateAfterRun.run_id}`);
    } else {
      checksPassed++;
    }

    traces.push({ step: 'verification_complete', checks_passed: checksPassed, errors: errors.length });

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        run_id: stateAfterRun.run_id,
        export_run_id: exportData.summary?.run_id,
        checks_passed: checksPassed,
        events_count: Array.isArray(eventsData) ? eventsData.length : 0,
        history_count: Array.isArray(historyData) ? historyData.length : 0,
      },
    });
    printPayload(payload);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch (error) {
    const payload = buildPayload({
      result: 'fail',
      errors: [error.message],
      traces,
      artifacts: null,
    });
    printPayload(payload);
    process.exitCode = 1;
  } finally {
    if (replayProc && !replayProc.killed) {
      replayProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      if (!replayProc.killed) replayProc.kill('SIGKILL');
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main();
