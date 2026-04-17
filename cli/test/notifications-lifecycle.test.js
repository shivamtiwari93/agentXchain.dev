import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  STATE_PATH,
  approveRunCompletion,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
  initializeGovernedRun,
  markRunBlocked,
  raiseOperatorEscalation,
  reactivateGovernedRun,
} from '../src/lib/governed-state.js';
import { NOTIFICATION_AUDIT_PATH } from '../src/lib/notification-runner.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { scaffoldGoverned } from '../src/commands/init.js';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), `axc-notify-${randomBytes(6).toString('hex')}`));
}

function writeJson(root, relPath, value) {
  const fullPath = join(root, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const start = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitFor(check, timeoutMs = 5000, intervalMs = 25) {
  const start = Date.now();
  while (true) {
    const value = check();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for expected condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function createWebhookCollector(root) {
  const portFile = join(root, 'notify-port.txt');
  const requestsFile = join(root, 'notify-requests.jsonl');
  const serverScript = `
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const [portFile, requestsFile] = process.argv.slice(1);
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    appendFileSync(requestsFile, body + '\\n');
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

  const proc = spawn(process.execPath, ['-e', serverScript, portFile, requestsFile], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  await waitForFile(portFile);
  const url = `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}/events`;

  return {
    url,
    readRequests: () => {
      if (!existsSync(requestsFile)) return [];
      const content = readFileSync(requestsFile, 'utf8').trim();
      if (!content) return [];
      return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    close: () => new Promise((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
    }),
  };
}

function makeConfig(webhookUrl, events = []) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'notify-test', name: 'Notify Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
    hooks: {},
    notifications: {
      webhooks: [
        {
          name: 'ops_webhook',
          url: webhookUrl,
          events,
          timeout_ms: 5000,
        },
      ],
    },
    budget: { per_turn_max_usd: 2, per_run_max_usd: 50 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state, turn = getActiveTurn(state), overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Completed work.',
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Used the straightforward approach.',
      rationale: 'It is sufficient for the test.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'Review note captured for protocol compliance.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'All good.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0.001 },
    ...overrides,
  };
}

function writeTurnResult(root, turnId, result) {
  writeJson(root, getTurnStagingResultPath(turnId), result);
}

describe('notification lifecycle', () => {
  let dir;
  let collector;

  beforeEach(async () => {
    dir = makeTmpDir();
    collector = await createWebhookCollector(dir);
  });

  afterEach(async () => {
    await collector.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('AT-NOTIFY-003: markRunBlocked emits run_blocked and records notification audit', async () => {
    const config = makeConfig(collector.url, ['run_blocked']);
    scaffoldGoverned(dir, config);
    initializeGovernedRun(dir, config);
    assignGovernedTurn(dir, config, 'dev');

    const state = readJson(dir, STATE_PATH);
    const turn = getActiveTurn(state);

    const blocked = markRunBlocked(dir, {
      blockedOn: 'dispatch:api_proxy_failure',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
        turn_retained: true,
        detail: 'provider failed',
      },
      turnId: turn.turn_id,
      notificationConfig: config,
    });

    assert.equal(blocked.ok, true);
    const requests = await waitFor(() => {
      const seen = collector.readRequests();
      return seen.length === 1 ? seen : null;
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].event_type, 'run_blocked');
    assert.equal(requests[0].payload.category, 'dispatch_error');
    assert.ok(requests[0].payload.human_escalation, 'run_blocked payload must include human escalation metadata');
    assert.match(requests[0].payload.human_escalation.resolution_command, /^agentxchain unblock hesc_/);

    const audit = await waitFor(() => existsSync(join(dir, NOTIFICATION_AUDIT_PATH)) ? readJsonl(dir, NOTIFICATION_AUDIT_PATH) : null);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].event_type, 'run_blocked');
    assert.equal(audit[0].delivered, true);
  });

  it('AT-NOTIFY-004/005: operator escalation emits raised and resolved events', () => {
    const config = makeConfig(collector.url, ['run_blocked', 'operator_escalation_raised', 'escalation_resolved']);
    scaffoldGoverned(dir, config);
    initializeGovernedRun(dir, config);
    assignGovernedTurn(dir, config, 'dev');

    const escalated = raiseOperatorEscalation(dir, config, {
      reason: 'need human decision',
      detail: 'provider ambiguity',
    });
    assert.equal(escalated.ok, true);

    const reactivated = reactivateGovernedRun(dir, escalated.state, {
      via: 'resume',
      notificationConfig: config,
    });
    assert.equal(reactivated.ok, true);

    assert.deepEqual(
      collector.readRequests().map((req) => req.event_type),
      ['run_blocked', 'operator_escalation_raised', 'escalation_resolved'],
    );
  });

  it('AT-NOTIFY-006: acceptGovernedTurn emits phase_transition_pending when human approval is required', () => {
    const config = makeConfig(collector.url, ['phase_transition_pending']);
    scaffoldGoverned(dir, config);
    initializeGovernedRun(dir, config);
    assignGovernedTurn(dir, config, 'pm');
    writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
    writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Phases\n\n| Phase | Goal | Status |\n|-------|------|--------|\n| Planning | Validate plan | Complete |\n');

    const state = readJson(dir, STATE_PATH);
    const turn = getActiveTurn(state);
    writeTurnResult(dir, turn.turn_id, makeTurnResult(state, turn, {
      role: 'pm',
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
    }));

    const accepted = acceptGovernedTurn(dir, config, { turnId: turn.turn_id });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.state.status, 'paused');
    assert.ok(accepted.state.pending_phase_transition);

    const requests = collector.readRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].event_type, 'phase_transition_pending');
    assert.equal(requests[0].payload.to, 'implementation');
  });

  it('AT-NOTIFY-007: run completion pending and approval emit notification events', () => {
    const config = makeConfig(collector.url, ['run_completion_pending', 'run_completed']);
    scaffoldGoverned(dir, config);
    initializeGovernedRun(dir, config);

    const state = readJson(dir, STATE_PATH);
    writeJson(dir, STATE_PATH, {
      ...state,
      phase: 'qa',
    });
    writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example | Example | pass | today | pass |\n');
    writeFileSync(join(dir, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: YES\n');
    writeFileSync(join(dir, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    assignGovernedTurn(dir, config, 'qa');
    const qaState = readJson(dir, STATE_PATH);
    const turn = getActiveTurn(qaState);
    writeTurnResult(dir, turn.turn_id, makeTurnResult(qaState, turn, {
      role: 'qa',
      proposed_next_role: 'human',
      run_completion_request: true,
    }));

    const accepted = acceptGovernedTurn(dir, config, { turnId: turn.turn_id });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.state.status, 'paused');
    assert.ok(accepted.state.pending_run_completion);

    const approved = approveRunCompletion(dir, config);
    assert.equal(approved.ok, true);
    assert.equal(approved.state.status, 'completed');

    assert.deepEqual(
      collector.readRequests().map((req) => req.event_type),
      ['run_completion_pending', 'run_completed'],
    );
  });
});
