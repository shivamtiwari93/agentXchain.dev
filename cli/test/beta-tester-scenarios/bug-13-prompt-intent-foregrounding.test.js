/**
 * BUG-13 beta-tester scenario: dispatch bundle PROMPT.md must embed the
 * approved intent charter as the primary instruction.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { injectIntent, approveIntent, consumeNextApprovedIntent } from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug13-test', name: 'BUG-13 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug13-test', name: 'BUG-13 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug13-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeRawConfig(), null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-13 beta-tester scenario: PROMPT.md embeds intent charter', () => {
  it('dispatch bundle PROMPT.md contains the approved intent charter and acceptance items', () => {
    const config = makeConfig();
    const root = createProject(config);

    initializeGovernedRun(root, config);

    // Inject + approve intent
    const inject = injectIntent(root, 'Review the API architecture thoroughly', {
      priority: 'p0',
      charter: 'Review the API architecture thoroughly',
      acceptance: 'Verify endpoint naming,Check auth flow',
    });
    assert.ok(inject.ok);
    if (inject.intent.status !== 'approved') approveIntent(root, inject.intent.intent_id);

    // Consume — internally assigns the turn via startIntent
    const consumed = consumeNextApprovedIntent(root, { role: 'pm' });
    assert.ok(consumed && consumed.ok, `consumeNextApprovedIntent must succeed: ${JSON.stringify(consumed)}`);

    const state = readState(root);
    const turn = getActiveTurn(state);
    writeDispatchBundle(root, state, config, { turnId: turn.turn_id });

    // Find and read PROMPT.md
    const dispatchDir = join(root, '.agentxchain', 'dispatch', 'turns', turn.turn_id);
    const promptPath = join(dispatchDir, 'PROMPT.md');
    assert.ok(existsSync(promptPath), `PROMPT.md must exist at ${promptPath}`);

    const prompt = readFileSync(promptPath, 'utf8');
    assert.ok(
      prompt.includes('Active Injected Intent') || prompt.includes('Injected Intent'),
      `PROMPT.md must contain intent header. Got:\n${prompt.slice(0, 500)}`,
    );
    assert.ok(
      prompt.includes('Verify endpoint naming') || prompt.includes('endpoint naming'),
      'PROMPT.md must contain acceptance items',
    );
  });
});
