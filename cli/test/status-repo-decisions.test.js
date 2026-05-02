import { afterAll } from 'vitest';
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const dirs = [];

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(path, entries) {
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createRepoDecisionFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-repo-decisions-'));
  dirs.push(dir);
  scaffoldGoverned(dir, 'Repo Decision Status Fixture', 'repo-decision-status-fixture');

  const configPath = join(dir, 'agentxchain.json');
  const statePath = join(dir, '.agentxchain', 'state.json');
  const repoDecisionsPath = join(dir, '.agentxchain', 'repo-decisions.jsonl');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const fallbackRuntime = config.roles.dev?.runtime || Object.keys(config.runtimes || {})[0] || 'manual';
  config.roles.architect = {
    title: 'Architect',
    mandate: 'Freeze architecture decisions.',
    runtime: fallbackRuntime,
    write_authority: 'authoritative',
    decision_authority: 40,
  };
  config.roles.qa = {
    title: 'QA',
    mandate: 'Guard release quality decisions.',
    runtime: fallbackRuntime,
    write_authority: 'review_only',
    decision_authority: 20,
  };
  writeJson(configPath, config);

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    run_id: 'run_status_repo_decisions_001',
    project_id: 'repo-decision-status-fixture',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 2,
    repo_decisions: [
      {
        id: 'DEC-101',
        status: 'active',
        category: 'architecture',
        statement: 'Adopt a durable audit log.',
        role: 'architect',
        run_id: 'run_prev_001',
      },
      {
        id: 'DEC-201',
        status: 'active',
        category: 'quality',
        statement: 'All release candidates require HTML governance reports.',
        role: 'qa',
        run_id: 'run_prev_002',
        overrides: 'DEC-001',
      },
    ],
  });
  writeJson(statePath, state);

  writeJsonl(repoDecisionsPath, [
    {
      id: 'DEC-001',
      status: 'overridden',
      category: 'quality',
      statement: 'Plain text reports are enough.',
      role: 'qa',
      run_id: 'run_prev_000',
      overridden_by: 'DEC-201',
    },
    ...state.repo_decisions,
  ]);

  return dir;
}

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('status repo-decision carryover summary', () => {
  it('AT-SRDC-001: status text renders first-glance repo-decision carryover significance', () => {
    const dir = createRepoDecisionFixture();
    const result = runCli(dir, ['status']);

    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Repo decisions:\s+2 active, 1 overridden/);
    assert.match(result.stdout, /Carryover:\s+categories: architecture, quality; highest authority: 40 \(architect\); 1 active superseding earlier decision; 1 overridden with recorded successor/);
  });

  it('AT-SRDC-002: status --json exposes additive repo_decision_summary from durable history', () => {
    const dir = createRepoDecisionFixture();
    const result = runCli(dir, ['status', '--json']);

    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.repo_decisions.length, 2);
    assert.equal(payload.config.roles.architect.decision_authority, 40);
    assert.equal(payload.config.roles.qa.decision_authority, 20);
    assert.equal(payload.repo_decision_summary.total, 3);
    assert.equal(payload.repo_decision_summary.active_count, 2);
    assert.equal(payload.repo_decision_summary.overridden_count, 1);
    assert.deepEqual(payload.repo_decision_summary.operator_summary.active_categories, ['architecture', 'quality']);
    assert.equal(payload.repo_decision_summary.operator_summary.highest_active_authority_level, 40);
    assert.equal(payload.repo_decision_summary.operator_summary.highest_active_authority_role, 'architect');
    assert.equal(payload.repo_decision_summary.operator_summary.superseding_active_count, 1);
    assert.equal(payload.repo_decision_summary.operator_summary.overridden_with_successor_count, 1);
  });
});
