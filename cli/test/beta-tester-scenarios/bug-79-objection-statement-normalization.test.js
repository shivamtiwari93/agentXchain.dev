/**
 * BUG-79 beta-tester scenario: useful objections emitted with summary/detail
 * but missing statement must be normalized before schema validation.
 *
 * This mirrors the tester's command-chain failure:
 *   agentxchain accept-turn rejected a PM turn because objections contained
 *   summary/detail without statement, forcing jq mutation of turn-result.json.
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
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
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

function createProject(roleId, objection) {
  const root = mkdtempSync(join(tmpdir(), `axc-bug79-${roleId}-`));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runtimeId = `local-${roleId}`;
  const changedFiles = [
    '.planning/PM_SIGNOFF.md',
    '.planning/SYSTEM_SPEC.md',
    '.planning/ROADMAP.md',
    '.planning/ROADMAP_NEXT_CANDIDATES.md',
  ];

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug79-cli-test', id: `bug79-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      [roleId]: {
        title: roleId === 'pm' ? 'Product Manager' : roleId === 'qa' ? 'QA' : 'Product Marketing',
        mandate: 'Perform governed review and planning work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: runtimeId,
        runtime: runtimeId,
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement accepted planning work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      [runtimeId]: { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: roleId, allowed_next_roles: [roleId, 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: roleId, allowed_next_roles: [roleId, 'human'] },
    },
    gates: {
      planning_signoff: { type: 'automatic', required: false },
    },
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(root, 'README.md'), '# BUG-79 fixture\n');
  writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM signoff\n\nInitial.\n');
  writeFileSync(join(root, '.planning/SYSTEM_SPEC.md'), '# System spec\n\nInitial.\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n- [ ] Initial item\n');
  writeFileSync(join(root, '.planning/ROADMAP_NEXT_CANDIDATES.md'), '# Roadmap next candidates\n\nInitial.\n');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug79@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-79 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add README.md agentxchain.json .gitignore .planning', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  const baseline = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

  writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM signoff\n\nInitial.\n\nSignoff criteria refreshed for the next bounded increment.\n');
  writeFileSync(join(root, '.planning/SYSTEM_SPEC.md'), '# System spec\n\nInitial.\n\n## Static MCP Server Descriptor Export\n\nSystem boundary added.\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n- [ ] Initial item\n- [ ] Static MCP server descriptor export\n');
  writeFileSync(join(root, '.planning/ROADMAP_NEXT_CANDIDATES.md'), '# Roadmap next candidates\n\nInitial.\n\n## Static MCP Server Descriptor Export\n\nCandidate charter.\n');

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: runId,
    project_id: config.project.id,
    status: 'active',
    phase: 'planning',
    accepted_integration_ref: `git:${baseline}`,
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: roleId,
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        runtime_id: runtimeId,
        assigned_sequence: 1,
        baseline,
      },
    },
    turn_sequence: 1,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
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
    summary: 'Materialized a vision-derived roadmap candidate.',
    decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Keep MCP export as a candidate charter.', rationale: 'Planning work is useful and bounded.' }],
    objections: [{ id: 'OBJ-001', severity: 'medium', status: 'raised', ...objection }],
    files_changed: changedFiles,
    artifacts_created: changedFiles,
    verification: { status: 'pass', commands: ['git diff -- .planning/ROADMAP_NEXT_CANDIDATES.md'], evidence_summary: 'Planning diff inspected.', machine_evidence: [{ command: 'git diff -- .planning/ROADMAP_NEXT_CANDIDATES.md', exit_code: 0 }] },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'dev',
    phase_transition_request: 'implementation',
    run_completion_request: null,
    needs_human_reason: null,
    cost: { usd: 0 },
  }, null, 2));

  return { root, turnId };
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function acceptAndRead(root, turnId, extraArgs = []) {
  const accept = runCli(root, ['accept-turn', '--turn', turnId, ...extraArgs]);
  assert.equal(accept.status, 0, `accept-turn must succeed:\n${accept.stdout}\n${accept.stderr}`);
  return {
    history: readJsonl(join(root, '.agentxchain', 'history.jsonl')),
    events: readJsonl(join(root, '.agentxchain', 'events.jsonl')),
  };
}

describe('BUG-79: objection statement normalization', () => {
  for (const roleId of ['pm', 'qa', 'product_marketing']) {
    it(`normalizes summary-only objection for ${roleId}`, () => {
      const { root, turnId } = createProject(roleId, {
        summary: 'Form decision for the static-MCP-descriptor command is unresolved',
        detail: '',
      });
      const { history, events } = acceptAndRead(root, turnId);

      assert.equal(history.at(-1).objections[0].statement, 'Form decision for the static-MCP-descriptor command is unresolved');
      assert.ok(events.some((event) => event.event_type === 'staged_result_auto_normalized'
        && event.payload?.field === 'objections[0].statement'
        && event.payload?.rationale === 'copied_from_summary'));
    });

    it(`normalizes detail-only objection for ${roleId}`, () => {
      const { root, turnId } = createProject(roleId, {
        detail: 'Two unbound vision-derived charters now coexist in the candidate backlog.',
      });
      const { history, events } = acceptAndRead(root, turnId);

      assert.equal(history.at(-1).objections[0].statement, 'Two unbound vision-derived charters now coexist in the candidate backlog.');
      assert.ok(events.some((event) => event.event_type === 'staged_result_auto_normalized'
        && event.payload?.rationale === 'copied_from_detail'));
    });
  }

  it('prefers summary over detail when both are present', () => {
    const { root, turnId } = createProject('pm', {
      summary: 'Summary wins',
      detail: 'Detail loses',
    });
    const { history } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].statement, 'Summary wins');
  });

  it('accepts valid statement objections without normalization event', () => {
    const { root, turnId } = createProject('pm', {
      statement: 'Already schema-valid.',
      summary: 'Supplement only.',
    });
    const { history, events } = acceptAndRead(root, turnId);

    assert.equal(history.at(-1).objections[0].statement, 'Already schema-valid.');
    assert.ok(!events.some((event) => event.event_type === 'staged_result_auto_normalized'
      && event.payload?.field === 'objections[0].statement'));
  });

  it('fails fast with CLI recovery guidance when no recoverable objection text exists', () => {
    const { root, turnId } = createProject('pm', {});
    const accept = runCli(root, ['accept-turn', '--turn', turnId]);

    assert.notEqual(accept.status, 0, 'unrecoverable objection must fail closed');
    assert.match(accept.stdout + accept.stderr, /objections\[0\]\.statement must be a non-empty string/);
    assert.match(accept.stdout + accept.stderr, /--normalize-staged-result/);
  });

  it('documents staged-result invariants and the BUG-78/BUG-79 normalizer table', () => {
    const audit = readFileSync(join(REPO_ROOT, '.planning/STAGED_RESULT_INVARIANT_AUDIT.md'), 'utf8');
    assert.match(audit, /objections\[\]\.statement/);
    assert.match(audit, /summary` -> `statement`/);
    assert.match(audit, /detail` -> `statement`/);
    assert.match(audit, /artifact\.type = "review"/);
    assert.match(audit, /staged_result_auto_normalized/);
  });
});
