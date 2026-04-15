#!/usr/bin/env node

/**
 * Coordinator Event Aggregation — Proof Script
 *
 * Proves that the dashboard bridge-server correctly aggregates
 * lifecycle events from multiple child repos into a single
 * time-ordered stream via GET /api/coordinator/events.
 *
 * This proof:
 * 1. Scaffolds a coordinator workspace with 2 child repos
 * 2. Writes sample events to each child repo's events.jsonl
 * 3. Starts a dashboard bridge-server
 * 4. Verifies GET /api/coordinator/events returns merged events
 * 5. Verifies repo_id tagging on each event
 * 6. Verifies timestamp ordering across repos
 * 7. Verifies repo_id and type filtering
 *
 * Usage:
 *   node examples/live-governed-proof/run-coordinator-event-aggregation-proof.mjs [--json]
 *
 * Exit codes:
 *   0 — proof passed
 *   1 — proof failed
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeEvent(eventType, overrides = {}) {
  return {
    event_id: overrides.event_id || `evt_${randomBytes(8).toString('hex')}`,
    event_type: eventType,
    timestamp: overrides.timestamp || new Date().toISOString(),
    run_id: overrides.run_id || 'run_test',
    phase: overrides.phase || 'implementation',
    status: overrides.status || 'running',
    turn: overrides.turn || null,
    payload: overrides.payload || {},
  };
}

function writeEventsJsonl(repoRoot, events) {
  const eventsPath = join(repoRoot, '.agentxchain', 'events.jsonl');
  writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function scaffoldWorkspace() {
  const root = join(tmpdir(), `axc-coord-evt-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  for (const repoId of ['api', 'web']) {
    const repoDir = join(root, `repos/${repoId}`);
    mkdirSync(join(repoDir, '.agentxchain'), { recursive: true });

    writeJson(join(repoDir, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: `${repoId}-proj`, name: repoId, default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      },
      runtimes: {
        'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
      },
      routing: {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      },
      gates: {},
    });

    writeJson(join(repoDir, '.agentxchain/state.json'), {
      schema_version: '1.1',
      run_id: `run_${repoId}_001`,
      status: 'active',
      phase: 'implementation',
      active_turns: {},
      accepted_count: 0,
      rejected_count: 0,
      blocked_on: null,
      blocked_reason: null,
    });

    writeFileSync(join(repoDir, '.agentxchain/history.jsonl'), '');
    writeFileSync(join(repoDir, '.agentxchain/decision-ledger.jsonl'), '');
  }

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Event Proof' },
    repos: {
      api: { path: 'repos/api', default_branch: 'main', required: true },
      web: { path: 'repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      'ws-main': {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'ws-main' },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/multirepo/state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_proof_001',
    project_id: 'coord-test',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
    },
    pending_gate: null,
    created_at: '2026-04-15T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
  });

  // Write interleaved events to child repos
  writeEventsJsonl(join(root, 'repos/api'), [
    makeEvent('run_started', { timestamp: '2026-04-15T10:00:00Z', run_id: 'run_api_001', event_id: 'evt_api_start' }),
    makeEvent('turn_dispatched', { timestamp: '2026-04-15T10:00:02Z', run_id: 'run_api_001', event_id: 'evt_api_dispatch' }),
    makeEvent('turn_accepted', { timestamp: '2026-04-15T10:00:04Z', run_id: 'run_api_001', event_id: 'evt_api_accept' }),
    makeEvent('run_completed', { timestamp: '2026-04-15T10:00:06Z', run_id: 'run_api_001', event_id: 'evt_api_done' }),
  ]);

  writeEventsJsonl(join(root, 'repos/web'), [
    makeEvent('run_started', { timestamp: '2026-04-15T10:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_start' }),
    makeEvent('turn_dispatched', { timestamp: '2026-04-15T10:00:03Z', run_id: 'run_web_001', event_id: 'evt_web_dispatch' }),
    makeEvent('turn_accepted', { timestamp: '2026-04-15T10:00:05Z', run_id: 'run_web_001', event_id: 'evt_web_accept' }),
  ]);

  return root;
}

// ── Main ────────────────────────────────────────────────────────────────────

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!jsonMode) {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const root = scaffoldWorkspace();
  const dashboardDir = join(root, 'dashboard');
  mkdirSync(dashboardDir, { recursive: true });
  writeFileSync(join(dashboardDir, 'index.html'), '<html></html>');

  const { createBridgeServer } = await import(
    join(repoRoot, 'cli/src/lib/dashboard/bridge-server.js')
  );

  const bridge = createBridgeServer({
    agentxchainDir: join(root, '.agentxchain'),
    dashboardDir,
    port: 0,
  });
  const { port } = await bridge.start();

  try {
    // 1. Verify merged events from both repos
    const res1 = await httpGet(port, '/api/coordinator/events?limit=0');
    const events = JSON.parse(res1.body);
    check('GET /api/coordinator/events returns 200', res1.status === 200, `status=${res1.status}`);
    check('merged events from 2 repos', events.length === 7, `got ${events.length} events`);

    // 2. Verify repo_id tagging
    const apiEvents = events.filter(e => e.repo_id === 'api');
    const webEvents = events.filter(e => e.repo_id === 'web');
    check('api events tagged', apiEvents.length === 4, `api=${apiEvents.length}`);
    check('web events tagged', webEvents.length === 3, `web=${webEvents.length}`);

    // 3. Verify timestamp ordering
    let ordered = true;
    for (let i = 1; i < events.length; i++) {
      if (new Date(events[i].timestamp) < new Date(events[i - 1].timestamp)) {
        ordered = false;
        break;
      }
    }
    check('events sorted by timestamp ascending', ordered);

    // 4. Verify interleaving
    const expectedOrder = [
      'evt_api_start',   // 10:00:00
      'evt_web_start',   // 10:00:01
      'evt_api_dispatch', // 10:00:02
      'evt_web_dispatch', // 10:00:03
      'evt_api_accept',  // 10:00:04
      'evt_web_accept',  // 10:00:05
      'evt_api_done',    // 10:00:06
    ];
    const actualOrder = events.map(e => e.event_id);
    check('events interleaved correctly', JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
      `expected ${expectedOrder.join(',')} got ${actualOrder.join(',')}`);

    // 5. Verify repo_id filter
    const res2 = await httpGet(port, '/api/coordinator/events?repo_id=web&limit=0');
    const webOnly = JSON.parse(res2.body);
    check('repo_id filter works', webOnly.length === 3 && webOnly.every(e => e.repo_id === 'web'),
      `filtered=${webOnly.length}`);

    // 6. Verify type filter
    const res3 = await httpGet(port, '/api/coordinator/events?type=run_started&limit=0');
    const startOnly = JSON.parse(res3.body);
    check('type filter works', startOnly.length === 2 && startOnly.every(e => e.event_type === 'run_started'),
      `filtered=${startOnly.length}`);

    // 7. Verify limit
    const res4 = await httpGet(port, '/api/coordinator/events?limit=3');
    const limited = JSON.parse(res4.body);
    check('limit returns last N events', limited.length === 3, `got ${limited.length}`);
    check('limit returns correct last events',
      limited[0].event_id === 'evt_api_accept' && limited[2].event_id === 'evt_api_done',
      `first=${limited[0]?.event_id} last=${limited[2]?.event_id}`);

    // 8. Verify since filter
    const res5 = await httpGet(port, '/api/coordinator/events?since=2026-04-15T10:00:04Z&limit=0');
    const sinceEvents = JSON.parse(res5.body);
    check('since filter works', sinceEvents.length === 2, `got ${sinceEvents.length}`);
  } finally {
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  }

  const passed = checks.every(c => c.ok);

  if (jsonMode) {
    console.log(JSON.stringify({ result: passed ? 'PASS' : 'FAIL', checks }, null, 2));
  } else {
    console.log(`\n${passed ? 'PASS' : 'FAIL'}: ${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
  }

  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
