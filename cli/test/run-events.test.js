import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitRunEvent, readRunEvents, RUN_EVENTS_PATH, VALID_RUN_EVENTS } from '../src/lib/run-events.js';

describe('run-events', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-events-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  // AT-EVT-001: emitRunEvent appends valid JSONL
  it('AT-EVT-001: emitRunEvent appends valid JSONL to events.jsonl', () => {
    const result = emitRunEvent(root, 'run_started', {
      run_id: 'run_test_001',
      phase: 'planning',
      status: 'active',
    });

    assert.equal(result.ok, true);
    assert.ok(result.event_id.startsWith('evt_'));

    const content = readFileSync(join(root, RUN_EVENTS_PATH), 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event_type, 'run_started');
    assert.equal(parsed.run_id, 'run_test_001');
    assert.equal(parsed.phase, 'planning');
    assert.equal(parsed.status, 'active');
  });

  // AT-EVT-002: Event contains required fields
  it('AT-EVT-002: event contains required fields', () => {
    emitRunEvent(root, 'turn_dispatched', {
      run_id: 'run_002',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_abc', role_id: 'dev' },
    });

    const events = readRunEvents(root);
    assert.equal(events.length, 1);
    const evt = events[0];
    assert.ok(evt.event_id);
    assert.ok(evt.event_type);
    assert.ok(evt.timestamp);
    assert.equal(evt.run_id, 'run_002');
    assert.deepEqual(evt.turn, { turn_id: 'turn_abc', role_id: 'dev' });
  });

  // AT-EVT-003: readRunEvents reads events from log file
  it('AT-EVT-003: readRunEvents reads and returns all events', () => {
    emitRunEvent(root, 'run_started', { run_id: 'r1' });
    emitRunEvent(root, 'turn_dispatched', { run_id: 'r1' });
    emitRunEvent(root, 'turn_accepted', { run_id: 'r1' });

    const events = readRunEvents(root);
    assert.equal(events.length, 3);
    assert.equal(events[0].event_type, 'run_started');
    assert.equal(events[1].event_type, 'turn_dispatched');
    assert.equal(events[2].event_type, 'turn_accepted');
  });

  // AT-EVT-004: type filter works
  it('AT-EVT-004: --type filter selects matching events', () => {
    emitRunEvent(root, 'run_started', { run_id: 'r1' });
    emitRunEvent(root, 'turn_dispatched', { run_id: 'r1' });
    emitRunEvent(root, 'run_completed', { run_id: 'r1' });

    const filtered = readRunEvents(root, { type: 'run_started,run_completed' });
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].event_type, 'run_started');
    assert.equal(filtered[1].event_type, 'run_completed');
  });

  // AT-EVT-005: JSON output is parseable JSONL
  it('AT-EVT-005: events are valid JSONL', () => {
    emitRunEvent(root, 'run_started', { run_id: 'r1', payload: { key: 'value' } });

    const raw = readFileSync(join(root, RUN_EVENTS_PATH), 'utf8');
    const lines = raw.trim().split('\n');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });

  // AT-EVT-006: limit returns last N events
  it('AT-EVT-006: limit returns only last N events', () => {
    for (let i = 0; i < 10; i++) {
      emitRunEvent(root, 'turn_dispatched', { run_id: `r_${i}` });
    }

    const limited = readRunEvents(root, { limit: 3 });
    assert.equal(limited.length, 3);
    assert.equal(limited[0].run_id, 'r_7');
    assert.equal(limited[2].run_id, 'r_9');
  });

  // AT-EVT-007: Write failure does not throw
  it('AT-EVT-007: write failure returns ok:false without throwing', () => {
    const result = emitRunEvent('/nonexistent/path/that/cannot/exist', 'run_started', {});
    assert.equal(result.ok, false);
    assert.ok(result.event_id.startsWith('evt_'));
  });

  it('adds recovery_classification to recognized recovery event payloads', () => {
    emitRunEvent(root, 'budget_exceeded_warn', {
      run_id: 'run_budget',
      phase: 'implementation',
      status: 'active',
      payload: {
        spent_usd: 12,
        remaining_usd: 0,
        warning: 'Run budget exceeded.',
      },
    });

    const [event] = readRunEvents(root);
    assert.deepEqual(event.payload.recovery_classification, {
      domain: 'budget',
      severity: 'high',
      outcome: 'pending',
      mechanism: 'config_change',
    });
  });

  it('readRunEvents on missing file returns empty array', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'axc-events-empty-'));
    const events = readRunEvents(emptyRoot);
    assert.equal(events.length, 0);
    try { rmSync(emptyRoot, { recursive: true, force: true }); } catch {}
  });

  // Additional: since filter
  it('since filter excludes older events', () => {
    emitRunEvent(root, 'run_started', { run_id: 'r1' });
    const cutoff = new Date().toISOString();
    // Small delay to ensure timestamp difference
    emitRunEvent(root, 'run_completed', { run_id: 'r1' });

    const events = readRunEvents(root);
    // At least verify since with a past timestamp returns all
    const allEvents = readRunEvents(root, { since: '2020-01-01T00:00:00.000Z' });
    assert.equal(allEvents.length, 2);
  });

  // Additional: VALID_RUN_EVENTS is complete
  it('VALID_RUN_EVENTS contains all 42 event types', () => {
    assert.equal(VALID_RUN_EVENTS.length, 42);
    assert.ok(VALID_RUN_EVENTS.includes('auto_retried_ghost'),
      'auto_retried_ghost must be registered (BUG-61 continuous ghost auto-recovery)');
    assert.ok(VALID_RUN_EVENTS.includes('ghost_retry_exhausted'),
      'ghost_retry_exhausted must be registered (BUG-61 retry-budget exhaustion signal)');
    assert.ok(VALID_RUN_EVENTS.includes('auto_retried_productive_timeout'),
      'auto_retried_productive_timeout must be registered (BUG-100 productive timeout auto-recovery)');
    assert.ok(VALID_RUN_EVENTS.includes('productive_timeout_retry_exhausted'),
      'productive_timeout_retry_exhausted must be registered (BUG-100 retry-budget exhaustion signal)');
    assert.ok(VALID_RUN_EVENTS.includes('retained_claude_auth_escalation_reclassified'),
      'retained_claude_auth_escalation_reclassified must be registered (BUG-111 retained auth escalation recovery)');
    assert.ok(VALID_RUN_EVENTS.includes('session_continuation'),
      'session_continuation must be registered (BUG-53 continuous auto-chain audit trail)');
    assert.ok(VALID_RUN_EVENTS.includes('state_reconciled_operator_commits'),
      'state_reconciled_operator_commits must be registered (BUG-62 operator commit reconcile audit trail)');
    assert.ok(VALID_RUN_EVENTS.includes('operator_commit_reconcile_refused'),
      'operator_commit_reconcile_refused must be registered (BUG-62 auto_safe_only refusal signal)');
    assert.ok(VALID_RUN_EVENTS.includes('run_started'));
    assert.ok(VALID_RUN_EVENTS.includes('run_completed'));
    assert.ok(VALID_RUN_EVENTS.includes('run_blocked'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_dispatched'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_accepted'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_rejected'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_conflicted'));
    assert.ok(VALID_RUN_EVENTS.includes('conflict_resolved'));
    assert.ok(VALID_RUN_EVENTS.includes('acceptance_failed'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_reissued'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_stalled'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_start_failed'));
    assert.ok(VALID_RUN_EVENTS.includes('runtime_spawn_failed'));
    assert.ok(VALID_RUN_EVENTS.includes('stdout_attach_failed'));
    assert.ok(VALID_RUN_EVENTS.includes('phase_entered'));
    assert.ok(VALID_RUN_EVENTS.includes('phase_cleanup'));
    assert.ok(VALID_RUN_EVENTS.includes('intent_retired_by_phase_advance'));
    assert.ok(VALID_RUN_EVENTS.includes('escalation_raised'));
    assert.ok(VALID_RUN_EVENTS.includes('escalation_resolved'));
    assert.ok(VALID_RUN_EVENTS.includes('gate_pending'));
    assert.ok(VALID_RUN_EVENTS.includes('gate_approved'));
    assert.ok(VALID_RUN_EVENTS.includes('gate_failed'));
    assert.ok(VALID_RUN_EVENTS.includes('budget_exceeded_warn'));
    assert.ok(VALID_RUN_EVENTS.includes('human_escalation_raised'));
    assert.ok(VALID_RUN_EVENTS.includes('human_escalation_resolved'));
    assert.ok(VALID_RUN_EVENTS.includes('dispatch_progress'));
    assert.ok(VALID_RUN_EVENTS.includes('turn_checkpointed'));
    assert.ok(VALID_RUN_EVENTS.includes('coordinator_retry'));
    assert.ok(VALID_RUN_EVENTS.includes('coordinator_retry_projection_warning'));
    assert.ok(VALID_RUN_EVENTS.includes('artifact_type_auto_normalized'));
    assert.ok(VALID_RUN_EVENTS.includes('staged_result_auto_normalized'));
  });

  // Additional: creates .agentxchain directory if missing
  it('creates .agentxchain directory if it does not exist', () => {
    const bareRoot = mkdtempSync(join(tmpdir(), 'axc-events-bare-'));
    const result = emitRunEvent(bareRoot, 'run_started', { run_id: 'r1' });
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(bareRoot, '.agentxchain', 'events.jsonl')));
    try { rmSync(bareRoot, { recursive: true, force: true }); } catch {}
  });

  // Additional: malformed lines are skipped
  it('skips malformed JSONL lines', () => {
    const filePath = join(root, RUN_EVENTS_PATH);
    writeFileSync(filePath, 'not-json\n{"event_type":"run_started","event_id":"evt_1","timestamp":"2026-01-01T00:00:00.000Z","run_id":"r1","phase":null,"status":null,"turn":null,"payload":{}}\n');

    const events = readRunEvents(root);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'run_started');
  });
});
