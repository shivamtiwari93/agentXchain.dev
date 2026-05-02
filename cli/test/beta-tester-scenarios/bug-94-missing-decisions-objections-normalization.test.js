/**
 * BUG-94 beta-tester scenario:
 * a retained failed_acceptance turn can contain an otherwise useful staged
 * result that omits top-level decisions/objections arrays. The normalizer must
 * default only missing arrays to [] before schema validation, while preserving
 * review_only challenge enforcement at protocol validation.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function createProject({ roleId = 'dev', writeAuthority = 'authoritative', failedAcceptance = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug94-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = writeAuthority === 'review_only' ? `manual-${roleId}` : `local-${roleId}`;
  const runtimeClass = writeAuthority === 'review_only' ? 'manual' : 'local_cli';
  const changedFile = 'src/feature.js';

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: `bug94-${randomUUID().slice(0, 8)}`, name: 'BUG-94 Test', default_branch: 'main' },
    roles: {
      [roleId]: {
        title: roleId,
        mandate: 'Complete a governed turn.',
        write_authority: writeAuthority,
        runtime_class: runtimeClass,
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      [runtimeId]: writeAuthority === 'review_only'
        ? { type: 'manual' }
        : { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      implementation: { entry_role: roleId, allowed_next_roles: ['dev', 'human'] },
    },
    rules: { challenge_required: true, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, changedFile), 'export const feature = 1;\n');
  writeFileSync(join(root, 'README.md'), '# BUG-94\n');

  git(root, ['init']);
  git(root, ['config', 'user.email', 'bug94@test.local']);
  git(root, ['config', 'user.name', 'BUG-94 Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  const headSha = git(root, ['rev-parse', 'HEAD']);

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary: 'Implemented the retained dogfood turn without new decisions or objections.',
    files_changed: writeAuthority === 'review_only' ? [] : [changedFile],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node -e "console.log(1)"'],
      evidence_summary: 'Verification passed.',
      machine_evidence: [{ command: 'node -e "console.log(1)"', exit_code: 0 }],
    },
    artifact: writeAuthority === 'review_only'
      ? { type: 'review', ref: `turn:${turnId}` }
      : { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { usd: 0.01 },
  };
  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));

  if (writeAuthority !== 'review_only') {
    writeFileSync(join(root, changedFile), 'export const feature = 2;\n');
  }

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
        status: failedAcceptance ? 'failed_acceptance' : 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline: headSha,
        failure_reason: failedAcceptance ? 'previous package rejected missing decisions and objections' : null,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: {},
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

  return { root, turnId };
}

function readEvents(root) {
  return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('BUG-94: missing decisions/objections array normalization', () => {
  it('command-chain: run reaccepts retained failed_acceptance turn with missing decisions and objections', () => {
    const { root, turnId } = createProject();

    const result = runCli(root, ['run', '--max-turns', '1', '--auto-approve', '--auto-checkpoint']);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, combined);
    assert.match(combined, new RegExp(`Turn accepted: ${turnId}`));
    assert.doesNotMatch(combined, /Missing required field: decisions/);
    assert.doesNotMatch(combined, /Missing required field: objections/);

    const events = readEvents(root).filter((event) => event.event_type === 'staged_result_auto_normalized');
    assert.ok(events.some((event) => event.payload?.field === 'decisions'
      && event.payload?.rationale === 'missing_decisions_array_defaulted'));
    assert.ok(events.some((event) => event.payload?.field === 'objections'
      && event.payload?.rationale === 'missing_objections_array_defaulted'));
  });

  it('review_only roles still fail challenge-required protocol validation after objections default to []', () => {
    const { root, turnId } = createProject({ roleId: 'qa', writeAuthority: 'review_only', failedAcceptance: false });

    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, combined);
    assert.match(combined, /review_only authority and must raise at least one objection/);
    assert.doesNotMatch(combined, /Missing required field: objections/);
  });
});
