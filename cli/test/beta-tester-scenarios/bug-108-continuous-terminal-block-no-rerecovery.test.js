/**
 * BUG-108 beta-tester scenario: after BUG-107 recovers a paused active
 * continuous session, a real terminal assignment blocker must stay terminal.
 * The CLI must not run the post-step paused-active recovery hook and loop.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    timeout: 12_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function createPausedActiveDirtyBaselineProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug108-'));
  tempDirs.push(root);

  const runId = 'run_bug108_terminal_block';
  const sessionId = 'cont-bug108-terminal-block';
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug108-cli-test', id: 'bug108-cli-test', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Verify implementation work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-qa': {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      qa_ship_verdict: { required: false, owner: 'qa' },
    },
    approval_policy: { triage: 'auto', gates: 'auto' },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## Recovery\n\n- Resume QA.\n');
  writeFileSync(join(root, '.gitignore'), '.agentxchain/dispatch/\n.agentxchain/staging/\n');
  writeFileSync(join(root, 'src', 'cli.js'), 'console.log("baseline");\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug108@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-108 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  writeFileSync(join(root, 'src', 'cli.js'), 'console.log("dirty actor-owned file");\n');
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: `git:${headSha}`,
    active_turns: {},
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    phase_gate_status: { qa_ship_verdict: 'pending' },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    created_at: new Date().toISOString(),
    phase_entered_at: new Date().toISOString(),
    provenance: { trigger: 'manual' },
    delegation_queue: [],
    next_recommended_role: 'qa',
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'continuous-session.json'), JSON.stringify({
    session_id: sessionId,
    started_at: new Date().toISOString(),
    vision_path: '.planning/VISION.md',
    runs_completed: 89,
    max_runs: 100,
    idle_cycles: 0,
    max_idle_cycles: 3,
    current_run_id: runId,
    current_vision_objective: 'Resume QA.',
    status: 'paused',
    cumulative_spent_usd: 0,
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), '');

  return { root, sessionId, runId };
}

describe('BUG-108: continuous terminal block does not re-recover', () => {
  it('run --continuous recovers once, surfaces dirty-baseline blocker, and exits without looping', () => {
    const { root, sessionId, runId } = createPausedActiveDirtyBaselineProject();
    const result = runCli(root, [
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--max-runs',
      '100',
      '--max-idle-cycles',
      '3',
      '--poll-seconds',
      '1',
      '--triage-approval',
      'auto',
    ]);
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.error?.code, 'ETIMEDOUT', `continuous run must not loop until timeout. Output:\n${output}`);
    assert.match(output, new RegExp(`Resuming existing continuous session ${sessionId}`));
    assert.match(output, new RegExp(`Paused continuous session has active unblocked run ${runId}`));
    assert.match(output, /Working tree has uncommitted changes in actor-owned files: src\/cli\.js/);
    assert.equal(
      (output.match(new RegExp(`Continuous session was paused while run ${runId} remained active`, 'g')) || []).length,
      0,
      `post-step paused-active recovery must not run after terminal blocked result. Output:\n${output}`,
    );

    const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'continuous-session.json'), 'utf8'));
    assert.equal(session.session_id, sessionId);
    assert.equal(session.current_run_id, runId);
    assert.equal(session.status, 'paused');
  });
});
