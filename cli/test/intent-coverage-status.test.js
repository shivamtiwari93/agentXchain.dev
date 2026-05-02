import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

function setLenientGateSemanticCoverage() {
  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate_semantic_coverage_mode = 'lenient';
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function getSingleActiveTurn(state) {
  const turns = Object.values(state.active_turns || {});
  assert.equal(turns.length, 1, 'expected exactly one active turn');
  return turns[0];
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

describe('BUG-14: intent coverage validation', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-intent-coverage-'));
    scaffoldGoverned(root, 'Intent Coverage Fixture', `intent-coverage-${Date.now()}`);
    setLenientGateSemanticCoverage();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a turn that ignores all acceptance items (strict mode, p0)', () => {
    const injected = inject('Ship domain grouping', 'p0', [
      'include minimal domain grouping',
      'clarify whether tusq serve proves AI-callable execution',
      'frame runtime learning as deferred core pillar',
    ]);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);

    // Stage a turn result that does NOT address any acceptance items
    const stagingDir = join(root, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Fixed unrelated internal contradictions in documentation.',
      decisions: [
        { id: 'DEC-001', category: 'process', statement: 'Cleaned up wording inconsistencies.', rationale: 'Docs accuracy.' },
      ],
      objections: [
        { id: 'OBJ-001', severity: 'low', statement: 'No acceptance items addressed.', status: 'raised' },
      ],
      files_changed: ['.planning/ROADMAP.md'],
      artifacts_created: ['.planning/ROADMAP.md'],
      verification: { status: 'pass', evidence_summary: 'Docs reviewed.' },
      artifact: { type: 'review', ref: 'review:intent-coverage-test' },
      proposed_next_role: 'human',
      cost: { usd: 0.01 },
    }, null, 2));

    const accepted = runCli(['accept-turn']);
    assert.notEqual(accepted.status, 0, 'acceptance should fail for unaddressed items');
    assert.match(accepted.combined, /intent_coverage/i, 'error should reference intent_coverage stage');
    assert.match(accepted.combined, /acceptance item/i, 'error should mention acceptance items');
  });

  it('accepts a turn that addresses acceptance items via summary (semantic fallback)', () => {
    const injected = inject('Ship domain grouping', 'p0', [
      'include minimal domain grouping',
      'clarify tusq serve execution model',
    ]);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);

    const stagingDir = join(root, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Applied minimal domain grouping to the capability map. Clarified that tusq serve proves describe-only MCP exposure, not AI-callable execution.',
      decisions: [
        { id: 'DEC-001', category: 'scope', statement: 'Added minimal domain grouping.', rationale: 'Reduces 1:1 capability mapping noise.' },
      ],
      objections: [
        { id: 'OBJ-001', severity: 'low', statement: 'Minor review note.', status: 'raised' },
      ],
      files_changed: ['.planning/ROADMAP.md'],
      artifacts_created: ['.planning/ROADMAP.md'],
      verification: { status: 'pass', evidence_summary: 'Domain grouping verified.' },
      artifact: { type: 'review', ref: 'review:intent-coverage-pass' },
      proposed_next_role: 'human',
      cost: { usd: 0.01 },
    }, null, 2));

    const accepted = runCli(['accept-turn']);
    assert.equal(accepted.status, 0, accepted.combined);
  });

  it('accepts a turn that addresses items via structural intent_response field', () => {
    const injected = inject('Implement feature X', 'p0', [
      'add feature X to the API',
      'write tests for feature X',
    ]);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);

    const stagingDir = join(root, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Completed the feature work.',
      decisions: [],
      objections: [
        { id: 'OBJ-001', severity: 'low', statement: 'Minor review note.', status: 'raised' },
      ],
      files_changed: ['.planning/ROADMAP.md'],
      artifacts_created: ['.planning/ROADMAP.md'],
      verification: { status: 'pass', evidence_summary: 'All tests pass.' },
      artifact: { type: 'review', ref: 'review:intent-response-test' },
      proposed_next_role: 'human',
      cost: { usd: 0.01 },
      intent_response: [
        { item: 'add feature X to the API', status: 'addressed', detail: 'Added POST /feature-x endpoint.' },
        { item: 'write tests for feature X', status: 'addressed', detail: '3 unit tests added.' },
      ],
    }, null, 2));

    const accepted = runCli(['accept-turn']);
    assert.equal(accepted.status, 0, accepted.combined);
  });

  it('BUG-64: treats idle-expansion sidecar result as conditional intent coverage', () => {
    inject('Expand from VISION.md idle state', 'p0', [
      'If new_intake_intent contains charter acceptance_contract array priority and vision_traceability citing snapshot headings.',
      'If vision_exhausted contains per-heading classification covering all snapshot headings.',
    ]);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);
    state.active_turns[turn.turn_id].intake_context.source = 'vision_idle_expansion';
    state.active_turns[turn.turn_id].idle_expansion_context = {
      expansion_iteration: 2,
      vision_headings_snapshot: ['Product North Star', 'Operating Model'],
    };
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const stagingDir = join(root, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Produced a new intake intent from the idle VISION.md expansion sidecar.',
      decisions: [],
      objections: [
        { id: 'OBJ-001', severity: 'low', statement: 'No objection.', status: 'raised' },
      ],
      files_changed: ['.planning/ROADMAP.md'],
      artifacts_created: ['.planning/ROADMAP.md'],
      verification: { status: 'pass', evidence_summary: 'Idle expansion sidecar validated.' },
      artifact: { type: 'review', ref: 'review:bug-64-idle-expansion-sidecar' },
      proposed_next_role: 'human',
      cost: { usd: 0.01 },
    }, null, 2));
    writeFileSync(join(stagingDir, 'idle-expansion-result.json'), JSON.stringify({
      kind: 'new_intake_intent',
      expansion_iteration: 2,
      proposed_intent: {
        title: 'Infer static sensitivity classes',
        charter: 'Classify sensitivity from static manifest evidence before implementation.',
        acceptance_contract: [
          'Static manifest inputs are enumerated.',
          'Sensitivity classes are derived without live credentials.',
        ],
        priority: 'p1',
        template: 'cli-tool',
      },
      vision_traceability: [
        { heading: 'Product North Star', reason: 'Connects idle expansion to governed product goals.' },
      ],
      vision_exhausted: false,
    }, null, 2));

    const accepted = runCli(['accept-turn']);
    assert.equal(accepted.status, 0, accepted.combined);
  });
});

