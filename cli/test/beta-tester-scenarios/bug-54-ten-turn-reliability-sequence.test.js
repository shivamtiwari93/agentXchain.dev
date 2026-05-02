/**
 * BUG-54 beta-tester scenario: 10-consecutive-turn local_cli reliability
 * sequence spanning PM / dev / QA roles on realistic-bundle payloads.
 *
 * Covers HUMAN-ROADMAP BUG-54 fix requirement #4 (verbatim):
 *   "Add tester-sequence test that dispatches 10 consecutive `local_cli`
 *    turns (PM, dev, and QA) and asserts ≥9 complete successfully.
 *    Current single-turn tests don't catch this reliability class."
 *
 * And historical acceptance text (still preserved on the roadmap):
 *   "10 consecutive PM/dev/QA `local_cli` dispatches succeed at >90% rate,
 *    not <20%."
 *
 * Complements the existing BUG-54 test surface:
 *   - bug-54-realistic-bundle-watchdog.test.js   — single-dispatch realistic
 *     bundle across three shim shapes
 *   - bug-54-repeated-dispatch-reliability.test.js — 10x FAILING dispatches
 *     to prove deterministic classification + no handle leak
 *   - (this file)                                 — 10x SUCCESSFUL dispatches
 *     across PM / dev / QA, realistic bundle, rotating runtime shapes, asserting
 *     zero `stdout_attach_failed`, zero `startup_watchdog_fired`, and ≥90%
 *     success rate end-to-end (adapter success + staged turn result written)
 *
 * Test-only: no product-code changes. Scope is to lock the positive reliability
 * invariant that the BUG-54 roadmap demands, so a future adapter regression
 * that silently fails even 2/10 real turns fails CI before it reaches a
 * tester.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { dispatchLocalCli } from '../../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const OBSERVED_TUSQ_BUNDLE_BYTES = 17_737;
const ITER = 10;
const MIN_SUCCESSES = 9; // ≥90% per roadmap acceptance

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug54-tenturn-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Realistic mandate matching the size profile observed in tusq.dev bundles —
 * see bug-54-realistic-bundle-watchdog.test.js for the same pattern. Duplicated
 * locally (rather than extracted to a shared helper) per WAYS-OF-WORKING rule
 * about premature abstraction: two call sites is not enough to extract.
 */
function realisticMandate(roleTitle) {
  const paragraph = [
    `${roleTitle} role must plan work using VISION.md, ROADMAP.md, and SYSTEM_SPEC.md.`,
    'Respect all reserved paths. Never touch operator-owned governance state.',
    'Emit a structured turn result with acceptance_contract, charter, and',
    'evidence pointers. Challenge the previous turn before proceeding.',
    'Check dispatch-bundle baseline against current working tree. Verify that',
    'intake intent is consistent with the derived vision candidate. Do not',
    'rubber-stamp prior work.',
  ].join(' ');
  return Array.from({ length: 140 }, () => paragraph).join('\n\n');
}

