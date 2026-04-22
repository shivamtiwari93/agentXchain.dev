/**
 * BUG-54 beta-tester scenario: realistic-bundle dispatch must not false-kill
 * on the default startup watchdog for ANY local_cli runtime shape.
 *
 * Context: the prior BUG-54 default-threshold test (`bug-54-watchdog-threshold-default.test.js`)
 * proves a synthetic ≤1KB-bundle shim that emits after 31s is not killed by the
 * new 180s default. That test does not cover realistic dispatch conditions:
 *
 *   - the tester's real tusq.dev dispatch bundle measured 17,737 bytes
 *   - Turn 137 measured first-stdout at 113,094ms on that realistic bundle
 *   - the original defect surfaced on BOTH Claude-based and Codex-based
 *     runtimes; a Claude-only regression under-covers the class
 *
 * This test exercises `writeDispatchBundle` with realistic role mandate
 * content so the produced bundle is at least as large as the observed 17,737
 * byte tusq.dev bundle, then dispatches through
 * `dispatchLocalCli` using three runtime shapes (claude-style bundle-only,
 * codex-style bundle-only, and codex-style stdin transport shims that each
 * read the bundle from disk, emit representative startup output, stage a
 * result, and exit cleanly). It asserts all runtime shapes complete with real
 * startup proof and no startup_watchdog_fired under the default threshold.
 *
 * Regression value: locks the default watchdog AND the dispatch path against
 * any future change that re-lowers the threshold or introduces bundle-size
 * sensitivity to startup proof.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { dispatchLocalCli } from '../../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const OBSERVED_TUSQ_BUNDLE_BYTES = 17_737;
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug54-realistic-'));
  tempDirs.push(dir);
  return dir;
}

function realisticMandate() {
  // Real role mandates reference architecture constraints, invariants,
  // cross-role contracts, evidence rules, etc. Pad deterministically.
  const paragraph = [
    'Plan planning-phase work using VISION.md, ROADMAP.md, and SYSTEM_SPEC.md.',
    'Respect all reserved paths. Never touch operator-owned governance state.',
    'Emit a structured turn result with acceptance_contract, charter, and',
    'evidence pointers. Challenge the previous turn before proceeding.',
    'Check dispatch-bundle baseline against current working tree. Verify that',
    'intake intent is consistent with the derived vision candidate. Do not',
    'rubber-stamp prior PM work.',
  ].join(' ');
  return Array.from({ length: 140 }, () => paragraph).join('\n\n');
}

function makeState(turnOverrides = {}) {
  const turn = {
    turn_id: 'turn_bug54_realistic',
    assigned_role: 'pm',
    status: 'running',
    attempt: 1,
    started_at: new Date().toISOString(),
    dispatched_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 120_000).toISOString(),
    runtime_id: 'local-pm',
    ...turnOverrides,
  };
  return {
    run_id: 'run_bug54_realistic',
    status: 'active',
    phase: 'planning',
    current_turn: turn,
    active_turns: { [turn.turn_id]: turn },
    accepted_integration_ref: 'git:abc123',
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
  };
}

function makeConfig(runtime) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug54-realistic', name: 'BUG-54 Realistic Bundle', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: realisticMandate(),
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-pm',
      },
    },
    runtimes: { 'local-pm': runtime },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'] } },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
  };
}

function bundleBytes(bundlePath) {
  let total = 0;
  for (const f of readdirSync(bundlePath)) {
    total += statSync(join(bundlePath, f)).size;
  }
  return total;
}

function adapterDiagnostic(logs, label) {
  const prefix = `[adapter:diag] ${label} `;
  const line = logs.find((entry) => entry.startsWith(prefix));
  assert.ok(line, `expected ${label} adapter diagnostic`);
  return JSON.parse(line.slice(prefix.length));
}

/**
 * Shim styles model the two local_cli runtime shapes the tester exercised on
 * v2.150.0: Claude (stream-json-ish stdout) and Codex (plain-text stdout).
 * Each shim reads the dispatch bundle from disk (proving realistic-bundle
 * delivery works end-to-end), emits its startup proof, stages a minimal
 * turn result, and exits 0.
 */
