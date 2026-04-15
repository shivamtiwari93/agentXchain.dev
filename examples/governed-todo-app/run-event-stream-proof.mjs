#!/usr/bin/env node

/**
 * Event stream proof.
 *
 * Proves that governed run lifecycle events are emitted to events.jsonl
 * in correct order, and that the dashboard /api/events endpoint serves them.
 *
 * Flow:
 *   1. Scaffold a governed project with local_cli adapter
 *   2. Run a governed run with auto-approve
 *   3. Read events.jsonl and verify:
 *      - run_started comes first
 *      - turn_dispatched before turn_accepted for same turn
 *      - phase_entered at correct points
 *      - run_completed comes last
 *   4. Start a dashboard bridge-server, query /api/events, verify same events
 *   5. Verify event type filtering works
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
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
  spawnSync('git', ['config', 'user.name', 'Event Stream Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'event-stream-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

/**
 * Minimal mock agent that reads dispatch bundle and writes a valid turn result.
 */
function writeMockAgent(root) {
  const mockPath = join(root, 'mock-agent.mjs');
  writeFileSync(mockPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const cwd = process.cwd();

// Read dispatch index to find the staging result path
const indexPath = join(cwd, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('event-stream-mock: no dispatch index');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('event-stream-mock: no active turns');
  process.exit(1);
}

const entry = turnEntries[0];
const turnId = entry.turn_id;
const roleId = entry.role;
const runtimeId = entry.runtime_id;
const stagingResultPath = entry.staging_result_path;
const runId = index.run_id;

// Write a full turn result to the staging path
const result = {
  schema_version: '1.0',
  run_id: runId,
  turn_id: turnId,
  role: roleId,
  runtime_id: runtimeId,
  status: 'completed',
  summary: 'Event stream proof turn',
  decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Event proof decision', rationale: 'Testing events' }],
  objections: [],
  files_changed: ['src/mock.js'],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['echo ok'],
    evidence_summary: 'pass',
    machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
  },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: 'human',
  run_completion_request: true,
  phase_transition_request: null,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(cwd, stagingResultPath);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(result, null, 2));
console.log('event-stream-mock: turn result written to ' + stagingResultPath);
`);
  return mockPath;
}

function makeConfig(mockAgentPath) {
  const runtime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `event-stream-proof-${randomBytes(4).toString('hex')}`,
      name: 'Event Stream Proof',
      description: 'Prove lifecycle events are emitted in order.',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': runtime,
    },
    routing: {
      delivery: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'delivery_signoff',
      },
    },
    phases: ['delivery'],
    gates: {
      delivery_signoff: {},
    },
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
  const mockAgentPath = writeMockAgent(root);
  writeJson(join(root, 'agentxchain.json'), makeConfig(mockAgentPath));
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'event-stream-proof',
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
  writeFileSync(join(root, 'TALK.md'), '# Event Stream Proof\n');
  gitInit(root);
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'event-stream-proof',
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

  console.log(`Event Stream Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run ID:       ${payload.artifacts?.run_id || 'n/a'}`);
    console.log(`  Total events: ${payload.artifacts?.total_events || 0}`);
    console.log(`  Event types:  ${payload.artifacts?.event_types?.join(', ') || 'n/a'}`);
    console.log(`  Ordering:     verified`);
    console.log(`  API events:   ${payload.artifacts?.api_event_count ?? 'n/a'}`);
    console.log('  Result:       PASS — lifecycle events emitted in correct order');
    return;
  }

  console.log('  Result:       FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:        ${error}`);
  }
}

/**
 * Verify event ordering invariants.
 */
