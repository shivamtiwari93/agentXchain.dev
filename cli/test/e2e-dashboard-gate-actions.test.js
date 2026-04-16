import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { render as renderBlocked } from '../dashboard/components/blocked.js';
import { render as renderGate } from '../dashboard/components/gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard', import.meta.url));
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function httpRequest(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, { method, headers }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`timeout for ${method} ${path}`));
    });
    req.end(body);
  });
}

async function getJson(port, path) {
  const res = await httpRequest(port, path);
  assert.equal(res.status, 200, `expected 200 for ${path}`);
  return JSON.parse(res.body);
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20_000,
  });
}

function makeConfig({ gateId, gateActions }) {
  const gates = {
    [gateId]: {
      requires_human_approval: true,
      gate_actions: gateActions,
    },
  };
  if (gateId !== 'ship_gate') {
    gates.ship_gate = {
      requires_human_approval: true,
    };
  }

  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'dashboard-gate-actions-fixture',
      name: 'Dashboard Gate Actions Fixture',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Ship the requested slice.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['node', '-e', 'console.log(process.argv[1])', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: gateId,
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'ship_gate',
      },
      done: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates,
  };
}

function makePhaseTransitionState(gateId) {
  return {
    schema_version: '1.1',
    run_id: 'run_dashboard_gate_actions',
    project_id: 'dashboard-gate-actions-fixture',
    status: 'paused',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 1,
    last_completed_turn_id: 'turn_001',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: {
      from: 'planning',
      to: 'implementation',
      gate: gateId,
      requested_by_turn: 'turn_001',
      requested_at: '2026-04-16T16:00:00.000Z',
    },
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: {
      [gateId]: 'pending',
    },
    budget_status: {
      spent_usd: 0,
      remaining_usd: 10,
    },
  };
}

function makeRunCompletionState(gateId) {
  return {
    schema_version: '1.1',
    run_id: 'run_dashboard_gate_actions',
    project_id: 'dashboard-gate-actions-fixture',
    status: 'paused',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 3,
    last_completed_turn_id: 'turn_003',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: {
      gate: gateId,
      requested_by_turn: 'turn_003',
      requested_at: '2026-04-16T18:00:00.000Z',
    },
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: {
      [gateId]: 'pending',
    },
    budget_status: {
      spent_usd: 0,
      remaining_usd: 10,
    },
  };
}

