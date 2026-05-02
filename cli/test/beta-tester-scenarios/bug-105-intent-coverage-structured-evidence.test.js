/**
 * BUG-105 beta-tester scenario: the retained tusq.dev roadmap-replenishment PM
 * turn explicitly recorded the bounded/testable/non-duplicate acceptance clause
 * as typed structured verification evidence. After BUG-104 moved that evidence
 * into evidence_summary, strict intent coverage still had to see it.
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

function createProject({ includeStructuredContractEvidence = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug105-'));
  tempDirs.push(root);

  const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const intentId = `intent_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const changedFiles = [
    '.planning/ROADMAP.md',
    '.planning/PM_SIGNOFF.md',
    '.planning/SYSTEM_SPEC.md',
    '.planning/command-surface.md',
  ];
  const acceptanceContract = [
    'New unchecked milestone items added to .planning/ROADMAP.md',
    'Milestone cites at least one concrete VISION.md source section from the unplanned backlog',
    'Milestone is bounded, testable, and does not duplicate existing checked milestones',
  ];
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'full-local-cli',
    project: { name: 'bug105-cli-test', id: `bug105-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
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
    intent_coverage_mode: 'strict',
  };

  const machineEvidence = [
    {
      type: 'file_marker_grep',
      path: '.planning/ROADMAP.md',
      marker: '### M50',
      result: 'found at line 1507',
    },
  ];
  if (includeStructuredContractEvidence) {
    machineEvidence.push({
      type: 'acceptance_contract_check',
      contract: [
        '(3) Milestone is bounded, testable, and does not duplicate existing checked milestones — ~0.5 day bound, eval scenario specified, axis distinct from M28-M49',
      ],
      result: 'all three acceptance contract clauses satisfied',
    });
  }

  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'pm',
    runtime_id: 'local-pm',
    status: 'completed',
    phase_transition_request: 'implementation',
    proposed_next_role: 'dev',
    summary: 'M50 roadmap replenishment planning completed with new unchecked roadmap work and VISION.md traceability.',
    decisions: [{
      id: 'DEC-001',
      title: 'Accept roadmap-replenishment charter and bind M50',
      rationale: 'The roadmap was checked through M49 and VISION.md still had unplanned Action Execution Policy scope.',
      alternatives: ['Defer the charter'],
      evidence: ['.planning/VISION.md:409-422', '.planning/ROADMAP.md:1507'],
    }],
    objections: [],
    files_changed: changedFiles,
    artifacts_created: [],
    verification: {
      status: 'pass',
      machine_evidence: machineEvidence,
    },
    artifact: { type: 'workspace' },
  };

  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\n`);
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "bug105@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "BUG-105 Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  for (const f of changedFiles) {
    writeFileSync(join(root, f), `${f}\nM50\nVISION.md\n`);
  }

  writeFileSync(join(root, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify(turnResult, null, 2));
  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
    id: intentId,
    event_id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    source: 'vision_scan',
    category: 'roadmap_exhausted_vision_open',
    priority: 'p0',
    status: 'started',
    charter: '[roadmap-replenishment] Derive next bounded roadmap increment from VISION.md.',
    acceptance_contract: acceptanceContract,
    phase_scope: 'planning',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, null, 2));
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
        intake_context: {
          intent_id: intentId,
          event_id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          source: 'vision_scan',
          category: 'roadmap_exhausted_vision_open',
          priority: 'p0',
          charter: '[roadmap-replenishment] Derive next bounded roadmap increment from VISION.md.',
          acceptance_contract: acceptanceContract,
          phase_scope: 'planning',
        },
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

function readJsonl(root, relPath) {
  return readFileSync(join(root, relPath), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('BUG-105: intent coverage sees structured verification evidence', () => {
  it('accepts tusq-style roadmap replenishment coverage after BUG-104 evidence normalization', () => {
    const { root, turnId } = createProject();
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, `accept-turn must succeed. Output:\n${combined}`);
    const [historyEntry] = readJsonl(root, '.agentxchain/history.jsonl');
    assert.match(historyEntry.verification.evidence_summary, /Milestone is bounded, testable/);
    assert.deepEqual(historyEntry.verification.machine_evidence, []);
  });

  it('still fails strict intent coverage when the bounded/testable/non-duplicate clause is absent', () => {
    const { root, turnId } = createProject({ includeStructuredContractEvidence: false });
    const result = runCli(root, ['accept-turn', '--turn', turnId]);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'accept-turn must reject when acceptance evidence is absent');
    assert.match(combined, /intent_coverage|Intent coverage incomplete|Unaddressed acceptance items/);
    assert.match(combined, /Milestone is bounded, testable, and does not duplicate existing checked milestones/);
  });
});