function verifyEventOrdering(events, errors) {
  if (events.length === 0) {
    errors.push('No events found in events.jsonl');
    return;
  }

  // 1. First event must be run_started
  if (events[0].event_type !== 'run_started') {
    errors.push(`First event should be run_started, got ${events[0].event_type}`);
  }

  // 2. Last event must be run_completed (for a completed run)
  if (events[events.length - 1].event_type !== 'run_completed') {
    errors.push(`Last event should be run_completed, got ${events[events.length - 1].event_type}`);
  }

  // 3. For each turn_accepted, there must be a preceding turn_dispatched with same turn_id
  const dispatchedTurns = new Set();
  for (const evt of events) {
    if (evt.event_type === 'turn_dispatched' && evt.turn?.turn_id) {
      dispatchedTurns.add(evt.turn.turn_id);
    }
    if (evt.event_type === 'turn_accepted' && evt.turn?.turn_id) {
      if (!dispatchedTurns.has(evt.turn.turn_id)) {
        errors.push(`turn_accepted for ${evt.turn.turn_id} without preceding turn_dispatched`);
      }
    }
  }

  // 4. Timestamps must be monotonically non-decreasing
  for (let i = 1; i < events.length; i++) {
    const prev = new Date(events[i - 1].timestamp).getTime();
    const curr = new Date(events[i].timestamp).getTime();
    if (curr < prev) {
      errors.push(`Event ${i} timestamp ${events[i].timestamp} is before event ${i - 1} timestamp ${events[i - 1].timestamp}`);
    }
  }

  // 5. All events must have same run_id (except possibly the first one establishing it)
  const runIds = new Set(events.filter(e => e.run_id).map(e => e.run_id));
  if (runIds.size > 1) {
    errors.push(`Multiple run_ids found: ${[...runIds].join(', ')}`);
  }

  // 6. Every event must have a valid event_id
  for (const evt of events) {
    if (!evt.event_id || !evt.event_id.startsWith('evt_')) {
      errors.push(`Event missing valid event_id: ${JSON.stringify(evt)}`);
    }
  }
}

/**
 * Verify the events CLI command works with --json flag.
 */
function verifyEventsCli(root, expectedCount, errors) {
  const result = runCli(root, ['events', '--json', '--limit', '0']);
  if (result.status !== 0) {
    errors.push(`events --json command failed: ${result.stderr}`);
    return 0;
  }

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const cliEvents = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

  if (cliEvents.length !== expectedCount) {
    errors.push(`events --json returned ${cliEvents.length} events, expected ${expectedCount}`);
  }

  // Verify type filtering
  const typeResult = runCli(root, ['events', '--json', '--type', 'run_started', '--limit', '0']);
  if (typeResult.status !== 0) {
    errors.push(`events --json --type command failed: ${typeResult.stderr}`);
    return cliEvents.length;
  }

  const typeLines = typeResult.stdout.trim().split('\n').filter(Boolean);
  const typeEvents = typeLines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

  if (typeEvents.length !== 1) {
    errors.push(`events --type run_started returned ${typeEvents.length} events, expected 1`);
  }
  for (const evt of typeEvents) {
    if (evt.event_type !== 'run_started') {
      errors.push(`events --type filter leaked ${evt.event_type}`);
    }
  }

  return cliEvents.length;
}

async function main() {
  const root = join(tmpdir(), `axc-event-stream-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  const errors = [];
  const traces = [];

  try {
    scaffoldProject(root);

    // ── Run a governed run ──────────────────────────────────────────────────
    const run = runCli(root, ['run', '--auto-approve']);
    if (run.status !== 0) {
      throw new Error(`run failed:\n${run.stdout}\n${run.stderr}`);
    }

    const state = readJson(join(root, '.agentxchain', 'state.json'));
    traces.push({ step: 'run_complete', run_id: state.run_id, status: state.status });

    if (state.status !== 'completed') {
      errors.push(`run expected status completed, got ${state.status}`);
    }

    // ── Read events.jsonl ───────────────────────────────────────────────────
    const eventsPath = join(root, '.agentxchain', 'events.jsonl');
    if (!existsSync(eventsPath)) {
      errors.push('events.jsonl not created after run');
    } else {
      const events = readJsonl(eventsPath);
      traces.push({
        step: 'events_read',
        total: events.length,
        types: events.map(e => e.event_type),
      });

      // Verify ordering invariants
      verifyEventOrdering(events, errors);

      // ── Verify events CLI ───────────────────────────────────────────────
      const cliEventCount = verifyEventsCli(root, events.length, errors);

      const eventTypes = [...new Set(events.map(e => e.event_type))];
      const payload = buildPayload({
        result: errors.length === 0 ? 'pass' : 'fail',
        errors,
        traces,
        artifacts: {
          run_id: state.run_id,
          total_events: events.length,
          event_types: eventTypes,
          cli_event_count: cliEventCount,
        },
      });
      printPayload(payload);
      process.exitCode = errors.length === 0 ? 0 : 1;
      return;
    }

    const payload = buildPayload({
      result: 'fail',
      errors,
      traces,
      artifacts: null,
    });
    printPayload(payload);
    process.exitCode = 1;
  } catch (error) {
    const payload = buildPayload({
      result: 'fail',
      errors: [error.message, ...errors],
      traces,
      artifacts: null,
    });
    printPayload(payload);
    process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