function makeState({ turnId, role, phase }) {
  const turn = {
    turn_id: turnId,
    assigned_role: role,
    status: 'running',
    attempt: 1,
    started_at: new Date().toISOString(),
    dispatched_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 120_000).toISOString(),
    runtime_id: `local-${role}`,
  };
  return {
    run_id: 'run_bug54_tenturn',
    status: 'active',
    phase,
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

function makeConfig({ role, runtime }) {
  const roleDefs = {
    pm: { title: 'PM', nextRoles: ['pm', 'dev', 'human'] },
    dev: { title: 'Developer', nextRoles: ['dev', 'qa', 'human'] },
    qa: { title: 'QA', nextRoles: ['qa', 'launch', 'human'] },
  };
  const def = roleDefs[role];
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug54-tenturn', name: 'BUG-54 Ten-Turn Reliability', default_branch: 'main' },
    roles: {
      [role]: {
        title: def.title,
        mandate: realisticMandate(def.title),
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: `local-${role}`,
      },
    },
    runtimes: { [`local-${role}`]: runtime },
    routing: { [role === 'pm' ? 'planning' : role]: { entry_role: role, allowed_next_roles: def.nextRoles } },
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

/**
 * Three shim shapes, rotated across iterations so the sequence test proves the
 * reliability invariant is runtime-class-general rather than Claude-specific.
 * Each shim: reads PROMPT.md from the bundle (proving realistic delivery),
 * emits startup proof, stages a turn result, exits 0.
 */
function stagingTurnDir(rootAbs, turnId) {
  return join(rootAbs, '.agentxchain', 'staging', turnId);
}

function claudeStyleShimSrc(rootAbs, turnId, nextRole) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const bundleDir = ${JSON.stringify(join(rootAbs, '.agentxchain', 'dispatch', 'turns', turnId))};
const promptBytes = fs.statSync(path.join(bundleDir, 'PROMPT.md')).size;
process.stdout.write(JSON.stringify({ type: 'message_start', role: 'assistant' }) + '\\n');
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'content_block_delta', delta: { text: 'bundle=' + promptBytes } }) + '\\n');
  const staging = ${JSON.stringify(stagingTurnDir(rootAbs, turnId))};
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
    turn_id: '${turnId}',
    summary: 'claude-style ten-turn iteration ack',
    next_role: '${nextRole}',
    files_changed: [],
    verification: { status: 'passed', commands_run: [] },
    decisions: [],
    objections: [],
  }));
  process.exit(0);
}, 100);
`;
}

function codexStyleShimSrc(rootAbs, turnId, nextRole) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const bundleDir = ${JSON.stringify(join(rootAbs, '.agentxchain', 'dispatch', 'turns', turnId))};
const promptBytes = fs.statSync(path.join(bundleDir, 'PROMPT.md')).size;
process.stdout.write('codex ready bundle=' + promptBytes + '\\n');
setTimeout(() => {
  process.stdout.write('codex done\\n');
  const staging = ${JSON.stringify(stagingTurnDir(rootAbs, turnId))};
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
    turn_id: '${turnId}',
    summary: 'codex-style ten-turn iteration ack',
    next_role: '${nextRole}',
    files_changed: [],
    verification: { status: 'passed', commands_run: [] },
    decisions: [],
    objections: [],
  }));
  process.exit(0);
}, 100);
`;
}

function codexStdinShimSrc(rootAbs, turnId, nextRole) {
  return `
const fs = require('node:fs');
const path = require('node:path');
let stdinBytes = 0;
process.stdin.on('data', (chunk) => { stdinBytes += chunk.length; });
process.stdin.on('end', () => {
  process.stdout.write('codex stdin ready stdin=' + stdinBytes + '\\n');
  setTimeout(() => {
    process.stdout.write('codex stdin done\\n');
    const staging = ${JSON.stringify(stagingTurnDir(rootAbs, turnId))};
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'turn-result.json'), JSON.stringify({
      turn_id: '${turnId}',
      summary: 'codex-stdin ten-turn iteration ack',
      next_role: '${nextRole}',
      files_changed: [],
      verification: { status: 'passed', commands_run: [] },
      decisions: [],
      objections: [],
    }));
    process.exit(0);
  }, 100);
});
`;
}

/**
 * Round-robin role/shim schedule for the 10 iterations. Roles cycle PM → dev →
 * QA → PM → ... so every role gets at least 3 turns; shim shapes cycle Claude
 * → Codex-bundle → Codex-stdin so every transport+output style gets at least 3
 * turns. Schedule is deterministic (no randomness) so a failure is
 * reproducible.
 */
const ROLE_CYCLE = ['pm', 'dev', 'qa'];
const SHIM_CYCLE = [
  { name: 'claude', src: claudeStyleShimSrc, promptTransport: 'dispatch_bundle_only' },
  { name: 'codex-bundle', src: codexStyleShimSrc, promptTransport: 'dispatch_bundle_only' },
  { name: 'codex-stdin', src: codexStdinShimSrc, promptTransport: 'stdin' },
];

