/**
 * BUG-85 beta-tester scenario: roadmap replenishment must not require PM to
 * cover every unplanned VISION heading in one acceptance item.
 *
 * Reproduction class:
 *   A valid PM turn added M30 from VISION.md "The Promise", but accept-turn
 *   failed because the generated contract item listed the entire unplanned
 *   VISION backlog and required 50% keyword coverage.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seedFromVision } from '../../src/lib/continuous-run.js';

const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function writeBaseProject(root, { withTurn = false } = {}) {
  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const intentId = `intent_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug85-cli-test', id: `bug85-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Bind roadmap increments from vision.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-pm', runtime: 'local-pm' },
      dev: { title: 'Developer', mandate: 'Implement planned work.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev', runtime: 'local-dev' },
    },
    runtimes: {
      'local-pm': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'strict',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(root, 'README.md'), '# BUG-85 fixture\n');
  writeFileSync(join(root, '.planning', 'ROADMAP.md'), [
    '# Roadmap',
    '',
    '### M29: Static Auth Requirements Inference from Manifest Evidence (~0.5 day) — SHIPPED V1.10',
    '- [x] Implement auth requirements inference',
    '- [x] Add auth filter smoke coverage',
    '',
  ].join('\n'));
  writeFileSync(join(root, '.planning', 'VISION.md'), [
    '# Vision',
    '',
    '## The Promise',
    '',
    '- embeddable chat, widget, command-palette, and voice surfaces',
    '',
    '## Code And API Surface',
    '',
    '- API surface inventory and generated endpoint contracts',
    '',
    '## Database, Warehouse, And Data Model',
    '',
    '- database schema understanding and warehouse model export',
    '',
    '## Frontend, Design System, And Product UX',
    '',
    '- frontend component inventory and design-system mapping',
    '',
    '## Domain Model And Workflows',
    '',
    '- domain workflow inference and action catalog generation',
    '',
    '## Public Docs And Market-Facing Truth',
    '',
    '- public docs generation from real product state',
    '',
  ].join('\n'));

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug85@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-85 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add README.md agentxchain.json .gitignore .planning', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  const baseline = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  if (withTurn) {
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), [
      '# Roadmap',
      '',
      '### M29: Static Auth Requirements Inference from Manifest Evidence (~0.5 day) — SHIPPED V1.10',
      '- [x] Implement auth requirements inference',
      '- [x] Add auth filter smoke coverage',
      '',
      '### M30: Static Embeddable-Surface Plan Export from Manifest Evidence (~0.75 day) — V1.11 (PROPOSED)',
      '',
      '> VISION source: .planning/VISION.md The Promise; embeddable surfaces.',
      '',
      '- [ ] Add `tusq surface plan` command shape',
      '- [ ] Add deterministic surface eligibility plan output',
      '',
    ].join('\n'));
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nM30 charter-bound from VISION.md The Promise.\n');

    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
      schema_version: '1.1',
      run_id: runId,
      project_id: config.project.id,
      status: 'active',
      phase: 'planning',
      accepted_integration_ref: `git:${baseline}`,
      active_turns: {
        [turnId]: {
          turn_id: turnId,
          run_id: runId,
          assigned_role: 'pm',
          status: 'running',
          attempt: 1,
          started_at: new Date().toISOString(),
          runtime_id: 'local-pm',
          assigned_sequence: 1,
          baseline,
          intake_context: {
            intent_id: intentId,
            source: 'vision_scan',
            category: 'roadmap_exhausted_vision_open',
            charter: '[roadmap-replenishment] Derive next bounded roadmap increment from VISION.md. Unplanned scope: The Promise, Code And API Surface, Database, Warehouse, And Data Model, Frontend, Design System, And Product UX, Domain Model And Workflows, Public Docs And Market-Facing Truth.',
            acceptance_contract: [
              'New unchecked milestone items added to .planning/ROADMAP.md',
              'Milestone scope derived from VISION.md sections: The Promise, Code And API Surface, Database, Warehouse, And Data Model, Frontend, Design System, And Product UX, Domain Model And Workflows, Public Docs And Market-Facing Truth',
              'Milestone is bounded, testable, and does not duplicate existing checked milestones',
            ],
            phase_scope: 'planning',
          },
        },
      },
      turn_sequence: 1,
      last_completed_turn_id: null,
      blocked_on: null,
      blocked_reason: null,
      escalation: null,
      phase_gate_status: {},
      budget_reservations: {},
    }, null, 2));
    writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
      intent_id: intentId,
      event_id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      status: 'executing',
      source: 'vision_scan',
      category: 'roadmap_exhausted_vision_open',
      charter: '[roadmap-replenishment] Derive next bounded roadmap increment from VISION.md. Unplanned scope: The Promise, Code And API Surface, Database, Warehouse, And Data Model, Frontend, Design System, And Product UX, Domain Model And Workflows, Public Docs And Market-Facing Truth.',
      acceptance_contract: [
        'New unchecked milestone items added to .planning/ROADMAP.md',
        'Milestone scope derived from VISION.md sections: The Promise, Code And API Surface, Database, Warehouse, And Data Model, Frontend, Design System, And Product UX, Domain Model And Workflows, Public Docs And Market-Facing Truth',
        'Milestone is bounded, testable, and does not duplicate existing checked milestones',
      ],
      priority: 'p1',
      template: 'generic',
      phase_scope: 'planning',
      preferred_role: 'pm',
      history: [{ from: 'approved', to: 'executing', role: 'pm', at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, null, 2));
    writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
    writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
    writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');

    writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: runId,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'local-pm',
      status: 'completed',
      summary: "Bound M30 from VISION.md 'The Promise' embeddable surfaces into ROADMAP.md as new unchecked milestone items; the milestone is bounded, testable, and does not duplicate existing checked milestones.",
      decisions: [
        {
          id: 'DEC-001',
          category: 'scope',
          statement: "Bound M30 as Static Embeddable-Surface Plan Export from VISION.md 'The Promise'.",
          rationale: 'This is a single bounded milestone, not an attempt to cover the whole VISION backlog.',
        },
      ],
      objections: [],
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md'],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['git diff -- .planning/ROADMAP.md .planning/PM_SIGNOFF.md'],
        evidence_summary: 'Planning diff inspected.',
        machine_evidence: [{ command: 'git diff -- .planning/ROADMAP.md .planning/PM_SIGNOFF.md', exit_code: 0 }],
      },
      artifact: { type: 'workspace', ref: 'git:dirty' },
      proposed_next_role: 'dev',
      phase_transition_request: null,
      run_completion_request: null,
      needs_human_reason: null,
      cost: { usd: 0 },
    }, null, 2));
  } else {
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
      schema_version: '1.1',
      run_id: 'run_completed',
      project_id: config.project.id,
      status: 'completed',
      phase: 'launch',
      active_turns: {},
      turn_sequence: 0,
      phase_gate_status: {
        planning_signoff: 'passed',
        implementation_complete: 'passed',
        qa_ship_verdict: 'passed',
        launch_ready: 'passed',
      },
    }, null, 2));
    writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
    writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
    writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  }

  return { root, turnId };
}

function createProject(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug85-'));
  tempDirs.push(root);
  return writeBaseProject(root, options);
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('BUG-85: VISION roadmap-replenishment acceptance scoping', () => {
  it('accept-turn accepts a legacy broad VISION-section item when PM cites one concrete VISION section', () => {
    const { root, turnId } = createProject({ withTurn: true });
    const accept = runCli(root, ['accept-turn', '--turn', turnId]);

    assert.equal(accept.status, 0, `legacy broad traceability item must accept:\n${accept.stdout}\n${accept.stderr}`);
    assert.match(accept.stdout, /Turn Accepted/);

    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    assert.equal(history.at(-1).role, 'pm');
    assert.match(history.at(-1).summary, /The Promise/);
  });

  it('new roadmap-replenishment intents do not put the full VISION backlog in one acceptance item', () => {
    const { root } = createProject();
    const result = seedFromVision(root, join(root, '.planning', 'VISION.md'), { triageApproval: 'auto' });

    assert.equal(result.ok, true, `seedFromVision must succeed: ${result.error || ''}`);
    assert.equal(result.idle, false, 'exhausted roadmap with open vision must seed replenishment');

    const intents = readdirSync(join(root, '.agentxchain', 'intake', 'intents'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', name), 'utf8')));
    const replenishment = intents.find((intent) => /^\[roadmap-replenishment\]/.test(intent.charter || ''));

    assert.ok(replenishment, `expected roadmap-replenishment intent, got ${intents.map((intent) => intent.charter).join('; ')}`);
    assert.ok(
      replenishment.acceptance_contract.includes('Milestone cites at least one concrete VISION.md source section from the unplanned backlog'),
      `expected scoped traceability item, got ${JSON.stringify(replenishment.acceptance_contract)}`,
    );
    assert.ok(
      !replenishment.acceptance_contract.some((item) => /The Promise, Code And API Surface, Database, Warehouse/.test(item)),
      `acceptance contract must not contain the full VISION backlog: ${JSON.stringify(replenishment.acceptance_contract)}`,
    );
    assert.match(replenishment.charter, /\(\+1 more\)|Candidate pool:/,
      'charter may summarize the candidate pool but should not use it as an acceptance obligation');
  });
});