function claudeStyleShim(rootAbs, turnId) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const bundleDir = ${JSON.stringify(join(rootAbs, '.agentxchain', 'dispatch', 'turns', turnId))};
const promptBytes = fs.statSync(path.join(bundleDir, 'PROMPT.md')).size;
// Simulate Claude streaming first chunk.
process.stdout.write(JSON.stringify({ type: 'message_start', role: 'assistant' }) + '\\n');
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'content_block_delta', delta: { text: 'bundle=' + promptBytes } }) + '\\n');
  const staging = ${JSON.stringify(join(rootAbs, '.agentxchain', 'staging', turnId))};
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
    turn_id: '${turnId}',
    summary: 'claude-style realistic bundle ack',
    next_role: 'dev',
    files_changed: [],
    verification: { status: 'passed', commands_run: [] },
    decisions: [],
    objections: [],
  }));
  process.exit(0);
}, 400);
`;
}

function codexStyleShim(rootAbs, turnId) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const bundleDir = ${JSON.stringify(join(rootAbs, '.agentxchain', 'dispatch', 'turns', turnId))};
const promptBytes = fs.statSync(path.join(bundleDir, 'PROMPT.md')).size;
// Simulate Codex plain-text startup.
process.stdout.write('codex ready bundle=' + promptBytes + '\\n');
setTimeout(() => {
  process.stdout.write('codex done\\n');
  const staging = ${JSON.stringify(join(rootAbs, '.agentxchain', 'staging', turnId))};
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
    turn_id: '${turnId}',
    summary: 'codex-style realistic bundle ack',
    next_role: 'dev',
    files_changed: [],
    verification: { status: 'passed', commands_run: [] },
    decisions: [],
    objections: [],
  }));
  process.exit(0);
}, 400);
`;
}

