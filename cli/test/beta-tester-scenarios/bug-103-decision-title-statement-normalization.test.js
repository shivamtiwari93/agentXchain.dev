/**
 * BUG-103 beta-tester scenario: a tusq.dev PM roadmap-replenishment turn emitted
 * decisions with title+rationale but no statement. The normalizer should copy
 * title into statement before schema validation, without inventing text from
 * rationale alone.
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

function createProject({ decisions } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug103-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const changedFiles = ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md', '.planning/command-surface.md'];
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug103-cli-test', id: `bug103-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Plan.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-pm',
        runtime: 'local-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-pm': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: { requires_files: changedFiles, requires_verification_pass: true },
      implementation_complete: { requires_files: [], requires_human_approval: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'pm',
    runtime_id: 'local-pm',
    status: 'completed',
    phase_transition_request: 'implementation',
    proposed_next_role: 'dev',
    summary: 'M50 roadmap replenishment planning completed.',
    decisions: decisions || Array.from({ length: 5 }, (_, index) => ({
      id: `DEC-00${index + 1}`,
      title: `M50 planning decision ${index + 1}`,
      rationale: `Rationale ${index + 1} is already present.`,
    })),
    objections: [],
    files_changed: changedFiles,
    artifacts_created: [],
    verification: {
      status: 'pass',
      machine_evidence: [{ command: 'grep -n M50 .planning/ROADMAP.md', exit_code: 0 }],
    },
    artifact: { type: 'workspace' },
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\n`);
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug103@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-103 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\nM50\n`);
  }

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
        run_id: runId,
        assigned_role: 'pm',
        status: 'failed_acceptance',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: 'local-pm',
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
    next_recommended_role: 'pm',
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

function readEvents(root) {
  return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('BUG-103: decision title statement normalization', () => {
  it('accept-turn copies decisions[].title into missing statement', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    const events = readEvents(root);
    assert.ok(events.some((event) => event.event_type === 'staged_result_auto_normalized'
      && event.payload?.field === 'decisions[0].statement'
      && event.payload?.rationale === 'copied_from_title'));
  });

  it('still rejects a decision with no statement source material', () => {
    const { root, turnId } = createProject({
      decisions: [{ id: 'DEC-001', category: 'scope', rationale: 'Rationale exists but statement text is absent.' }],
    });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'accept-turn must reject missing statement source');
    assert.match(combined, /decisions\[0\]\.statement must be a non-empty string/);
  });
});
