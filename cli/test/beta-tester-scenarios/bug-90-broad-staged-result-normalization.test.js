/**
 * BUG-90 beta-tester scenario: dev turn emits staged result with multiple
 * schema deviations simultaneously — wrong status synonym, object-shaped
 * files_changed, non-DEC-NNN decision IDs, missing decision category/statement,
 * missing verification.status, and missing artifact.type.
 *
 * The normalizer must auto-correct all these shapes before schema validation
 * so the turn accepts without manual staging JSON surgery.
 *
 * This is a BUG-79-class extension: the same staged-result field-shape mismatch
 * normalizer table handles all of these fields.
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

function createProject(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug90-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const roleId = 'dev';
  const runtimeId = 'local-dev';
  const changedFiles = ['src/cli.js', 'tests/smoke.mjs'];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug90-cli-test', id: `bug90-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
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
      planning: { entry_role: roleId, allowed_next_roles: [roleId, 'qa', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: roleId, allowed_next_roles: [roleId, 'qa', 'human'] },
    },
    gates: {
      planning_signoff: { type: 'automatic', required: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'complete', // BUG-90: synonym, should be "completed"
    summary: 'Implemented feature X.',
    decisions: [
      {
        id: 'D1', // BUG-90: should be DEC-001
        decision: 'Used approach A', // BUG-90: should be "statement"
        rationale: 'Because reasons.',
        // missing category — BUG-90: should be defaulted
      },
      {
        id: 'D2',
        decision: 'Used approach B',
        rationale: 'Because other reasons.',
      },
    ],
    objections: [],
    files_changed: [ // BUG-90: objects instead of strings
      { path: 'src/cli.js', change_type: 'modified', description: 'Added feature' },
      { path: 'tests/smoke.mjs', change_type: 'modified', description: 'Added tests' },
    ],
    verification: {
      command: 'npm test',
      exit_code: 0,
      stdout_summary: 'All tests passed.',
      // missing status — BUG-90: should be inferred from exit_code
    },
    artifact: {
      milestone: 'M36',
      // missing type — BUG-90: should be inferred from files_changed
    },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    ...overrides,
  };

  // Set up directory structure
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });

  // Write config
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  // Create initial files
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n`);
  }
  writeFileSync(join(root, 'README.md'), '# Test\n');

  // Initialize git
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug90@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-90 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  // Make changed files dirty (simulate dev work)
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n// changed by dev\n`);
  }

  // Write staged result and state
  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  const state = {
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'planning',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: roleId,
        status: 'running',
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
    phase_gate_status: { planning_signoff: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: roleId,
    non_progress_signature: null,
    non_progress_count: 0,
  };
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId, runId, config, turnResult };
}

describe('BUG-90: broad staged-result field-shape normalization', () => {
  it('exact tester reproduction: status "complete", object files_changed, D1/D2 decision ids, missing verification.status and artifact.type', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.match(combined, /Turn Accepted|turn_accepted|Accepted/i, 'Output must confirm acceptance');
  });

  it('normalizes status "complete" to "completed"', () => {
    const { root, turnId } = createProject({ status: 'complete' });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed for status "complete". Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('normalizes status "success" to "completed"', () => {
    const { root, turnId } = createProject({ status: 'success' });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed for status "success". Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('normalizes object-shaped files_changed to path strings', () => {
    const { root, turnId } = createProject({
      status: 'completed',
      files_changed: [
        { path: 'src/cli.js', change_type: 'modified' },
        { path: 'tests/smoke.mjs', change_type: 'added' },
      ],
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with object files_changed. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('normalizes decision ids D1/D2 to DEC-001/DEC-002 and copies decision→statement', () => {
    const { root, turnId } = createProject({
      status: 'completed',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      decisions: [
        { id: 'D1', decision: 'Used approach A', rationale: 'Reasons.' },
        { id: 'D2', decision: 'Used approach B', rationale: 'Other reasons.' },
      ],
      verification: { command: 'npm test', exit_code: 0, status: 'pass' },
      artifact: { type: 'workspace' },
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with D1/D2 decision ids. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('infers verification.status from exit_code', () => {
    const { root, turnId } = createProject({
      status: 'completed',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      decisions: [{ id: 'DEC-001', statement: 'OK', rationale: 'OK', category: 'implementation' }],
      verification: { command: 'npm test', exit_code: 0 },
      artifact: { type: 'workspace' },
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with inferred verification.status. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('infers artifact.type "workspace" when files_changed is non-empty', () => {
    const { root, turnId } = createProject({
      status: 'completed',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      decisions: [{ id: 'DEC-001', statement: 'OK', rationale: 'OK', category: 'implementation' }],
      verification: { command: 'npm test', exit_code: 0, status: 'pass' },
      artifact: { milestone: 'M36' }, // missing type
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with inferred artifact.type. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('valid result passes through unchanged', () => {
    const { root, turnId } = createProject({
      status: 'completed',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      decisions: [{ id: 'DEC-001', statement: 'OK', rationale: 'OK', category: 'implementation' }],
      verification: { command: 'npm test', exit_code: 0, status: 'pass' },
      artifact: { type: 'workspace' },
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed for valid result. Output:\n${result.stdout}\n${result.stderr}`);
  });
});