function codexStdinStyleShim(rootAbs, turnId) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const bundleDir = ${JSON.stringify(join(rootAbs, '.agentxchain', 'dispatch', 'turns', turnId))};
const promptBytes = fs.statSync(path.join(bundleDir, 'PROMPT.md')).size;
let stdinBytes = 0;
process.stdin.on('data', (chunk) => { stdinBytes += chunk.length; });
process.stdin.on('end', () => {
  if (stdinBytes < ${OBSERVED_TUSQ_BUNDLE_BYTES}) {
    throw new Error('stdin prompt too small: ' + stdinBytes);
  }
  process.stdout.write('codex stdin ready bundle=' + promptBytes + ' stdin=' + stdinBytes + '\\n');
  setTimeout(() => {
    process.stdout.write('codex stdin done\\n');
    const staging = ${JSON.stringify(join(rootAbs, '.agentxchain', 'staging', turnId))};
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
      turn_id: '${turnId}',
      summary: 'codex-stdin realistic bundle ack',
      next_role: 'dev',
      files_changed: [],
      verification: { status: 'passed', commands_run: [] },
      decisions: [],
      objections: [],
    }));
    process.exit(0);
  }, 400);
});
`;
}

async function dispatchWithShim({ shimName, shimBody, promptTransport = 'dispatch_bundle_only' }) {
  const root = makeTmp();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  const scriptPath = join(root, shimName);
  const state = makeState();
  const turnId = state.current_turn.turn_id;
  writeFileSync(scriptPath, shimBody(root, turnId));
  const config = makeConfig({
    type: 'local_cli',
    command: ['node', scriptPath],
    cwd: '.',
    prompt_transport: promptTransport,
  });

  const bundleRes = writeDispatchBundle(root, state, config);
  assert.equal(bundleRes.ok, true, 'dispatch bundle must write cleanly');
  const bundleSize = bundleBytes(bundleRes.bundlePath);

  const result = await dispatchLocalCli(root, state, config);
  return { root, state, config, bundleRes, bundleSize, result };
}

describe('BUG-54 realistic-bundle dispatch watchdog', () => {
  it('produces a dispatch bundle at least as large as the observed tusq.dev bundle', async () => {
    const { bundleSize, bundleRes } = await dispatchWithShim({
      shimName: 'size-probe.js',
      shimBody: claudeStyleShim,
    });
    assert.ok(
      bundleSize >= OBSERVED_TUSQ_BUNDLE_BYTES,
      `realistic bundle must be >= ${OBSERVED_TUSQ_BUNDLE_BYTES} bytes; measured ${bundleSize} bytes at ${bundleRes.bundlePath}`,
    );
  });

  it('Claude-style local_cli shim on a realistic bundle is NOT killed by the default watchdog', { timeout: 30_000 }, async () => {
    const { result, bundleSize } = await dispatchWithShim({
      shimName: 'claude-style.js',
      shimBody: claudeStyleShim,
    });
    const log = result.logs.join('');

    assert.ok(bundleSize >= OBSERVED_TUSQ_BUNDLE_BYTES, `bundle ${bundleSize}B must be >= observed ${OBSERVED_TUSQ_BUNDLE_BYTES}B`);
    assert.equal(result.ok, true, 'realistic-bundle Claude dispatch must be recognized as completed by the adapter');
    assert.notEqual(result.startupFailure, true, 'realistic-bundle Claude dispatch must not be retained as failed_start');
    assert.match(log, /\[adapter:diag\] spawn_attached /);
    assert.match(log, /\[adapter:diag\] first_output /);
    assert.doesNotMatch(log, /\[adapter:diag\] startup_watchdog_fired /);
    assert.doesNotMatch(log, /"exit_signal":"SIGTERM"/);
  });

  it('Codex-style local_cli shim on a realistic bundle is NOT killed by the default watchdog', { timeout: 30_000 }, async () => {
    const { result, bundleSize } = await dispatchWithShim({
      shimName: 'codex-style.js',
      shimBody: codexStyleShim,
    });
    const log = result.logs.join('');

    assert.ok(bundleSize >= OBSERVED_TUSQ_BUNDLE_BYTES, `bundle ${bundleSize}B must be >= observed ${OBSERVED_TUSQ_BUNDLE_BYTES}B`);
    assert.equal(result.ok, true, 'realistic-bundle Codex dispatch must be recognized as completed by the adapter');
    assert.notEqual(result.startupFailure, true, 'realistic-bundle Codex dispatch must not be retained as failed_start');
    assert.match(log, /\[adapter:diag\] spawn_attached /);
    assert.match(log, /\[adapter:diag\] first_output /);
    assert.doesNotMatch(log, /\[adapter:diag\] startup_watchdog_fired /);
    assert.doesNotMatch(log, /"exit_signal":"SIGTERM"/);
  });

  it('Codex-style stdin local_cli shim on a realistic bundle receives the full prompt before startup proof', { timeout: 30_000 }, async () => {
    const { result, bundleSize } = await dispatchWithShim({
      shimName: 'codex-stdin-style.js',
      shimBody: codexStdinStyleShim,
      promptTransport: 'stdin',
    });
    const log = result.logs.join('');
    const spawnPrepare = adapterDiagnostic(result.logs, 'spawn_prepare');

    assert.ok(bundleSize >= OBSERVED_TUSQ_BUNDLE_BYTES, `bundle ${bundleSize}B must be >= observed ${OBSERVED_TUSQ_BUNDLE_BYTES}B`);
    assert.equal(spawnPrepare.prompt_transport, 'stdin');
    assert.ok(spawnPrepare.stdin_bytes >= OBSERVED_TUSQ_BUNDLE_BYTES, `stdin payload ${spawnPrepare.stdin_bytes}B must include realistic prompt bytes`);
    assert.equal(result.ok, true, 'realistic-bundle stdin Codex dispatch must be recognized as completed by the adapter');
    assert.notEqual(result.startupFailure, true, 'realistic-bundle stdin Codex dispatch must not be retained as failed_start');
    assert.match(log, /\[adapter:diag\] spawn_attached /);
    assert.match(log, /\[adapter:diag\] first_output /);
    assert.match(log, /codex stdin ready bundle=/);
    assert.doesNotMatch(log, /\[adapter:diag\] startup_watchdog_fired /);
    assert.doesNotMatch(log, /"exit_signal":"SIGTERM"/);
  });

  it('both shim styles successfully stage a turn result on a realistic bundle', { timeout: 30_000 }, async () => {
    const claudeRun = await dispatchWithShim({ shimName: 'claude-style.js', shimBody: claudeStyleShim });
    const codexRun = await dispatchWithShim({ shimName: 'codex-style.js', shimBody: codexStyleShim });

    for (const { root, state, bundleSize, result } of [claudeRun, codexRun]) {
      assert.ok(bundleSize >= OBSERVED_TUSQ_BUNDLE_BYTES, `bundle ${bundleSize}B must be >= observed ${OBSERVED_TUSQ_BUNDLE_BYTES}B`);
      assert.equal(result.ok, true, 'adapter must report success after reading the staged turn result');
      const stagingPath = join(root, getTurnStagingResultPath(state.current_turn.turn_id));
      const staged = JSON.parse(readFileSync(stagingPath, 'utf8'));
      assert.equal(staged.turn_id, state.current_turn.turn_id);
      assert.equal(staged.verification.status, 'passed');
    }
  });
});