function createFixture({ gateId, state, gateActions }) {
  const root = mkdtempSync(join(tmpdir(), 'axc-dash-gate-actions-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), makeConfig({ gateId, gateActions }));
  writeJson(join(root, '.agentxchain', 'state.json'), state);
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  writeFileSync(
    join(root, 'scripts', 'write-success.mjs'),
    "import { writeFileSync } from 'node:fs';\nconst [, , file, value] = process.argv;\nwriteFileSync(file, value + '\\n');\n",
  );
  writeFileSync(
    join(root, 'scripts', 'fail-step.mjs'),
    "console.error('publish failed hard');\nprocess.exit(7);\n",
  );
  writeFileSync(
    join(root, 'scripts', 'hang-step.mjs'),
    "setInterval(() => {}, 1000);\n",
  );

  return root;
}

async function withBridge(root, fn) {
  const bridge = createBridgeServer({
    agentxchainDir: join(root, '.agentxchain'),
    dashboardDir: DASHBOARD_DIR,
    port: 0,
  });

  try {
    const { port } = await bridge.start();
    await fn(port);
  } finally {
    await bridge.stop();
  }
}

describe('dashboard gate actions end-to-end', () => {
  it('AT-DASH-GA-008: bridge -> render pipeline surfaces a real CLI-produced phase-transition gate-action failure', async () => {
    const gateId = 'planning_signoff';
    const root = createFixture({
      gateId,
      state: makePhaseTransitionState(gateId),
      gateActions: [
        { label: 'write once', run: 'node scripts/write-success.mjs partial.txt one' },
        { label: 'fail publish', run: 'node scripts/fail-step.mjs' },
      ],
    });

    const approval = runCli(root, ['approve-transition']);
    assert.notEqual(approval.status, 0);
    assert.match(approval.stdout + approval.stderr, /Blocked By Gate Action/);

    await withBridge(root, async (port) => {
      const state = await getJson(port, '/api/state');
      const gateActions = await getJson(port, '/api/gate-actions');
      const gateHtml = renderGate({ state, history: [], gateActions });
      const blockedHtml = renderBlocked({ state, gateActions });

      assert.equal(state.status, 'blocked');
      assert.equal(state.pending_phase_transition?.gate, gateId);
      assert.equal(gateActions.latest_attempt?.gate_type, 'phase_transition');
      assert.equal(gateActions.latest_attempt?.status, 'failed');
      assert.equal(gateActions.configured[0].run, 'node scripts/write-success.mjs partial.txt one');
      assert.ok(gateHtml.includes('node scripts/write-success.mjs partial.txt one'));
      assert.ok(blockedHtml.includes('Gate Action Failure'));
      assert.ok(blockedHtml.includes('fail publish'));
      assert.ok(blockedHtml.includes('publish failed hard'));
      assert.ok(blockedHtml.includes('agentxchain approve-transition --dry-run'));
    });
  });

  it('AT-DASH-GA-007: blocked view uses approve-completion dry-run guidance for real run-completion gate-action failures', async () => {
    const gateId = 'ship_gate';
    const root = createFixture({
      gateId,
      state: makeRunCompletionState(gateId),
      gateActions: [
        { label: 'write once', run: 'node scripts/write-success.mjs partial.txt one' },
        { label: 'fail publish', run: 'node scripts/fail-step.mjs' },
      ],
    });

    const approval = runCli(root, ['approve-completion']);
    assert.notEqual(approval.status, 0);
    assert.match(approval.stdout + approval.stderr, /Blocked By Gate Action/);

    await withBridge(root, async (port) => {
      const state = await getJson(port, '/api/state');
      const gateActions = await getJson(port, '/api/gate-actions');
      const blockedHtml = renderBlocked({ state, gateActions });

      assert.equal(state.status, 'blocked');
      assert.equal(state.pending_run_completion?.gate, gateId);
      assert.equal(gateActions.latest_attempt?.gate_type, 'run_completion');
      assert.ok(blockedHtml.includes('agentxchain approve-completion --dry-run'));
      assert.ok(!blockedHtml.includes('agentxchain approve-transition --dry-run'));
    });
  });

  it('AT-DASH-GA-009: bridge -> render pipeline preserves timed-out gate-action evidence for blocked dashboard views', async () => {
    const gateId = 'planning_signoff';
    const root = createFixture({
      gateId,
      state: makePhaseTransitionState(gateId),
      gateActions: [
        { label: 'hang deploy', run: 'node scripts/hang-step.mjs', timeout_ms: 1000 },
      ],
    });

    const approval = runCli(root, ['approve-transition']);
    assert.notEqual(approval.status, 0);
    assert.match(approval.stdout + approval.stderr, /timeout after 1000ms/i);

    await withBridge(root, async (port) => {
      const state = await getJson(port, '/api/state');
      const gateActions = await getJson(port, '/api/gate-actions');
      const gateHtml = renderGate({ state, history: [], gateActions });
      const blockedHtml = renderBlocked({ state, gateActions });

      assert.equal(state.status, 'blocked');
      assert.equal(state.pending_phase_transition?.gate, gateId);
      assert.equal(gateActions.configured[0]?.timeout_ms, 1000);
      assert.equal(gateActions.latest_attempt?.gate_type, 'phase_transition');
      assert.equal(gateActions.latest_attempt?.status, 'failed');
      assert.equal(gateActions.latest_attempt?.actions[0]?.timed_out, true);
      assert.equal(gateActions.latest_attempt?.actions[0]?.timeout_ms, 1000);
      assert.ok(gateHtml.includes('timed out after 1000ms'));
      assert.ok(blockedHtml.includes('timed out after 1000ms'));
      assert.ok(blockedHtml.includes('agentxchain approve-transition --dry-run'));
    });
  });
});
