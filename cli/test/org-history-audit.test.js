/**
 * Integration tests for persistent run history and governance audit trail —
 * getRunHistory(), getAuditTrail(), and the 2 new org routes.
 *
 * Follows org-dashboard.test.js patterns: temp dirs, node:http requests,
 * beforeEach/afterEach lifecycle.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { createHostedRunner } from '../src/lib/api/hosted-runner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createGovernedProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-history-audit-test-'));
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: overrides.projectId || 'hist-test',
      name: overrides.projectName || 'History Test',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'review_only',
        runtime: 'api-dev',
      },
    },
    runtimes: {
      'api-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'ANTHROPIC_API_KEY',
      },
    },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    phases: ['planning', 'implementation', 'qa'],
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));

  if (overrides.runHistory) {
    const lines = overrides.runHistory.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(dir, '.agentxchain', 'run-history.jsonl'), lines);
  }

  if (overrides.decisionLedger) {
    const lines = overrides.decisionLedger.map(d => JSON.stringify(d)).join('\n') + '\n';
    writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), lines);
  }

  if (overrides.hookAudit) {
    const lines = overrides.hookAudit.map(h => JSON.stringify(h)).join('\n') + '\n';
    writeFileSync(join(dir, '.agentxchain', 'hook-audit.jsonl'), lines);
  }

  if (overrides.events) {
    const lines = overrides.events.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(join(dir, '.agentxchain', 'events.jsonl'), lines);
  }

  if (overrides.state) {
    writeFileSync(
      join(dir, '.agentxchain', 'state.json'),
      JSON.stringify(overrides.state, null, 2)
    );
  }

  return { dir, config };
}

function loadTestConfig(dir) {
  const raw = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
  const result = loadNormalizedConfig(raw, dir);
  return result.ok ? result.normalized : raw;
}

function httpRequest(port, method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function httpPost(port, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Org History & Audit Trail — AT-HA', () => {
  let primary;
  let runner;
  let port;
  const tempDirs = [];

  beforeEach(async () => {
    primary = createGovernedProject({
      projectId: 'primary-hist',
      projectName: 'Primary History',
      state: {
        run_id: 'run_active_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        cost_tracker: { total_cost_usd: 2.00 },
        gates: {},
        updated_at: '2026-05-04T12:00:00Z',
      },
      runHistory: [
        {
          schema_version: '0.1',
          run_id: 'run_hist_001',
          project_id: 'primary-hist',
          project_name: 'Primary History',
          template: 'generic',
          status: 'completed',
          started_at: '2026-05-01T08:00:00Z',
          completed_at: '2026-05-01T10:15:00Z',
          duration_ms: 8100000,
          phases_completed: ['planning', 'implementation', 'qa'],
          total_turns: 6,
          roles_used: ['pm', 'dev', 'qa'],
          decisions_count: 12,
          total_cost_usd: 4.20,
          budget_limit_usd: 100,
          blocked_reason: null,
          gate_results: { planning_signoff: 'passed', implementation_complete: 'passed', qa_ship_verdict: 'passed' },
          connector_used: 'local-opus',
          model_used: 'claude-opus-4-6',
          provenance: { trigger: 'cli', parent_run_id: null },
          retrospective: {
            headline: 'Delivered cursor connector with 14 tests',
            terminal_reason: 'QA ship verdict YES',
            next_operator_action: null,
            follow_on_hint: null,
          },
          recorded_at: '2026-05-01T10:15:00Z',
        },
        {
          schema_version: '0.1',
          run_id: 'run_hist_002',
          project_id: 'primary-hist',
          project_name: 'Primary History',
          template: 'generic',
          status: 'blocked',
          started_at: '2026-05-02T09:00:00Z',
          completed_at: '2026-05-02T09:45:00Z',
          duration_ms: 2700000,
          phases_completed: ['planning', 'implementation'],
          total_turns: 4,
          roles_used: ['pm', 'dev'],
          decisions_count: 5,
          total_cost_usd: 2.10,
          budget_limit_usd: 100,
          blocked_reason: 'budget exceeded during implementation',
          gate_results: { planning_signoff: 'passed', implementation_complete: 'pending' },
          connector_used: 'local-opus',
          model_used: 'claude-opus-4-6',
          provenance: { trigger: 'cli', parent_run_id: null },
          retrospective: {
            headline: 'Blocked: budget exceeded during implementation',
            terminal_reason: 'Budget exhausted',
            next_operator_action: 'Increase budget or reduce scope',
            follow_on_hint: null,
          },
          recorded_at: '2026-05-02T09:45:00Z',
        },
      ],
      decisionLedger: [
        {
          decision: 'policy_escalation',
          timestamp: '2026-05-01T09:00:00Z',
          run_id: 'run_hist_001',
          phase: 'implementation',
          role: 'dev',
          violations: [{ message: 'turn exceeds budget reservation' }],
        },
        {
          id: 'DEC-001',
          phase: 'planning',
          role: 'pm',
          category: 'architecture',
          statement: 'Use flat registry',
          rationale: 'MVP simplicity',
        },
      ],
      hookAudit: [
        {
          hook_name: 'budget-guard',
          verdict: 'block',
          timestamp: '2026-05-01T09:45:00Z',
          phase: 'qa',
          message: 'cost exceeds threshold',
          event: 'pre_turn',
        },
        {
          hook_name: 'lint-check',
          verdict: 'allow',
          timestamp: '2026-05-01T09:00:00Z',
          phase: 'implementation',
          message: 'all clean',
        },
        {
          hook_name: 'format-check',
          verdict: 'warn',
          timestamp: '2026-05-01T09:30:00Z',
          phase: 'implementation',
          message: 'trailing whitespace found',
        },
      ],
      events: [
        {
          event_type: 'gate_failed',
          timestamp: '2026-05-01T09:30:00Z',
          run_id: 'run_hist_001',
          phase: 'qa',
          payload: { gate_id: 'qa_ship_verdict' },
        },
        {
          event_type: 'turn_dispatched',
          timestamp: '2026-05-01T08:00:00Z',
          run_id: 'run_hist_001',
          phase: 'planning',
        },
        {
          event_type: 'escalation_raised',
          timestamp: '2026-05-01T10:00:00Z',
          run_id: 'run_hist_001',
          phase: 'implementation',
          payload: { reason: 'budget approaching limit' },
        },
      ],
    });
    tempDirs.push(primary.dir);

    port = 10000 + Math.floor(Math.random() * 50000);
    const config = loadTestConfig(primary.dir);
    runner = createHostedRunner({
      root: primary.dir,
      config,
      port,
      host: '127.0.0.1',
    });
    await runner.start();
  });

  afterEach(async () => {
    if (runner) await runner.stop();
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    tempDirs.length = 0;
  });

  it('AT-HA-001: GET /v1/org/history returns records with project attribution', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/history');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data), 'data should be an array');
    assert.ok(typeof res.body.total === 'number', 'total should be a number');
    assert.ok(res.body.data.length >= 1, 'Should have at least 1 run history record');

    for (const entry of res.body.data) {
      assert.ok(entry.project_id, 'Each entry must have project_id');
      assert.ok(entry.project_name, 'Each entry must have project_name');
    }
  });

  it('AT-HA-002: Run history records include full-fidelity fields', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/history');

    assert.equal(res.status, 200);
    const record = res.body.data.find(r => r.run_id === 'run_hist_001');
    assert.ok(record, 'Should find run_hist_001');

    assert.ok(record.retrospective, 'Must have retrospective');
    assert.ok(record.retrospective.headline, 'Retrospective must have headline');
    assert.ok(record.provenance, 'Must have provenance');
    assert.ok(record.gate_results, 'Must have gate_results');
    assert.ok(Array.isArray(record.phases_completed), 'Must have phases_completed array');
    assert.ok(typeof record.duration_ms === 'number', 'Must have duration_ms');
    assert.equal(record.duration_ms, 8100000);
    assert.deepEqual(record.phases_completed, ['planning', 'implementation', 'qa']);
    assert.equal(record.gate_results.qa_ship_verdict, 'passed');
  });

  it('AT-HA-003: Run history supports status filter', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/history?status=completed');

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1, 'Should have at least 1 completed record');
    for (const entry of res.body.data) {
      assert.equal(entry.status, 'completed', `Expected completed, got ${entry.status}`);
    }

    const blockedRes = await httpRequest(port, 'GET', '/v1/org/history?status=blocked');
    assert.equal(blockedRes.status, 200);
    for (const entry of blockedRes.body.data) {
      assert.equal(entry.status, 'blocked', `Expected blocked, got ${entry.status}`);
    }
  });

  it('AT-HA-004: GET /v1/org/audit-trail returns governance events from decision-ledger', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/audit-trail');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data), 'data should be an array');
    assert.ok(typeof res.body.total === 'number', 'total should be a number');

    const ledgerEvents = res.body.data.filter(e => e.source === 'decision_ledger');
    assert.ok(ledgerEvents.length >= 1, 'Should have at least 1 decision-ledger event');

    const policyEvent = ledgerEvents.find(e => e.event_type === 'policy_escalation');
    assert.ok(policyEvent, 'Should find policy_escalation event');
    assert.equal(policyEvent.source, 'decision_ledger');
    assert.ok(policyEvent.summary.includes('Policy violation'), 'Summary should describe violation');
    assert.ok(policyEvent.project_id, 'Must have project_id');
    assert.ok(policyEvent.project_name, 'Must have project_name');
  });

  it('AT-HA-005: Audit trail returns hook block events with correct severity', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/audit-trail');

    assert.equal(res.status, 200);

    const hookEvents = res.body.data.filter(e => e.source === 'hook_audit');
    assert.ok(hookEvents.length >= 1, 'Should have at least 1 hook_audit event');

    const blockEvent = hookEvents.find(e => e.event_type === 'hook_block');
    assert.ok(blockEvent, 'Should find hook_block event');
    assert.equal(blockEvent.severity, 'high', 'hook_block should be high severity');
    assert.ok(blockEvent.summary.includes('budget-guard'), 'Summary should include hook name');

    const warnEvent = hookEvents.find(e => e.event_type === 'hook_warn');
    assert.ok(warnEvent, 'Should find hook_warn event');
    assert.equal(warnEvent.severity, 'medium', 'hook_warn should be medium severity');
  });

  it('AT-HA-006: Audit trail returns lifecycle governance events from events.jsonl', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/audit-trail');

    assert.equal(res.status, 200);

    const eventsFromSource = res.body.data.filter(e => e.source === 'events');
    assert.ok(eventsFromSource.length >= 1, 'Should have at least 1 events.jsonl governance event');

    const gateFailed = eventsFromSource.find(e => e.event_type === 'gate_failed');
    assert.ok(gateFailed, 'Should find gate_failed event');
    assert.equal(gateFailed.source, 'events');
    assert.ok(gateFailed.summary.includes('Gate failed'), 'Summary should describe gate failure');

    // turn_dispatched should NOT be included (not a governance event type)
    const turnDispatched = res.body.data.find(e => e.event_type === 'turn_dispatched');
    assert.ok(!turnDispatched, 'turn_dispatched should be excluded (not governance-relevant)');
  });

  it('AT-HA-007: Audit trail supports severity filter', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/audit-trail?severity=high');

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1, 'Should have at least 1 high severity event');
    for (const entry of res.body.data) {
      assert.equal(entry.severity, 'high', `Expected high, got ${entry.severity}`);
    }

    // Also check medium filter
    const medRes = await httpRequest(port, 'GET', '/v1/org/audit-trail?severity=medium');
    assert.equal(medRes.status, 200);
    for (const entry of medRes.body.data) {
      assert.equal(entry.severity, 'medium', `Expected medium, got ${entry.severity}`);
    }
  });

  it('AT-HA-008: Multi-project aggregation for both endpoints', async () => {
    // Create a second project with different run-history and governance events
    const secondary = createGovernedProject({
      projectId: 'secondary-hist',
      projectName: 'Secondary History',
      runHistory: [
        {
          schema_version: '0.1',
          run_id: 'run_sec_001',
          status: 'completed',
          started_at: '2026-05-03T08:00:00Z',
          completed_at: '2026-05-03T10:00:00Z',
          duration_ms: 7200000,
          phases_completed: ['planning', 'implementation'],
          total_turns: 3,
          roles_used: ['pm', 'dev'],
          decisions_count: 4,
          total_cost_usd: 1.50,
          gate_results: { planning_signoff: 'passed', implementation_complete: 'passed' },
          retrospective: { headline: 'Secondary project completed' },
          recorded_at: '2026-05-03T10:00:00Z',
        },
      ],
      decisionLedger: [
        {
          decision: 'timeout_run_level',
          timestamp: '2026-05-03T09:00:00Z',
          run_id: 'run_sec_001',
          phase: 'implementation',
          scope: 'run',
          elapsed_minutes: 120,
          limit_minutes: 60,
        },
      ],
    });
    tempDirs.push(secondary.dir);

    // Register the secondary project
    const regRes = await httpPost(port, '/v1/org/projects', { root: secondary.dir });
    assert.equal(regRes.status, 201);

    // Check run history aggregates both projects (use run_id to identify source)
    const histRes = await httpRequest(port, 'GET', '/v1/org/history');
    assert.equal(histRes.status, 200);
    assert.ok(histRes.body.total >= 3, `Expected total >= 3, got ${histRes.body.total}`);

    const primaryRecord = histRes.body.data.find(r => r.run_id === 'run_hist_001');
    const secondaryRecord = histRes.body.data.find(r => r.run_id === 'run_sec_001');
    assert.ok(primaryRecord, 'Should have primary project record (run_hist_001)');
    assert.ok(secondaryRecord, 'Should have secondary project record (run_sec_001)');
    // Verify they have different project_ids (cross-project aggregation)
    assert.notEqual(primaryRecord.project_id, secondaryRecord.project_id, 'Records should come from different projects');

    // Check audit trail aggregates both projects (use event_type to identify source)
    const auditRes = await httpRequest(port, 'GET', '/v1/org/audit-trail');
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.body.total >= 2, `Expected audit total >= 2, got ${auditRes.body.total}`);

    // Primary has policy_escalation, secondary has timeout_run_level
    const policyEvent = auditRes.body.data.find(e => e.event_type === 'policy_escalation');
    const timeoutEvent = auditRes.body.data.find(e => e.event_type === 'timeout_run_level');
    assert.ok(policyEvent, 'Should have policy_escalation from primary project');
    assert.ok(timeoutEvent, 'Should have timeout_run_level from secondary project');
    assert.notEqual(policyEvent.project_id, timeoutEvent.project_id, 'Audit events should come from different projects');
  });
});
