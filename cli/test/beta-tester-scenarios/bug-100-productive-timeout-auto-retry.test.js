/**
 * BUG-100 beta-tester scenario: continuous full-auto recovery must not require
 * operator unblock when a local_cli turn produced output but was killed at the
 * hard deadline before staging a result.
 */

import { afterEach, it } from 'vitest';
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

function runCli(root, args, timeout = 45_000) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return { ...result, combined: `${result.stdout}\n${result.stderr}` };
}

function createBlockedProject({ firstOutput = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug100-'));
  tempDirs.push(root);

  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const projectId = `bug100-${randomUUID().slice(0, 8)}`;
  const agentPath = join(root, 'agent.js');

  writeFileSync(agentPath, [
    "const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');",
    "const { dirname, join } = require('node:path');",
    'const root = process.cwd();',
    "const index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));",
    "const entry = Object.values(index.active_turns || {})[0];",
    "const turnId = entry.turn_id;",
    "const runId = index.run_id;",
    "const runtimeId = entry.runtime_id || 'local-dev';",
    "mkdirSync(join(root, '.planning'), { recursive: true });",
    "writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), `# Implementation\\n\\nRecovered ${turnId}\\n`);",
    "const productPath = join(root, 'src', 'bug100-timeout-retry.js');",
    'mkdirSync(dirname(productPath), { recursive: true });',
    "writeFileSync(productPath, 'export const bug100TimeoutRetry = true;\\n');",
    'const result = {',
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    "  role: 'dev',",
    '  runtime_id: runtimeId,',
    "  status: 'completed',",
    "  summary: 'Recovered productive timeout retry.',",
    "  decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Recovered productive timeout retry.', rationale: 'BUG-100 command-chain proof.' }],",
    "  objections: [],",
    "  files_changed: ['.planning/IMPLEMENTATION_NOTES.md', 'src/bug100-timeout-retry.js'],",
    "  artifacts_created: [],",
    "  verification: { status: 'pass', commands: ['node agent.js'], evidence_summary: 'staged result written', machine_evidence: [{ command: 'node agent.js', exit_code: 0 }] },",
    "  artifact: { type: 'workspace', ref: null },",
    "  proposed_next_role: 'human',",
    '  phase_transition_request: null,',
    '  run_completion_request: true,',
    '  needs_human_reason: null,',
    '};',
    'const staging = join(root, entry.staging_result_path);',
    'mkdirSync(dirname(staging), { recursive: true });',
    'writeFileSync(staging, JSON.stringify(result, null, 2));',
    "console.log(`bug100-agent completed ${turnId}`);",
  ].join('\n'));

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug100-cli-test', id: projectId, default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'local-dev' },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [agentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] } },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## Timeout Recovery\n\n- Recover productive timeout blockers.\n');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.gitignore'), '.agentxchain/dispatch/turns/*/stdout.log\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug100@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-100 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  const activeTurn = {
    turn_id: turnId,
    run_id: runId,
    assigned_role: 'dev',
    status: 'failed',
    attempt: 2,
    assigned_at: '2026-04-28T00:00:00.000Z',
    started_at: '2026-04-28T00:00:00.000Z',
    deadline_at: '2026-04-28T00:20:00.000Z',
    assigned_sequence: 1,
    runtime_id: 'local-dev',
    baseline: { kind: 'git_worktree', head_ref: headSha, clean: true, captured_at: '2026-04-28T00:00:00.000Z' },
    last_rejection: {
      turn_id: turnId,
      attempt: 2,
      rejected_at: '2026-04-28T00:20:00.000Z',
      reason: `Subprocess exited (code 143) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`,
      validation_errors: [`Subprocess exited (code 143) without writing a staged turn result to .agentxchain/staging/${turnId}/turn-result.json.`],
      failed_stage: 'dispatch',
    },
  };
  if (firstOutput) {
    activeTurn.first_output_at = '2026-04-28T00:00:10.000Z';
    activeTurn.first_output_stream = 'stdout';
  }

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: runId,
    project_id: projectId,
    status: 'blocked',
    phase: 'implementation',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: { [turnId]: activeTurn },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: 'escalation:retries-exhausted:dev',
    blocked_reason: {
      category: 'retries_exhausted',
      blocked_at: '2026-04-28T00:20:00.000Z',
      turn_id: turnId,
      recovery: {
        typed_reason: 'retries_exhausted',
        owner: 'human',
        recovery_action: 'Resolve the escalation, then run agentxchain step --resume',
        turn_retained: true,
        detail: 'escalation:retries-exhausted:dev',
      },
    },
    escalation: { from_role: 'dev', from_turn_id: turnId, reason: 'Turn rejected 2 times. Retries exhausted.' },
    phase_gate_status: {},
  }, null, 2));

  return { root, turnId };
}

it('BUG-100: run --continuous auto-retries a productive timeout blocker and completes without unblock', () => {
  const { root, turnId } = createBlockedProject({ firstOutput: true });
  const result = runCli(root, [
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    '1',
    '--max-idle-cycles',
    '1',
    '--poll-seconds',
    '0',
    '--auto-checkpoint',
  ]);

  assert.equal(result.status, 0, `continuous run must recover without unblock:\n${result.combined}`);
  assert.match(result.combined, /Productive-timeout auto-retried \(1\/1\)/);

  const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  assert.equal(state.status, 'completed');
  assert.equal(state.blocked_on, null);

  const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'continuous-session.json'), 'utf8'));
  assert.equal(session.productive_timeout_retry.attempts, 1);
  assert.equal(session.productive_timeout_retry.last_old_turn_id, turnId);

  const events = readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.some((entry) => entry.event_type === 'auto_retried_productive_timeout'), true);
});

it('BUG-100: run --continuous leaves silent retries-exhausted blockers paused', () => {
  const { root } = createBlockedProject({ firstOutput: false });
  const result = runCli(root, [
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    '1',
    '--max-idle-cycles',
    '1',
    '--poll-seconds',
    '0',
    '--auto-checkpoint',
  ]);

  assert.equal(result.status, 0, `continuous run should pause cleanly, not fail:\n${result.combined}`);
  assert.match(result.combined, /Continuous loop paused on blocker/);
  const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  assert.equal(state.status, 'blocked');
  assert.equal(state.blocked_reason.category, 'retries_exhausted');
});
