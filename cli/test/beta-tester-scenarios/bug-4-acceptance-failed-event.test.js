/**
 * BUG-4 beta-tester scenario: acceptance_failed event must be emitted to events.jsonl
 *
 * When acceptance fails, an `acceptance_failed` event must be written to
 * .agentxchain/events.jsonl with a reference to the failing turn.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug4-test', name: 'BUG-4 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', 'dev'], prompt_transport: 'dispatch_bundle_only' } },
    phases: [{ id: 'implementation', name: 'Implementation' }],
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug4-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

function readEvents(root) {
  try {
    return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-4 beta-tester scenario: acceptance_failed event emission', () => {
  it('events.jsonl contains acceptance_failed event when acceptance fails', () => {
    const config = makeConfig();
    const root = createProject(config);

    initializeGovernedRun(root, config);
    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok);
    const turnId = assign.turn.turn_id;

    const state = readState(root);
    writeDispatchBundle(root, state, config, { turnId });

    // Stage an INVALID turn result (wrong run_id) to trigger acceptance failure
    writeFileSync(join(root, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: 'WRONG-RUN-ID',
      turn_id: turnId,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Invalid result.',
      decisions: [],
      objections: [],
      files_changed: ['nonexistent-file.js'],
      verification: { status: 'skipped' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'dev',
    }, null, 2));

    // Attempt to accept — should fail
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: join(root, '.agentxchain', 'staging', 'turn-result.json'),
    });

    // KEY ASSERTION: acceptance_failed event must exist
    const events = readEvents(root);
    const failEvents = events.filter(e => e.event_type === 'acceptance_failed');

    assert.ok(failEvents.length > 0,
      `acceptance_failed event must be emitted. Events: ${events.map(e => e.event_type).join(', ')}`);

    // Verify it references the correct turn (in event.turn.turn_id)
    const failEvent = failEvents[0];
    const eventTurnId = failEvent.turn?.turn_id || failEvent.turn_id;
    assert.equal(eventTurnId, turnId,
      `acceptance_failed event must reference turn ${turnId}. Got: ${eventTurnId}`);
  });
});
