/**
 * BUG-95 beta-tester scenario: dev turn emits staged result with synonym
 * field names and missing required top-level fields — files_modified instead
 * of files_changed, missing runtime_id, missing summary, missing artifact
 * object, and missing proposed_next_role.
 *
 * The normalizer must auto-correct all these shapes before schema validation
 * so the turn accepts without manual staging JSON surgery.
 *
 * This is a BUG-79/90/94 class extension: the same staged-result field-shape
 * mismatch normalizer table handles all of these fields.
 */

import { afterEach, describe, it } from 'vitest';
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

function createProject(turnResultOverrides = {}, stateOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug95-'));
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
    project: { name: 'bug95-cli-test', id: `bug95-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      [roleId]: {
        title: 'Developer',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      pm: {
        title: 'PM',
        mandate: 'Plan.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-pm',
        runtime: 'local-pm',
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
      'local-pm': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-qa': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', roleId, 'qa', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: roleId, allowed_next_roles: [roleId, 'pm', 'qa', 'human'] },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', roleId, 'pm', 'human'] },
      launch: { entry_role: 'pm', allowed_next_roles: ['pm', roleId, 'qa', 'human'] },
    },
    gates: {
      planning_signoff: { type: 'automatic', required: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  // BUG-95: exact tester reproduction — uses files_modified, omits runtime_id,
  // summary, artifact, proposed_next_role
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
      { id: 'DEC-001', statement: 'Used approach A', rationale: 'Because reasons.', category: 'implementation' },
    ],
    objections: [],
    files_modified: [ // BUG-95: should be files_changed
      { path: 'src/cli.js', change_type: 'modified', description: 'Added feature' },
      { path: 'tests/smoke.mjs', change_type: 'modified', description: 'Added tests' },
    ],
    verification: {
      npm_test: { exit_code: 0, smoke_tests: 'passed' },
      module_load: { command: 'node -e "console.log(1)"', exit_code: 0 },
    },
    phase_transition_request: 'qa',
    run_completion_request: false,
    needs_human_reason: null,
    // MISSING: runtime_id, summary, artifact, proposed_next_role
    ...turnResultOverrides,
  };

  // Set up directory structure
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n`);
  }
  writeFileSync(join(root, 'README.md'), '# Test\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug95@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-95 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  // Make changed files dirty (simulate dev work)
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
        assigned_role: roleId,
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline: headSha,
        run_id: runId,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: { planning_signoff: 'passed' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: roleId,
    non_progress_signature: null,
    non_progress_count: 0,
    ...stateOverrides,
  };
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId, runId, config, turnResult, runtimeId };
}

describe('BUG-95: missing required fields normalization', () => {
  it('exact tester reproduction: files_modified, missing runtime_id/summary/artifact/proposed_next_role', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.match(combined, /Turn Accepted|turn_accepted|Accepted/i, 'Output must confirm acceptance');
  });

  it('renames files_modified to files_changed', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Dev work.',
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
      files_modified: ['src/cli.js', 'tests/smoke.mjs'],
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with files_modified. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('defaults missing runtime_id from dispatch context', () => {
    const { root, turnId } = createProject({
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      summary: 'Dev work.',
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
      // runtime_id intentionally omitted
    });
    // Remove files_modified since we provided files_changed
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with defaulted runtime_id. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('synthesizes missing summary from milestone_title', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
      milestone_title: 'Word Count Tier Index',
      // summary intentionally omitted
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with synthesized summary. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('infers missing artifact object from files_changed', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Dev work.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      proposed_next_role: 'qa',
      // artifact intentionally omitted
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    delete tr.artifact;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with inferred artifact. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('defaults missing proposed_next_role to first allowed role', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Dev work.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      artifact: { type: 'workspace' },
      // proposed_next_role intentionally omitted
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    delete tr.proposed_next_role;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed with defaulted proposed_next_role. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('valid result with all fields present passes without normalization', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Valid dev work.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'],
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
    });
    const stagingPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const tr = JSON.parse(readFileSync(stagingPath, 'utf8'));
    delete tr.files_modified;
    writeFileSync(stagingPath, JSON.stringify(tr, null, 2));

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed for valid result. Output:\n${result.stdout}\n${result.stderr}`);
  });

  it('files_modified + files_changed coexist: files_changed takes precedence', () => {
    const { root, turnId } = createProject({
      runtime_id: 'local-dev',
      summary: 'Dev work.',
      files_changed: ['src/cli.js', 'tests/smoke.mjs'], // explicit files_changed
      files_modified: [{ path: 'src/other.js' }], // should be ignored
      artifact: { type: 'workspace' },
      proposed_next_role: 'qa',
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    assert.equal(result.status, 0, `accept-turn must succeed when both fields present. Output:\n${result.stdout}\n${result.stderr}`);
  });
});
