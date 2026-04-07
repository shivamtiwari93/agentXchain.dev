import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  parseContextSections,
  renderContextSections,
} from '../src/lib/context-section-parser.js';
import { writeDispatchBundle, getDispatchTurnDir } from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-context-parser-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

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

function makeNormalizedConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement approved work safely.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Challenge correctness.', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function getSection(sections, id) {
  return sections.find((section) => section.id === id);
}

describe('context-section-parser', () => {
  it('parses all defined section ids and round-trips a complete context document', () => {
    const contextMd = [
      '# Execution Context',
      '',
      '## Current State',
      '',
      '- **Run:** run_123',
      '- **Status:** active',
      '- **Phase:** qa',
      '- **Integration ref:** git:abc123',
      '- **Budget spent:** $12.34',
      '- **Budget remaining:** $37.66',
      '',
      '## Last Accepted Turn',
      '',
      '- **Turn:** turn_456',
      '- **Role:** pm',
      '- **Summary:** Defined MVP scope and froze the release gate.',
      '- **Decisions:**',
      '  - DEC-001: Freeze the API surface.',
      '  - DEC-002: Defer plugin hooks to post-v1.',
      '- **Objections:**',
      '  - OBJ-001 (medium): Retry policy needs operator messaging.',
      '',
      '## Blockers',
      '',
      '- **Blocked on:** escalation:retries-exhausted:qa',
      '',
      '## Escalation',
      '',
      '- **From:** qa',
      '- **Reason:** retries_exhausted',
      '',
      '## Gate Required Files',
      '',
      '- `.planning/ship-verdict.md` — exists',
      '- `.planning/acceptance-matrix.md` — MISSING',
      '',
      '## Phase Gate Status',
      '',
      '- `qa_ship_verdict`: pending',
      '',
      '',
    ].join('\n');

    const sections = parseContextSections(contextMd);

    assert.deepEqual(
      sections.map((section) => section.id),
      [
        'current_state',
        'budget',
        'last_turn_header',
        'last_turn_summary',
        'last_turn_decisions',
        'last_turn_objections',
        'blockers',
        'escalation',
        'gate_required_files',
        'phase_gate_status',
      ]
    );
    assert.equal(getSection(sections, 'current_state').required, true);
    assert.equal(getSection(sections, 'budget').required, false);
    assert.equal(getSection(sections, 'last_turn_header').required, true);
    assert.equal(getSection(sections, 'blockers').required, true);
    assert.equal(getSection(sections, 'phase_gate_status').required, false);
    assert.match(getSection(sections, 'budget').content, /Budget spent/);
    assert.doesNotMatch(getSection(sections, 'current_state').content, /Budget spent/);
    assert.match(getSection(sections, 'last_turn_decisions').content, /DEC-001/);
    assert.match(getSection(sections, 'last_turn_objections').content, /OBJ-001/);

    assert.equal(renderContextSections(sections), contextMd);
  });

  it('handles missing conditional sections without inventing empty nodes', () => {
    const contextMd = [
      '# Execution Context',
      '',
      '## Current State',
      '',
      '- **Run:** run_123',
      '- **Status:** active',
      '- **Phase:** planning',
      '- **Integration ref:** none',
      '',
      '',
    ].join('\n');

    const sections = parseContextSections(contextMd);

    assert.deepEqual(sections.map((section) => section.id), ['current_state']);
    assert.equal(renderContextSections(sections), contextMd);
  });

  it('extracts nested last-turn sections without leaking summary or decisions into the header block', () => {
    const contextMd = [
      '# Execution Context',
      '',
      '## Current State',
      '',
      '- **Run:** run_123',
      '- **Status:** active',
      '- **Phase:** implementation',
      '- **Integration ref:** git:abc123',
      '',
      '## Last Accepted Turn',
      '',
      '- **Turn:** turn_456',
      '- **Role:** qa',
      '- **Summary:** Review completed with one follow-up issue.',
      '- **Decisions:**',
      '  - DEC-010: Keep the adapter contract stable.',
      '- **Objections:**',
      '  - OBJ-004 (low): Tighten CLI copy.',
      '',
      '',
    ].join('\n');

    const sections = parseContextSections(contextMd);

    assert.deepEqual(
      sections.map((section) => section.id),
      [
        'current_state',
        'last_turn_header',
        'last_turn_summary',
        'last_turn_decisions',
        'last_turn_objections',
      ]
    );
    assert.match(getSection(sections, 'last_turn_header').content, /\*\*Turn:\*\*/);
    assert.match(getSection(sections, 'last_turn_header').content, /\*\*Role:\*\*/);
    assert.doesNotMatch(getSection(sections, 'last_turn_header').content, /\*\*Summary:\*\*/);
    assert.match(getSection(sections, 'last_turn_summary').content, /\*\*Summary:\*\*/);
    assert.match(getSection(sections, 'last_turn_decisions').content, /^- \*\*Decisions:\*\*\n  - DEC-010:/);
    assert.match(getSection(sections, 'last_turn_objections').content, /^- \*\*Objections:\*\*\n  - OBJ-004/);
    assert.equal(renderContextSections(sections), contextMd);
  });
});

describe('context-section-parser integration with dispatch bundle rendering', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('round-trips the current orchestrator-generated CONTEXT.md without drift', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    let state = readJson(root, STATE_PATH);

    const turnResult = {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: state.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Defined MVP scope.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Focus on core workflow.', rationale: 'User value.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No concerns.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review complete.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      run_completion_request: null,
      needs_human_reason: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };

    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(turnResult));
    assert.equal(acceptGovernedTurn(root, config).ok, true);

    state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    state.blocked_on = 'escalation:retries-exhausted:qa';
    state.escalation = { from_role: 'qa', reason: 'retries_exhausted' };
    state.phase_gate_status = { qa_ship_verdict: 'pending' };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assert.equal(assignGovernedTurn(root, config, 'qa').ok, true);
    state = readJson(root, STATE_PATH);

    assert.equal(writeDispatchBundle(root, state, config).ok, true);

    const contextMd = readFileSync(join(root, getDispatchTurnDir(state.current_turn.turn_id), 'CONTEXT.md'), 'utf8');
    const sections = parseContextSections(contextMd);

    assert.ok(sections.length >= 8);
    // Normalize consecutive blank lines: the parser trims trailing blanks from
    // section bodies, so a content-internal double-blank (e.g. between code blocks
    // in Gate Required Files) may collapse to a single blank on round-trip.
    const normalize = (s) => s.replace(/\n{3,}/g, '\n\n');
    assert.equal(normalize(renderContextSections(sections)), normalize(contextMd));
  });
});