function nextRoleFor(role) {
  if (role === 'pm') return 'dev';
  if (role === 'dev') return 'qa';
  return 'launch';
}

describe('BUG-54 ten-turn PM/dev/QA reliability sequence', () => {
  it(
    'dispatches 10 consecutive PM/dev/QA local_cli turns with realistic bundles and succeeds ≥9/10 without stdout_attach_failed or startup_watchdog_fired',
    { timeout: 60_000 },
    async () => {
      const root = makeTmp();
      mkdirSync(join(root, '.agentxchain'), { recursive: true });

      const iterations = [];
      const handlesBefore = process._getActiveHandles?.().length ?? 0;

      for (let i = 0; i < ITER; i++) {
        const role = ROLE_CYCLE[i % ROLE_CYCLE.length];
        const shim = SHIM_CYCLE[i % SHIM_CYCLE.length];
        const turnId = `turn_bug54_tenturn_${i}_${randomBytes(3).toString('hex')}`;
        const phase = role === 'pm' ? 'planning' : role === 'dev' ? 'implementation' : 'qa';
        const nextRole = nextRoleFor(role);

        const scriptPath = join(root, `shim-${i}-${shim.name}.js`);
        writeFileSync(scriptPath, shim.src(root, turnId, nextRole));

        const runtime = {
          type: 'local_cli',
          command: ['node', scriptPath],
          cwd: '.',
          prompt_transport: shim.promptTransport,
        };
        const state = makeState({ turnId, role, phase });
        const config = makeConfig({ role, runtime });

        const bundleRes = writeDispatchBundle(root, state, config);
        assert.equal(bundleRes.ok, true, `iter ${i} (${role}/${shim.name}): dispatch bundle must write cleanly`);
        const size = bundleBytes(bundleRes.bundlePath);
        assert.ok(
          size >= OBSERVED_TUSQ_BUNDLE_BYTES,
          `iter ${i} (${role}/${shim.name}): bundle ${size}B must be >= observed ${OBSERVED_TUSQ_BUNDLE_BYTES}B`,
        );

        const result = await dispatchLocalCli(root, state, config);
        const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
        const stagedExists = existsSync(stagingPath);
        const stagedBody = stagedExists ? JSON.parse(readFileSync(stagingPath, 'utf8')) : null;

        iterations.push({
          i,
          role,
          phase,
          shim: shim.name,
          turnId,
          bundleBytes: size,
          result,
          stagedExists,
          stagedBody,
        });
      }

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));
      const handlesAfter = process._getActiveHandles?.().length ?? 0;

      // 1. All iterations return — no hangs.
      assert.equal(iterations.length, ITER, 'all iterations must return');

      // 2. Role coverage — PM/dev/QA each got at least 3 turns.
      const roleCount = { pm: 0, dev: 0, qa: 0 };
      for (const it of iterations) roleCount[it.role] += 1;
      for (const role of ROLE_CYCLE) {
        assert.ok(
          roleCount[role] >= 3,
          `role ${role} must get at least 3 turns across the sequence; got ${roleCount[role]}`,
        );
      }

      // 3. Shim coverage — every shim shape exercised at least 3 times.
      const shimCount = { claude: 0, 'codex-bundle': 0, 'codex-stdin': 0 };
      for (const it of iterations) shimCount[it.shim] += 1;
      for (const name of Object.keys(shimCount)) {
        assert.ok(
          shimCount[name] >= 3,
          `shim ${name} must be exercised at least 3 times; got ${shimCount[name]}`,
        );
      }

      // 4. Zero stdout_attach_failed classifications — the BUG-54 failure mode.
      const attachFailed = iterations.filter((it) => it.result.startupFailureType === 'stdout_attach_failed');
      assert.equal(
        attachFailed.length,
        0,
        `zero iterations must be classified stdout_attach_failed; got ${attachFailed.length}: ${JSON.stringify(attachFailed.map((x) => ({ i: x.i, role: x.role, shim: x.shim })))}`,
      );

      // 5. Zero startup_watchdog_fired diagnostics — the ghost_turn class in
      //    the adapter. A successful turn must prove first_output before the
      //    watchdog fires; any iteration that tripped the watchdog is either a
      //    false-kill (regression on DEFAULT_STARTUP_WATCHDOG_MS floor) or a
      //    shim bug (regression on the test itself).
      for (const it of iterations) {
        const log = it.result.logs.join('');
        assert.doesNotMatch(
          log,
          /\[adapter:diag\] startup_watchdog_fired /,
          `iter ${it.i} (${it.role}/${it.shim}): startup_watchdog_fired must not fire on realistic-bundle success path`,
        );
        assert.doesNotMatch(
          log,
          /"exit_signal":"SIGTERM"/,
          `iter ${it.i} (${it.role}/${it.shim}): no SIGTERM expected on success path`,
        );
      }

      // 6. ≥9/10 succeed with a staged turn result (adapter returned ok=true
      //    AND the staging file is on disk). This is the headline roadmap
      //    acceptance: "10 consecutive PM/dev/QA local_cli dispatches succeed
      //    at >90% rate, not <20%."
      const successes = iterations.filter((it) => it.result.ok === true && it.stagedExists);
      assert.ok(
        successes.length >= MIN_SUCCESSES,
        `at least ${MIN_SUCCESSES}/${ITER} dispatches must succeed end-to-end; got ${successes.length}. Failures: ${JSON.stringify(
          iterations
            .filter((it) => !(it.result.ok === true && it.stagedExists))
            .map((x) => ({ i: x.i, role: x.role, shim: x.shim, ok: x.result.ok, stagedExists: x.stagedExists, failureType: x.result.startupFailureType })),
        )}`,
      );

      // 7. Every staged result is well-formed and names the expected next role
      //    for its position. Proves the test isn't claiming success on an
      //    empty/corrupt staging file.
      for (const it of iterations.filter((x) => x.stagedExists)) {
        assert.equal(it.stagedBody.turn_id, it.turnId, `iter ${it.i}: staged turn_id must match`);
        assert.equal(it.stagedBody.verification.status, 'passed', `iter ${it.i}: staged verification must report passed`);
        assert.equal(
          it.stagedBody.next_role,
          nextRoleFor(it.role),
          `iter ${it.i} (${it.role}): staged next_role must be ${nextRoleFor(it.role)}`,
        );
      }

      // 8. PIDs unique — each iteration spawned a fresh subprocess, not reused
      //    a prior hung one. Guards against a future regression where the
      //    adapter silently reattaches to a stale child.
      const pids = new Set();
      for (const it of iterations) {
        const log = it.result.logs.join('');
        const matches = log.match(/"pid":\s*(\d+)/g) || [];
        for (const m of matches) {
          const pid = Number(m.replace(/"pid":\s*/, ''));
          if (pid > 0) pids.add(pid);
        }
      }
      assert.ok(
        pids.size >= ITER,
        `expected at least ${ITER} distinct pids across iterations; got ${pids.size}`,
      );

      // 9. No handle leak across the 10-turn sequence. Mirrors the leak guard
      //    in bug-54-repeated-dispatch-reliability.test.js but for the success
      //    path: if the adapter leaks a handle per successful dispatch, a
      //    long-running continuous session accumulates them until fd exhaustion.
      const handleDelta = handlesAfter - handlesBefore;
      assert.ok(
        handleDelta <= 3,
        `active handles grew by ${handleDelta} across ${ITER} successful dispatches — possible adapter leak. before=${handlesBefore} after=${handlesAfter}`,
      );
    },
  );
});
