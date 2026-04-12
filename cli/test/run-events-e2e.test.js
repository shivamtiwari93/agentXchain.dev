import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject({ withTimeouts = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-events-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Events E2E', `run-events-e2e-${Date.now()}`);

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

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function parseJsonLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function waitFor(predicate, timeoutMs = 5000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

function closeFollower(child) {
  return new Promise((resolve) => {
    const done = () => resolve();
    child.once('close', done);
    child.once('exit', done);
    child.kill('SIGINT');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 1000);
  });
}

function writeCompletedTurnResult(root, turn, runId) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Run events E2E blocked-parent fixture turn completed.',
    decisions: [{
      id: 'DEC-201',
      category: 'implementation',
      statement: 'Blocked parent run was created through the real acceptance path.',
      rationale: 'Run events must be proven against the real CLI lifecycle.',
    }],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture verification passed.',
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
}

function createBlockedParentRun(root) {
  const context = loadProjectContext(root);
  assert.ok(context, 'expected governed project context');

  const init = initializeGovernedRun(root, context.config);
  assert.ok(init.ok, init.error);

  const assign = assignGovernedTurn(root, context.config, 'pm');
  assert.ok(assign.ok, assign.error);

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = readState(root);
  const turnId = Object.keys(state.active_turns)[0];
  state.active_turns[turnId].started_at = '2026-04-10T00:00:00.000Z';
  writeJson(statePath, state);

  const timedOutState = readState(root);
  const turn = timedOutState.active_turns[turnId];
  writeCompletedTurnResult(root, turn, timedOutState.run_id);

  const accept = runCli(root, ['accept-turn']);
  assert.equal(accept.status, 0, `accept-turn failed:\n${accept.combined}`);
  assert.match(accept.stdout, /Turn Accepted/);

  const blockedState = readState(root);
  assert.equal(blockedState.status, 'blocked', 'parent run must end blocked');
  return blockedState.run_id;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('run events E2E', () => {
  it('AT-EVT-008: agentxchain events shows the real governed lifecycle for a completed run', () => {
    const root = makeProject();

    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0, `run failed:\n${firstRun.combined}`);
    assert.match(firstRun.stdout, /Run completed/);

    const state = readState(root);
    const events = runCli(root, ['events', '--json', '--limit', '0']);
    assert.equal(events.status, 0, `events command failed:\n${events.combined}`);

    const parsed = parseJsonLines(events.stdout);
    const eventTypes = parsed.map((entry) => entry.event_type);
    // DEC-PHASE-EVENT-001: automatic phase transitions now emit phase_entered
    // so the sequence includes additional phase_entered events that were
    // previously silent. The exact count depends on the scaffold config routing.
    assert.equal(eventTypes[0], 'run_started');
    assert.ok(eventTypes.includes('turn_dispatched'));
    assert.ok(eventTypes.includes('turn_accepted'));
    assert.ok(eventTypes.includes('gate_pending'));
    assert.ok(eventTypes.includes('gate_approved'));
    assert.ok(eventTypes.includes('phase_entered'));
    assert.equal(eventTypes[eventTypes.length - 1], 'run_completed');
    // All phase_entered events must carry enriched payloads
    const phaseEnteredEvents = parsed.filter(e => e.event_type === 'phase_entered');
    for (const pe of phaseEnteredEvents) {
      assert.ok(pe.payload.from, `phase_entered must have from: ${JSON.stringify(pe.payload)}`);
      assert.ok(pe.payload.to, `phase_entered must have to: ${JSON.stringify(pe.payload)}`);
      assert.ok(pe.payload.trigger, `phase_entered must have trigger: ${JSON.stringify(pe.payload)}`);
      assert.ok(pe.payload.gate_id, `phase_entered must have gate_id: ${JSON.stringify(pe.payload)}`);
    }
    assert.ok(parsed.every((entry) => entry.run_id === state.run_id), 'all completed-run events must reference the current run');

    const filtered = runCli(root, ['events', '--json', '--type', 'gate_pending,run_completed', '--limit', '0']);
    assert.equal(filtered.status, 0, `filtered events failed:\n${filtered.combined}`);
    assert.deepEqual(parseJsonLines(filtered.stdout).map((entry) => entry.event_type), [
      'gate_pending',
      'gate_pending',
      'run_completed',
    ]);
  });

  it('records blocked-parent and recovery-child events with separate run_ids', () => {
    const root = makeProject({ withTimeouts: true });
    const blockedRunId = createBlockedParentRun(root);

    const recovered = runCli(root, ['run', '--auto-approve', '--max-turns', '5', '--recover-from', blockedRunId]);
    assert.equal(recovered.status, 0, `recover-from run failed:\n${recovered.combined}`);
    assert.match(recovered.stdout, /Run completed/);

    const events = parseJsonLines(runCli(root, ['events', '--json', '--limit', '0']).stdout);
    const runStartedEvents = events.filter((entry) => entry.event_type === 'run_started');
    const blockedEvents = events.filter((entry) => entry.event_type === 'run_blocked');
    const completedEvents = events.filter((entry) => entry.event_type === 'run_completed');

    assert.equal(runStartedEvents.length, 2, 'blocked parent + recovery child must each emit run_started');
    assert.equal(blockedEvents.length, 1, 'blocked parent must emit run_blocked exactly once');
    assert.equal(blockedEvents[0].run_id, blockedRunId);
    assert.equal(completedEvents.length, 1, 'recovery child must complete exactly once');
    assert.notEqual(runStartedEvents[0].run_id, runStartedEvents[1].run_id, 'recovery child must use a new run_id');
    assert.equal(completedEvents[0].run_id, runStartedEvents[1].run_id);
  });

  it('streams new events in --follow mode even when the log file does not exist yet', async () => {
    const root = makeProject();
    let stdout = '';
    let stderr = '';

    const follower = spawn(process.execPath, [CLI_BIN, 'events', '--follow', '--json', '--limit', '0'], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    follower.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    follower.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    await waitFor(() => stdout.includes('Watching for events'), 5000, 50);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const runResult = runCli(root, ['run', '--auto-approve', '--max-turns', '1']);
    assert.equal(runResult.status, 0, `short run failed:\n${runResult.combined}`);

    await waitFor(() => {
      const eventTypes = parseJsonLines(stdout).map((entry) => entry.event_type);
      return eventTypes.includes('run_started') && eventTypes.includes('turn_dispatched');
    }, 5000, 50);

    await closeFollower(follower);
    assert.equal(stderr.trim(), '', `events --follow wrote unexpected stderr:\n${stderr}`);

    const eventTypes = parseJsonLines(stdout).map((entry) => entry.event_type);
    assert.ok(eventTypes.includes('run_started'));
    assert.ok(eventTypes.includes('turn_dispatched'));
  });
});
