/**
 * BUG-20 beta-tester scenario: accepted intent-bound turns transition the
 * intent to `completed`.
 *
 * Tester sequence:
 *   1. Scaffold project, start run
 *   2. Inject a p0 intent, approve it, set it to executing state
 *   3. Dispatch a PM turn bound to it (via intakeContext)
 *   4. Accept the turn with a staging result that includes intent_response
 *   5. Verify: intent file shows status 'completed'
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug20-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug20-test', name: 'BUG-20 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the project.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {},
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return { root, config };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function createExecutingIntent(root, intentId, charter) {
  const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
  writeFileSync(intentPath, JSON.stringify({
    intent_id: intentId,
    type: 'planning_revision',
    priority: 'p0',
    status: 'executing',
    charter,
    acceptance_contract: [
      `Address: ${charter}`,
    ],
    source: 'operator',
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    history: [
      { from: 'needs_triage', to: 'approved', at: new Date().toISOString(), by: 'operator' },
      { from: 'approved', to: 'executing', at: new Date().toISOString(), by: 'system' },
    ],
  }, null, 2));
}

function readEvents(root) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  try {
    return readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-20 beta-tester scenario: intent satisfaction lifecycle', () => {
  it('accepted intent-bound turn transitions the intent to completed', () => {
    const { root, config } = createProject();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Create an intent in executing state
    const intentId = `intent_bug20_${Date.now()}`;
    createExecutingIntent(root, intentId, 'Implement caching layer for API responses');

    // 3. Assign a PM turn bound to the intent via intakeContext
    const assignResult = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: intentId,
        charter: 'Implement caching layer for API responses',
        acceptance_contract: [
          'Address: Implement caching layer for API responses',
        ],
      },
    });
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // Verify the turn has intake_context
    const state = readState(root);
    const turn = state.active_turns?.[turnId];
    assert.ok(turn?.intake_context?.intent_id === intentId,
      `Turn should have intake_context.intent_id=${intentId}`);

    // 4. Write dispatch bundle
    writeDispatchBundle(root, state, config, { turnId });

    // 5. Stage turn result with intent_response
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Implemented caching layer for API responses.',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Intent coverage review', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
      intent_response: [
        { item: 'Implement caching layer for API responses', status: 'addressed' },
      ],
    }, null, 2));

    // 6. Accept the turn
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    // 7. KEY ASSERTION: intent file on disk should show 'completed'
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
    const intentData = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(
      intentData.status,
      'completed',
      `Intent status should be 'completed' after accepted turn. Got '${intentData.status}'`,
    );

    // 8. Events should include intent_satisfied or similar lifecycle marker
    const events = readEvents(root);
    const intentEvents = events.filter(e =>
      e.event_type === 'intent_satisfied' ||
      (e.intent_id === intentId && e.event_type === 'turn_accepted'),
    );
    assert.ok(
      intentEvents.length > 0,
      `Should have intent lifecycle events after acceptance. All events: ${JSON.stringify(events.map(e => e.event_type))}`,
    );
  });
});
