/**
 * Rejection Event Payload Enrichment Tests
 *
 * Validates that turn_rejected events in events.jsonl carry rejection details
 * (reason, failed_stage, validation_errors) instead of opaque payloads.
 *
 * DEC-REJECTION-EVENT-001
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  rejectGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { readRunEvents } from '../src/lib/run-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(__dirname, '..', '..', 'examples', 'governed-todo-app');

function readJson(root, relPath) {
  const parsed = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (relPath === STATE_PATH || relPath.endsWith('state.json')) {
    const normalized = normalizeGovernedStateShape(parsed).state;
    Object.defineProperty(normalized, 'current_turn', {
      configurable: true,
      enumerable: false,
      get() {
        return getActiveTurn(normalized);
      },
    });
    return normalized;
  }
  return parsed;
}

function stageTurnResult(root, state) {
  const result = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Turn completed.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'ok', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify(result, null, 2));
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'], requires_human_approval: true },
      implementation_complete: { requires_files: ['.planning/IMPL.md'], requires_verification_pass: true },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeRoot() {
  const root = join(tmpdir(), `axc-reject-evt-${randomBytes(6).toString('hex')}`);
  cpSync(EXAMPLE_DIR, root, { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync('git -c user.name="test" -c user.email="test@test" commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

describe('turn_rejected event payload enrichment', () => {
  const config = makeConfig();

  it('turn_rejected event carries reason, failed_stage, and validation_errors on retry', () => {
    const root = makeRoot();
    try {
      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

      stageTurnResult(root, readJson(root, STATE_PATH));

      const validation = {
        valid: false,
        errors: ['Missing required field: schema_version'],
        failed_stage: 'schema',
      };
      const rejectResult = rejectGovernedTurn(root, config, validation, 'Schema mismatch');
      assert.ok(rejectResult.ok, `reject failed: ${rejectResult.error}`);
      assert.equal(rejectResult.escalated, false);

      const events = readRunEvents(root);
      const rejectionEvents = events.filter(e => e.event_type === 'turn_rejected');
      assert.equal(rejectionEvents.length, 1, 'Expected exactly 1 turn_rejected event');

      const evt = rejectionEvents[0];
      assert.equal(evt.payload.retrying, true);
      assert.equal(evt.payload.attempt, 1);
      assert.equal(evt.payload.reason, 'Schema mismatch');
      assert.equal(evt.payload.failed_stage, 'schema');
      assert.ok(Array.isArray(evt.payload.validation_errors));
      assert.equal(evt.payload.validation_errors[0], 'Missing required field: schema_version');
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });

  it('turn_rejected event carries reason on escalation (retries exhausted)', () => {
    const root = makeRoot();
    try {
      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);
      const turnId = assignResult.state.current_turn.turn_id;

      const validation = { valid: false, errors: ['err'], failed_stage: 'validation' };

      // Reject twice to exhaust retries (max_turn_retries: 2 means attempts 1 and 2 can retry)
      stageTurnResult(root, readJson(root, STATE_PATH));
      rejectGovernedTurn(root, config, validation, 'First failure', { turnId });

      stageTurnResult(root, readJson(root, STATE_PATH));
      const finalReject = rejectGovernedTurn(root, config,
        { valid: false, errors: ['critical', 'fatal'], failed_stage: 'content' },
        'Final failure', { turnId });

      assert.ok(finalReject.ok);
      assert.equal(finalReject.escalated, true);

      const events = readRunEvents(root);
      const rejectionEvents = events.filter(e => e.event_type === 'turn_rejected');
      const escalationEvent = rejectionEvents.find(e => e.payload.escalated === true);

      assert.ok(escalationEvent, 'Expected an escalated turn_rejected event');
      assert.equal(escalationEvent.payload.retrying, false);
      assert.equal(escalationEvent.payload.reason, 'Final failure');
      assert.equal(escalationEvent.payload.failed_stage, 'content');
      assert.deepEqual(escalationEvent.payload.validation_errors, ['critical', 'fatal']);
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });

  it('turn_rejected event omits validation_errors when empty', () => {
    const root = makeRoot();
    try {
      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

      stageTurnResult(root, readJson(root, STATE_PATH));
      rejectGovernedTurn(root, config,
        { valid: false, errors: [], failed_stage: 'human_review' },
        'Operator override');

      const events = readRunEvents(root);
      const rejectionEvents = events.filter(e => e.event_type === 'turn_rejected');
      const lastReject = rejectionEvents[rejectionEvents.length - 1];

      assert.equal(lastReject.payload.reason, 'Operator override');
      assert.equal(lastReject.payload.failed_stage, 'human_review');
      assert.equal(lastReject.payload.validation_errors, undefined, 'Empty validation_errors should be omitted');
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });
});
