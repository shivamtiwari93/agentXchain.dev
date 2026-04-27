/**
 * BUG-97 beta-tester scenario: a retained failed-acceptance staged result has
 * the active turn_id but a stale run_id from an earlier governed run. The
 * framework should rewrite run_id from authoritative state only when the
 * turn_id proves the staged file belongs to the active turn.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug97-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const currentRunId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const staleRunId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const roleId = 'dev';
  const runtimeId = 'local-dev';
  const changedFiles = ['src/cli.js', 'tests/smoke.mjs', '.planning/IMPLEMENTATION_NOTES.md'];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug97-cli-test', id: `bug97-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
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
    run_id: staleRunId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    phase: 'implementation',
    status: 'completed',
    summary: 'Implemented retained turn work.',
    decisions: [
      {
        id: 'DEC-001',
        statement: 'Kept the retained implementation output.',
        rationale: 'The active turn identity matches and verification passed.',
        category: 'implementation',
      },
    ],
    objections: [],
    files_changed: changedFiles,
    verification: {
      status: 'pass',
      commands: ['node -e "process.exit(0)"'],
      evidence_summary: 'Smoke command passed.',
      machine_evidence: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
    run_completion_request: null,
    needs_human_reason: null,
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
  execSync('git config user.email "bug97@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-97 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  for (const f of changedFiles) {
    writeFileSync(join(root, f), `// ${f}\n// changed by dev\n`);
  }

  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  const state = {
    schema_version: '1.1',
    run_id: currentRunId,
    project_id: config.project.id,
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        run_id: currentRunId,
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
    ...stateOverrides,
  };
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, turnId, currentRunId, staleRunId };
}

describe('BUG-97: run_id assignment normalization', () => {
  it('accepts a retained staged result with stale run_id when turn_id matches the active turn', () => {
    const { root, turnId, currentRunId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    assert.match(combined, /Turn Accepted|turn_accepted|Accepted/i, 'Output must confirm acceptance');

    const events = execSync('cat .agentxchain/events.jsonl', { cwd: root, encoding: 'utf8' });
    assert.match(events, /staged_result_auto_normalized/);
    assert.match(events, /run_id_rewritten_from_active_turn_context/);
    assert.match(events, new RegExp(currentRunId));
  });

  it('rejects stale run_id when staged turn_id does not match the active turn', () => {
    const { root, turnId, staleRunId } = createProject({ turn_id: 'turn_wrong_identity' });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'accept-turn must fail for mismatched turn_id');
    assert.match(combined, /Validation failed at stage assignment/);
    assert.match(combined, /run_id mismatch/);
    assert.match(combined, /turn_id mismatch/);
    assert.match(combined, new RegExp(staleRunId));
  });
});