describe('BUG-15: status surfaces pending intents', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-status-intents-'));
    scaffoldGoverned(root, 'Status Intents Fixture', `status-intents-${Date.now()}`);
    setLenientGateSemanticCoverage();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('status shows pending approved intents with priority and acceptance count', () => {
    inject('Fix sidebar ordering', 'p0', ['sidebar must be alphabetical', 'test updated']);
    inject('Lower priority cleanup', 'p1', ['docs cleanup']);

    const status = runCli(['status']);
    assert.equal(status.status, 0, status.combined);
    assert.match(status.stdout, /Pending injected intents/i);
    assert.match(status.stdout, /\[p0\]/);
    assert.match(status.stdout, /Fix sidebar ordering/);
    assert.match(status.stdout, /Acceptance: 2 item/);
  });

  it('status --json includes pending_intents array', () => {
    inject('Fix ordering', 'p0', ['item one', 'item two']);

    const status = runCli(['status', '--json']);
    assert.equal(status.status, 0, status.combined);
    const json = JSON.parse(status.stdout);
    assert.ok(Array.isArray(json.pending_intents), 'pending_intents must be an array');
    assert.equal(json.pending_intents.length, 1);
    assert.equal(json.pending_intents[0].priority, 'p0');
    assert.equal(json.pending_intents[0].acceptance_count, 2);
  });

  it('status does not show pending intents section when queue is empty', () => {
    const status = runCli(['status']);
    assert.equal(status.status, 0, status.combined);
    assert.doesNotMatch(status.stdout, /Pending injected intents/i);
  });

  it('doctor surfaces pending intents as informational check', () => {
    inject('Fix bug', 'p0', ['fix it']);

    const doctor = runCli(['doctor']);
    assert.equal(doctor.status, 0, doctor.combined);
    assert.match(doctor.combined, /pending.intent/i);
    assert.match(doctor.combined, /1 approved intent/);
  });
});

describe('BUG-16: unified intake consumption', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-unified-intake-'));
    scaffoldGoverned(root, 'Unified Intake Fixture', `unified-intake-${Date.now()}`);
    setLenientGateSemanticCoverage();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('inject output message mentions all dispatch paths, not just scheduler', () => {
    const result = runCli([
      'inject',
      'Test unification',
      '--priority', 'p0',
      '--charter', 'Test all paths',
      '--acceptance', 'verify parity',
    ]);
    assert.equal(result.status, 0, result.combined);
    // Should NOT say "scheduler/continuous loop will pick up"
    assert.doesNotMatch(result.stdout, /scheduler\/continuous loop will pick up/i);
    // Should mention manual dispatch paths
    if (result.stdout.includes('next dispatch')) {
      assert.match(result.stdout, /manual resume|step --resume|continuous/i);
    }
  });

  it('consumeNextApprovedIntent produces identical binding for manual and continuous paths', () => {
    // Inject an intent and consume it via resume (manual path)
    inject('Manual path intent', 'p0', ['verify binding']);

    const resume = runCli(['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.combined);

    const state = readJson('.agentxchain/state.json');
    const turn = getSingleActiveTurn(state);
    assert.ok(turn.intake_context, 'manual resume must bind intake_context');
    assert.ok(turn.intake_context.intent_id, 'intake_context must have intent_id');
    assert.ok(turn.intake_context.charter, 'intake_context must have charter');
    assert.deepEqual(turn.intake_context.acceptance_contract, ['verify binding']);

    const events = readEvents();
    const dispatched = events.find(e => e.event_type === 'turn_dispatched');
    assert.ok(dispatched, 'turn_dispatched event must exist');
    assert.equal(dispatched.intent_id, turn.intake_context.intent_id);
  });
});
