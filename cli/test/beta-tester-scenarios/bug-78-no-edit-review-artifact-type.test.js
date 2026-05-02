/**
 * BUG-78 beta-tester scenario: no-edit review turns must not require manual
 * staging JSON surgery when the model emits workspace + empty files_changed.
 *
 * Reproduction class:
 *   product_marketing performed a valid no-edit launch readiness review but
 *   staged artifact.type="workspace" with files_changed=[]; accept-turn paused
 *   the run and forced the operator to edit .agentxchain/staging/<turn>/JSON.
 *
 * This command-chain test proves accept-turn handles both the correct review
 * artifact and the recoverable empty-workspace artifact for the no-edit review
 * roles called out by the tester: product_marketing, qa, and pm.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

function createNoEditReviewProject(roleId, artifactType) {
  const root = mkdtempSync(join(tmpdir(), `axc-bug78-${roleId}-`));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = `local-${roleId}`;

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug78-cli-test', id: `bug78-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      [roleId]: {
        title: roleId === 'pm' ? 'Product Manager' : roleId === 'qa' ? 'QA' : 'Product Marketing',
        mandate: 'Perform no-edit review work and request run completion when ready.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
    },
    runtimes: {
      [runtimeId]: {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      launch: { entry_role: roleId, allowed_next_roles: [roleId, 'human'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(root, 'README.md'), '# BUG-78 fixture\n');
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'launch',
    accepted_integration_ref: null,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: roleId,
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline: null,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: { launch_ready: 'pending' },
    budget_reservations: {},
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');

  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary: `${roleId} completed a no-edit launch readiness review.`,
    decisions: [
      {
        id: 'DEC-001',
        category: 'quality',
        statement: 'No repo edits are needed for this readiness review.',
        rationale: 'Existing launch artifacts are sufficient for this turn.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Future runs should keep launch-readiness evidence current.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['git diff --quiet'],
      evidence_summary: 'No repo changes were required.',
      machine_evidence: [{ command: 'git diff --quiet', exit_code: 0 }],
    },
    artifact: { type: artifactType, ref: artifactType === 'workspace' ? 'git:dirty' : `turn:${turnId}` },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: true,
    needs_human_reason: null,
    cost: { usd: 0 },
  }, null, 2));

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug78@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-78 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add README.md agentxchain.json .gitignore', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });

  return { root, turnId };
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('BUG-78: no-edit review artifact type recovery', () => {
  for (const roleId of ['product_marketing', 'qa', 'pm']) {
    it(`accepts a correct no-edit review artifact for ${roleId}`, () => {
      const { root, turnId } = createNoEditReviewProject(roleId, 'review');
      const accept = runCli(root, ['accept-turn', '--turn', turnId]);

      assert.equal(accept.status, 0, `correct review artifact must accept:\n${accept.stdout}\n${accept.stderr}`);
      assert.match(accept.stdout, /Turn Accepted/);

      const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
      assert.equal(history.at(-1).role, roleId);
      assert.equal(history.at(-1).artifact.type, 'review');
      assert.deepEqual(history.at(-1).files_changed, []);
    });

    it(`auto-normalizes empty workspace artifact to review for no-edit ${roleId}`, () => {
      const { root, turnId } = createNoEditReviewProject(roleId, 'workspace');
      const accept = runCli(root, ['accept-turn', '--turn', turnId]);

      assert.equal(accept.status, 0, `empty workspace artifact must auto-normalize:\n${accept.stdout}\n${accept.stderr}`);
      assert.match(accept.stdout, /Turn Accepted/);

      const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
      assert.equal(history.at(-1).role, roleId);
      assert.equal(history.at(-1).artifact.type, 'review');
      assert.equal(history.at(-1).artifact.ref, `turn:${turnId}`);
      assert.deepEqual(history.at(-1).files_changed, []);

      const eventTypes = readJsonl(join(root, '.agentxchain', 'events.jsonl')).map((entry) => entry.event_type);
      assert.ok(
        eventTypes.includes('artifact_type_auto_normalized'),
        `expected artifact_type_auto_normalized event, got ${eventTypes.join(', ')}`,
      );
      assert.ok(
        eventTypes.includes('staged_result_auto_normalized'),
        `expected staged_result_auto_normalized event, got ${eventTypes.join(', ')}`,
      );
    });
  }

  it('exposes a one-command recovery flag for inspected empty workspace artifacts', () => {
    const { root, turnId } = createNoEditReviewProject('qa', 'workspace');
    const accept = runCli(root, ['accept-turn', '--turn', turnId, '--normalize-artifact-type', 'review']);

    assert.equal(accept.status, 0, `explicit recovery flag must accept:\n${accept.stdout}\n${accept.stderr}`);
    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    assert.equal(history.at(-1).artifact.type, 'review');
  });

  it('keeps ambiguous authoritative empty-workspace completions rejected', () => {
    const { root, turnId } = createNoEditReviewProject('qa', 'workspace');
    const resultPath = join(root, '.agentxchain', 'staging', turnId, 'turn-result.json');
    const staged = JSON.parse(readFileSync(resultPath, 'utf8'));
    staged.run_completion_request = null;
    writeFileSync(resultPath, JSON.stringify(staged, null, 2));

    const accept = runCli(root, ['accept-turn', '--turn', turnId]);

    assert.notEqual(accept.status, 0, 'ambiguous empty workspace artifact must still fail closed');
    assert.match(accept.stdout + accept.stderr, /artifact\.type: "workspace" but files_changed is empty/);
    assert.match(accept.stdout + accept.stderr, /Validation failed at stage artifact/);
  });
});
