import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');

let root;

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function getSingleActiveTurn(state) {
  const turns = Object.values(state.active_turns || {});
  assert.equal(turns.length, 1, 'expected exactly one active turn');
  return turns[0];
}

function stageCompletedTurnResult(state, turn) {
  const stagingDir = join(root, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Addressed the injected intent contract.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'process',
        statement: 'Fulfilled the queued injected charter.',
        rationale: 'Manual resume intake binding must carry intent provenance through acceptance.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'The injected intent is satisfied, but final human planning signoff is still required.',
        status: 'raised',
      },
    ],
    files_changed: ['.planning/ROADMAP.md'],
    artifacts_created: ['.planning/ROADMAP.md'],
    verification: {
      status: 'pass',
      evidence_summary: 'Manual fixture verified the queued intent path.',
    },
    artifact: {
      type: 'review',
      ref: 'review:intake-manual-resume-test',
    },
    proposed_next_role: 'human',
    cost: {
      usd: 0.01,
    },
  }, null, 2));
}

function inject(charter, priority = 'p0', acceptance = ['first item', 'second item']) {
  const result = runCli([
    'inject',
    charter,
    '--priority', priority,
    '--charter', charter,
    '--acceptance', acceptance.join(','),
    '--json',
  ]);
  assert.equal(result.status, 0, result.combined);
  return JSON.parse(result.stdout);
}

function readEvents() {
  return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('manual resume intake binding', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-intake-manual-resume-'));
    scaffoldGoverned(root, 'Manual Resume Intake Fixture', `manual-resume-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('binds the highest-priority queued intent to the next manual resume turn and foregrounds it in the dispatch bundle', () => {
    const lower = inject('Handle lower-priority cleanup', 'p1', ['cleanup docs']);
    const higher = inject('Ship the injected PM charter', 'p0', [
      'address the injected charter directly',
      'preserve the acceptance contract in the prompt',
    ]);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);
    assert.match(resume.stdout, new RegExp(`Bound approved intent to next turn: ${higher.intent_id}`));
    assert.doesNotMatch(resume.stdout, new RegExp(lower.intent_id));

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);
    assert.ok(turn, 'resume must assign a turn');
    assert.equal(turn.assigned_role, 'pm');
    assert.equal(turn.intake_context.intent_id, higher.intent_id);
    assert.equal(turn.intake_context.charter, 'Ship the injected PM charter');
    assert.deepEqual(turn.intake_context.acceptance_contract, [
      'address the injected charter directly',
      'preserve the acceptance contract in the prompt',
    ]);

    const dispatchDir = join('.agentxchain', 'dispatch', 'turns', turn.turn_id);
    const assignment = readJson(join(dispatchDir, 'ASSIGNMENT.json'));
    assert.equal(assignment.intake_context.intent_id, higher.intent_id);

    const prompt = readFileSync(join(root, dispatchDir, 'PROMPT.md'), 'utf8');
    assert.match(prompt, /### Active Injected Intent — respond to this as your primary charter/);
    assert.match(prompt, /Ship the injected PM charter/);
    assert.match(prompt, /1\. address the injected charter directly/);
    assert.match(prompt, /2\. preserve the acceptance contract in the prompt/);

    const events = readEvents();
    const dispatched = events.find((entry) => entry.event_type === 'turn_dispatched');
    assert.ok(dispatched, 'turn_dispatched event must exist');
    assert.equal(dispatched.intent_id, higher.intent_id);

    stageCompletedTurnResult(state, turn);
    const accepted = runCli(['accept-turn']);
    assert.equal(accepted.status, 0, accepted.combined);

    const postAcceptEvents = readEvents();
    const acceptedEvent = postAcceptEvents.find((entry) => entry.event_type === 'turn_accepted');
    assert.ok(acceptedEvent, 'turn_accepted event must exist');
    assert.equal(acceptedEvent.intent_id, higher.intent_id);

    const historyEntries = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const acceptedHistory = historyEntries.at(-1);
    assert.equal(acceptedHistory.intent_id, higher.intent_id);

    const renderedEvents = runCli(['events']);
    assert.equal(renderedEvents.status, 0, renderedEvents.combined);
    assert.match(renderedEvents.stdout, new RegExp(`intent=${higher.intent_id}`));
  });

  it('supports operator override with --no-intent', () => {
    const injected = inject('Do not bind me automatically', 'p0', ['leave queue untouched']);

    const resume = runCli(['resume', '--role', 'pm', '--no-intent']);
    assert.equal(resume.status, 0, resume.combined);
    assert.doesNotMatch(resume.stdout, /Bound approved intent/);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);
    assert.equal(turn.assigned_role, 'pm');
    assert.equal(turn.intake_context, undefined);

    const intent = readJson(join('.agentxchain', 'intake', 'intents', `${injected.intent_id}.json`));
    assert.equal(intent.status, 'approved', 'intent must remain queued when --no-intent is used');
  });
});
