/**
 * BUG-96 beta-tester scenario: after BUG-95 normalizes missing top-level fields,
 * the same tusq.dev dev turn still fails because decisions use
 * { id: "DEV-M44-001", description: "..." } without the required rationale.
 *
 * The normalizer may copy rationale from existing decision text. It must not
 * invent rationale for a decision object with no meaningful source material.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

function createProject(turnResultOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug96-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const roleId = 'dev';
  const runtimeId = 'local-dev';
  const changedFiles = ['src/cli.js', 'tests/smoke.mjs', '.planning/IMPLEMENTATION_NOTES.md'];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug96-cli-test', id: `bug96-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      [roleId]: {
        title: 'Developer',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      qa: {
        title: 'QA',
        mandate: 'Test.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      [runtimeId]: { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-qa': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      implementation: { entry_role: roleId, allowed_next_roles: [roleId, 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', roleId, 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'], requires_verification_pass: true },
      qa_ship_verdict: { requires_files: [], requires_human_approval: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    phase: 'implementation',
    status: 'completed',
    milestone: 'M44',
    milestone_title: 'Static Capability Description Word Count Tier Index',
    decisions: [
      {
        id: 'DEV-M44-001',
        description: 'Implemented description word-count tier thresholds and command dispatch.',
      },
    ],
    objections: [],
    files_modified: changedFiles.map((path) => ({ path, change_type: 'modified' })),
    verification: {
      npm_test: { exit_code: 0, smoke_tests: 'passed' },
    },
    phase_transition_request: 'qa',
    ...turnResultOverrides,
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n`);
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug96@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-96 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n// changed by dev\n`);
  }

  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  const state = {
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        run_id: runId,
        assigned_role: roleId,
        status: 'failed_acceptance',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline: headSha,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { implementation_complete: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: roleId,
  };
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId };
}

describe('BUG-96: decision rationale normalization', () => {
  it('accepts exact cascade: BUG-95 top-level drift plus decision description without rationale', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.match(combined, /Turn Accepted|turn_accepted|Accepted/i, 'Output must confirm acceptance');
  });

  it('copies missing rationale from reason when statement is already present', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Implemented M44.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs', '.planning/IMPLEMENTATION_NOTES.md'],
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
      decisions: [
        {
          id: 'DEC-001',
          category: 'implementation',
          statement: 'Used whitespace tokenization.',
          reason: 'It matches the PM-chartered M44 acceptance contract.',
        },
      ],
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with rationale copied from reason. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('still rejects decisions with no statement or rationale source material', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Implemented M44.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs', '.planning/IMPLEMENTATION_NOTES.md'],
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
      decisions: [{ id: 'DEC-001', category: 'implementation' }],
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, 'accept-turn must reject a decision with no source material');
    assert.match(combined, /decisions\[0\]\.statement/);
    assert.match(combined, /decisions\[0\]\.rationale/);
  });
});
