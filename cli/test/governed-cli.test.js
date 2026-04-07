import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeGovernedStateShape, getActiveTurn } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function readGovernedState(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  const normalized = normalizeGovernedStateShape(parsed).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(normalized);
    },
  });
  return normalized;
}

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-test-'));

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'baby-tracker',
      name: 'Baby Tracker',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'review_only',
        runtime: 'api-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['claude', '--print'], cwd: '.' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'], requires_human_approval: true },
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'], requires_verification_pass: true },
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'], requires_human_approval: true },
    },
    prompts: {
      pm: '.agentxchain/prompts/pm.md',
      dev: '.agentxchain/prompts/dev.md',
      qa: '.agentxchain/prompts/qa.md',
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: 'run_01H',
    project_id: 'baby-tracker',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_01H',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      started_at: '2026-03-31T14:00:00Z',
      deadline_at: '2026-03-31T14:20:00Z',
      runtime_id: 'local-dev',
    },
    last_completed_turn_id: 'turn_01G',
    blocked_on: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
    },
    budget_status: {
      spent_usd: 1.25,
      remaining_usd: 48.75,
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), `${JSON.stringify({ turn_id: 'turn_01G', role: 'pm', status: 'completed' })}\n`);
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), '# pm\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'dev.md'), '# dev\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), '# qa\n');
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Phases\n\n| Phase | Goal | Status |\n|-------|------|--------|\n| Implementation | Build approved work | In progress |\n');
  writeFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nDefine the governed CLI test fixture contract.\n\n## Interface\n\n- agentxchain validate --mode turn --agent dev --json\n\n## Acceptance Tests\n\n- [ ] Governed turn validation succeeds without a staged result.\n');
  writeFileSync(join(dir, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Implementation Notes\n\n## Changes\n\nDocument the governed fixture state for CLI command coverage.\n\n## Verification\n\nRun the governed CLI tests that exercise validate, accept-turn, reject-turn, and resume.\n');
  writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example requirement | Example acceptance criterion | Pending | — | Pending |\n');
  writeFileSync(join(dir, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: PENDING\n');
  writeFileSync(join(dir, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n');

  return dir;
}

function createLegacyProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-legacy-test-'));

  const config = {
    version: 3,
    project: 'Legacy Project',
    agents: {
      pm: {
        name: 'Product Manager',
        mandate: 'Define scope and sequencing.',
      },
      engineer: {
        name: 'Engineer',
        mandate: 'Implement the requested work.',
      },
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '# Legacy log\n');

  return dir;
}

function writeExecutableHook(dir, name, script) {
  const hooksDir = join(dir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, name);
  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return hookPath;
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

function makeTurnResult(state, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Implemented the assigned work and verified the result.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Ship the current implementation slice.',
        rationale: 'It satisfies the active turn contract.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Follow-up cleanup may still be needed.',
        status: 'raised',
      },
    ],
    files_changed: ['README.md'],
    artifacts_created: ['.planning/ship-verdict.md'],
    verification: {
      status: 'pass',
      evidence_summary: 'Checked manually.',
    },
    artifact: {
      type: 'workspace',
      ref: 'git:def456',
    },
    proposed_next_role: 'qa',
    cost: {
      usd: 0.42,
    },
    ...overrides,
  };
}

describe('governed CLI support', () => {
  it('step --help exposes the verbose flag for local_cli dispatch logs', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['step', '--help']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /--verbose/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed points new projects at step instead of start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-init-'));
    try {
      const result = runCli(dir, ['init', '--governed', '-y']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /agentxchain step/);
      assert.doesNotMatch(result.stdout, /agentxchain start/);

      const config = JSON.parse(readFileSync(join(dir, 'my-agentxchain-project', 'agentxchain.json'), 'utf8'));
      assert.deepEqual(config.runtimes['local-dev'].command, ['claude', '--print']);
      assert.equal(config.runtimes['local-dev'].prompt_transport, 'stdin');
      assert.match(result.stdout, /Dev runtime:\s+claude --print\s+\(stdin\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed --dir . scaffolds in place and skips cd guidance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-in-place-'));
    try {
      const result = runCli(dir, ['init', '--governed', '--dir', '.', '-y']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(join(dir, 'agentxchain.json')));
      assert.ok(!existsSync(join(dir, 'my-agentxchain-project', 'agentxchain.json')));

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.match(config.project.name, /^agentxchain-governed-in-place-/);
      assert.doesNotMatch(result.stdout, /cd \./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed --dir <path> writes directly into the requested directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-target-dir-'));
    const projectDir = join(dir, 'customer-portal');
    try {
      const result = runCli(dir, ['init', '--governed', '--dir', 'customer-portal', '-y']);
      assert.equal(result.status, 0, result.stderr);

      assert.ok(existsSync(join(projectDir, 'agentxchain.json')));
      const config = JSON.parse(readFileSync(join(projectDir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.name, 'customer-portal');
      assert.match(result.stdout, /cd customer-portal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed accepts a custom local dev command and prompt transport', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-custom-runtime-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, [
        'init',
        '--governed',
        '--dev-command', './scripts/dev-agent.sh',
        '--dev-prompt-transport', 'dispatch_bundle_only',
        '-y',
      ]);
      assert.equal(result.status, 0, result.stderr);

      const config = JSON.parse(readFileSync(join(projectDir, 'agentxchain.json'), 'utf8'));
      assert.deepEqual(config.runtimes['local-dev'].command, ['./scripts/dev-agent.sh']);
      assert.equal(config.runtimes['local-dev'].prompt_transport, 'dispatch_bundle_only');
      assert.match(result.stdout, /Dev runtime:\s+\.\/scripts\/dev-agent\.sh\s+\(dispatch_bundle_only\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed infers argv transport when custom command includes {prompt}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-argv-runtime-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, [
        'init',
        '--governed',
        '--dev-command', 'my-agent', 'run', '{prompt}',
        '-y',
      ]);
      assert.equal(result.status, 0, result.stderr);

      const config = JSON.parse(readFileSync(join(projectDir, 'agentxchain.json'), 'utf8'));
      assert.deepEqual(config.runtimes['local-dev'].command, ['my-agent', 'run', '{prompt}']);
      assert.equal(config.runtimes['local-dev'].prompt_transport, 'argv');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed rejects a custom command without prompt delivery', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-bad-runtime-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, ['init', '--governed', '--dev-command', 'my-agent', '-y']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must either include \{prompt\} or set --dev-prompt-transport explicitly/i);
      assert.ok(!existsSync(projectDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed rejects argv mode when the command does not include {prompt}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-bad-argv-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, [
        'init',
        '--governed',
        '--dev-command', 'my-agent',
        '--dev-prompt-transport', 'argv',
        '-y',
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /argv requires \{prompt\}/i);
      assert.ok(!existsSync(projectDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed --template api-service writes template metadata and scaffold artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-template-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, ['init', '--governed', '--template', 'api-service', '-y']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Template:\s+api-service/);

      const config = JSON.parse(readFileSync(join(projectDir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.template, 'api-service');
      assert.ok(existsSync(join(projectDir, '.planning', 'api-contract.md')));
      assert.ok(existsSync(join(projectDir, '.planning', 'operational-readiness.md')));
      assert.ok(existsSync(join(projectDir, '.planning', 'error-budget.md')));

      const qaPrompt = readFileSync(join(projectDir, '.agentxchain', 'prompts', 'qa.md'), 'utf8');
      assert.match(qaPrompt, /Project-Type-Specific Guidance/);

      const acceptanceMatrix = readFileSync(join(projectDir, '.planning', 'acceptance-matrix.md'), 'utf8');
      assert.match(acceptanceMatrix, /Template Guidance/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed --template library writes library scaffold artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-library-template-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, ['init', '--governed', '--template', 'library', '-y']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Template:\s+library/);

      const config = JSON.parse(readFileSync(join(projectDir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.template, 'library');
      assert.ok(existsSync(join(projectDir, '.planning', 'public-api.md')));
      assert.ok(existsSync(join(projectDir, '.planning', 'compatibility-policy.md')));
      assert.ok(existsSync(join(projectDir, '.planning', 'release-adoption.md')));

      const qaPrompt = readFileSync(join(projectDir, '.agentxchain', 'prompts', 'qa.md'), 'utf8');
      assert.match(qaPrompt, /Project-Type-Specific Guidance/);

      const acceptanceMatrix = readFileSync(join(projectDir, '.planning', 'acceptance-matrix.md'), 'utf8');
      assert.match(acceptanceMatrix, /Template Guidance/);
      assert.match(acceptanceMatrix, /Install\/import or package-consumer smoke path verified/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --governed rejects unknown templates before writing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-bad-template-'));
    const projectDir = join(dir, 'my-agentxchain-project');
    try {
      const result = runCli(dir, ['init', '--governed', '--template', 'flask-api', '-y']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unknown template "flask-api"/);
      assert.ok(!existsSync(projectDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows governed project status as JSON', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['status', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.protocol_mode, 'governed');
      assert.equal(payload.template, 'generic');
      assert.equal(payload.config.template, 'generic');
      assert.equal(payload.config.project.name, 'Baby Tracker');
      assert.equal(payload.state.active_turns.turn_01H.assigned_role, 'dev');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrate --yes writes explicit generic template metadata without guessing project shape', () => {
    const dir = createLegacyProject();
    try {
      const result = runCli(dir, ['migrate', '--yes', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.template, 'generic');

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.template, 'generic');

      const status = runCli(dir, ['status', '--json']);
      assert.equal(status.status, 0, status.stderr);
      const statusPayload = JSON.parse(status.stdout);
      assert.equal(statusPayload.template, 'generic');
      assert.equal(statusPayload.config.template, 'generic');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrate generates prompt guidance with the turn-scoped staged result path', () => {
    const dir = createLegacyProject();
    try {
      const result = runCli(dir, ['migrate', '--yes']);
      assert.equal(result.status, 0, result.stderr);

      const pmPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
      assert.match(pmPrompt, /\.agentxchain\/staging\/<turn_id>\/turn-result\.json/);
      assert.doesNotMatch(pmPrompt, /\.agentxchain\/staging\/turn-result\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates governed project wiring and turn assignment', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['validate', '--mode', 'turn', '--agent', 'dev', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true, readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(payload.protocol_mode, 'governed');
      assert.ok(payload.warnings.some((warning) => warning.includes('No staged turn result found')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn accepts a valid staged result and clears the current turn', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      const state = readGovernedState(statePath);
      const staged = makeTurnResult(state);
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Accepted/);

      const updatedState = readGovernedState(statePath);
      assert.equal(updatedState.current_turn, null);
      assert.equal(updatedState.last_completed_turn_id, 'turn_01H');

      const history = readFileSync(join(dir, '.agentxchain', 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
      assert.equal(history.length, 2);
      const last = JSON.parse(history[history.length - 1]);
      assert.equal(last.turn_id, 'turn_01H');
      assert.equal(last.summary, staged.summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn requires --turn when multiple active turns exist', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      writeFileSync(statePath, JSON.stringify({
        schema_version: '1.1',
        run_id: 'run_01H',
        project_id: 'baby-tracker',
        status: 'active',
        phase: 'implementation',
        accepted_integration_ref: 'git:abc123',
        active_turns: {
          turn_01H: {
            turn_id: 'turn_01H',
            assigned_role: 'dev',
            status: 'running',
            attempt: 1,
            started_at: '2026-03-31T14:00:00Z',
            deadline_at: '2026-03-31T14:20:00Z',
            runtime_id: 'local-dev',
            assigned_sequence: 1,
          },
          turn_01I: {
            turn_id: 'turn_01I',
            assigned_role: 'qa',
            status: 'running',
            attempt: 1,
            started_at: '2026-03-31T14:01:00Z',
            deadline_at: '2026-03-31T14:21:00Z',
            runtime_id: 'api-qa',
            assigned_sequence: 2,
          },
        },
        turn_sequence: 2,
        last_completed_turn_id: 'turn_01G',
        blocked_on: null,
        blocked_reason: null,
        escalation: null,
        queued_phase_transition: null,
        queued_run_completion: null,
        phase_gate_status: {
          planning_signoff: 'passed',
          implementation_complete: 'pending',
          qa_ship_verdict: 'pending',
        },
        budget_reservations: {},
        budget_status: {
          spent_usd: 1.25,
          remaining_usd: 48.75,
        },
      }, null, 2));

      mkdirSync(join(dir, '.agentxchain', 'staging', 'turn_01I'), { recursive: true });
      writeFileSync(
        join(dir, '.agentxchain', 'staging', 'turn_01I', 'turn-result.json'),
        JSON.stringify({
          schema_version: '1.0',
          run_id: 'run_01H',
          turn_id: 'turn_01I',
          role: 'qa',
          runtime_id: 'api-qa',
          status: 'completed',
          summary: 'Reviewed current implementation.',
          decisions: [],
          objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Looks acceptable.', status: 'raised' }],
          files_changed: [],
          artifacts_created: [],
          verification: { status: 'pass', evidence_summary: 'Manual review complete.' },
          artifact: { type: 'review', ref: null },
          proposed_next_role: 'human',
          cost: { usd: 0.10 },
        }, null, 2),
      );

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /Multiple active turns|--turn/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn rewrites the dispatch bundle for a retry after validation failure', () => {
    const dir = createGovernedProject();
    try {
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), '{"bad":true}');

      const result = runCli(dir, ['reject-turn', '--reason', 'Schema mismatch']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Rejected For Retry/);

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      assert.equal(state.current_turn.attempt, 2);
      assert.equal(state.current_turn.status, 'retrying');

      const assignment = JSON.parse(readFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_01H', 'ASSIGNMENT.json'), 'utf8'));
      assert.equal(assignment.turn_id, 'turn_01H');
      assert.equal(assignment.attempt, 2);

      const prompt = readFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_01H', 'PROMPT.md'), 'utf8');
      assert.match(prompt, /Previous Attempt Failed/);
      assert.match(prompt, /Schema mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn escalates when retries are exhausted', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      const state = readGovernedState(statePath);
      state.current_turn.attempt = 2;
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), '{"bad":true}');

      const result = runCli(dir, ['reject-turn', '--reason', 'Second failure']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Turn Rejected And Escalated/);

      const updatedState = readGovernedState(statePath);
      assert.equal(updatedState.status, 'blocked');
      assert.equal(updatedState.current_turn.status, 'failed');
      assert.match(updatedState.blocked_on, /escalation:retries-exhausted:dev/);
      assert.equal(updatedState.escalation.from_turn_id, 'turn_01H');
      assert.equal(updatedState.blocked_reason.category, 'retries_exhausted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn requires a reason when the staged result is otherwise valid', () => {
    const dir = createGovernedProject();
    try {
      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const staged = makeTurnResult(state);
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['reject-turn']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Supply --reason to reject it anyway/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject-turn --reassign fails when the targeted turn is not conflicted', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['reject-turn', '--turn', 'turn_01H', '--reassign']);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /persisted conflict_state/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn --resolution human_merge fails when the targeted turn is not conflicted', () => {
    const dir = createGovernedProject();
    try {
      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const staged = makeTurnResult(state);
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['accept-turn', '--turn', 'turn_01H', '--resolution', 'human_merge']);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /human_merge resolution requires a conflicted active turn/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step --resume rewrites the dispatch bundle for an already active governed turn', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['step', '--resume']);
      // The local_cli adapter dispatches to subprocess. The command may fail
      // (claude may not be installed in test env), but the dispatch bundle
      // must be written before the subprocess attempt.
      const combined = result.stdout + result.stderr;
      assert.match(combined, /Resuming active turn: turn_01H/);
      assert.match(combined, /Dispatching to local CLI/);

      const assignment = JSON.parse(
        readFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_01H', 'ASSIGNMENT.json'), 'utf8')
      );
      assert.equal(assignment.turn_id, 'turn_01H');
      assert.equal(assignment.role, 'dev');
      assert.equal(assignment.runtime_id, 'local-dev');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step surfaces a structured before_assignment hook block and does not create a turn', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const statePath = join(dir, '.agentxchain', 'state.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const state = {
        schema_version: '1.1',
        run_id: null,
        project_id: 'baby-tracker',
        status: 'idle',
        phase: 'planning',
        accepted_integration_ref: null,
        active_turns: {},
        turn_sequence: 0,
        last_completed_turn_id: null,
        blocked_on: null,
        blocked_reason: null,
        escalation: null,
        queued_phase_transition: null,
        queued_run_completion: null,
        phase_gate_status: {
          planning_signoff: 'pending',
          implementation_complete: 'pending',
          qa_ship_verdict: 'pending',
        },
        budget_reservations: {},
        budget_status: {
          spent_usd: 0,
          remaining_usd: 50,
        },
      };

      writeExecutableHook(dir, 'block-assignment.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Compliance approval required before assigning pm"}\'');
      config.hooks = {
        before_assignment: [{
          name: 'assignment-gate',
          type: 'process',
          command: ['./hooks/block-assignment.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      const result = runCli(dir, ['step', '--role', 'pm']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Assignment Blocked By Hook/);
      assert.match(combined, /assignment-gate/);
      assert.match(combined, /Compliance approval required before assigning pm/);

      const updatedState = readGovernedState(statePath);
      assert.equal(updatedState.status, 'active');
      assert.equal(updatedState.current_turn, null);
      assert.ok(!existsSync(join(dir, '.agentxchain', 'dispatch', 'turns')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step surfaces the structured post-commit hook failure summary', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.runtimes['local-dev'] = { type: 'manual' };
      config.hooks = {
        after_acceptance: [{
          name: 'tamper-hook',
          type: 'process',
          command: ['./hooks/state-tamper.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        }],
      };
      writeExecutableHook(dir, 'state-tamper.sh', `#!/bin/sh
echo '{"status":"tampered"}' > "${dir}/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const staged = makeTurnResult(state, {
        verification: {
          status: 'pass',
          evidence_summary: 'Checked manually.',
        },
      });
      mkdirSync(join(dir, '.agentxchain', 'staging', 'turn_01H'), { recursive: true });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn_01H', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['step', '--resume']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Accepted, Hook Failure Detected/);
      assert.match(combined, /Hook:\s+tamper-hook/);
      assert.match(combined, /Error:\s+Turn accepted, but post-commit hook handling failed/);
      assert.match(combined, /Reason:\s+hook_tamper/);

      const updatedState = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      assert.equal(updatedState.last_completed_turn_id, 'turn_01H');
      assert.equal(updatedState.status, 'blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step blocks dispatch when an after_dispatch hook tampers with the core bundle', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.hooks = {
        after_dispatch: [{
          name: 'dispatch-tamper',
          type: 'process',
          command: ['./hooks/tamper-prompt.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'tamper-prompt.sh', `#!/bin/sh
echo "# replaced prompt" > "${dir}/.agentxchain/dispatch/turns/turn_01H/PROMPT.md"
echo '{"verdict":"allow"}'`);
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(dir, ['step', '--resume']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Dispatch Blocked By Hook/);
      assert.match(combined, /dispatch-tamper/);
      assert.match(combined, /hook_bundle_tamper|tampered with protected file/i);

      const updatedState = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      assert.equal(updatedState.status, 'blocked');
      assert.equal(updatedState.current_turn?.turn_id, 'turn_01H');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step blocks validation when a before_validation hook returns block', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.runtimes['local-dev'] = { type: 'manual' };
      config.hooks = {
        before_validation: [{
          name: 'pre-validate-gate',
          type: 'process',
          command: ['./hooks/block-before-validation.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'block-before-validation.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Manual compliance review required before validation"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const staged = makeTurnResult(state, {
        verification: {
          status: 'pass',
          evidence_summary: 'Checked manually.',
        },
      });
      mkdirSync(join(dir, '.agentxchain', 'staging', 'turn_01H'), { recursive: true });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn_01H', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['step', '--resume']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Validation Blocked By Hook/);
      assert.match(combined, /pre-validate-gate/);
      assert.match(combined, /Manual compliance review required before validation/);

      const updatedState = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      assert.equal(updatedState.status, 'blocked');
      assert.equal(updatedState.last_completed_turn_id, 'turn_01G');
      assert.equal(updatedState.current_turn?.turn_id, 'turn_01H');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('step blocks acceptance when an after_validation hook returns block', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.runtimes['local-dev'] = { type: 'manual' };
      config.hooks = {
        after_validation: [{
          name: 'post-validate-gate',
          type: 'process',
          command: ['./hooks/block-after-validation.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'block-after-validation.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Release policy requires manual sign-off after validation"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const staged = makeTurnResult(state, {
        verification: {
          status: 'pass',
          evidence_summary: 'Checked manually.',
        },
      });
      mkdirSync(join(dir, '.agentxchain', 'staging', 'turn_01H'), { recursive: true });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn_01H', 'turn-result.json'), JSON.stringify(staged, null, 2));

      const result = runCli(dir, ['step', '--resume']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Validation Blocked By Hook/);
      assert.match(combined, /post-validate-gate/);
      assert.match(combined, /Release policy requires manual sign-off after validation/);

      const updatedState = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      assert.equal(updatedState.status, 'blocked');
      assert.equal(updatedState.last_completed_turn_id, 'turn_01G');
      assert.equal(updatedState.current_turn?.turn_id, 'turn_01H');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('governed-only command guards on legacy projects', () => {
  const governedOnlyCases = [
    {
      args: ['accept-turn'],
      message: /only available for governed projects/i,
      hint: /Legacy projects use: agentxchain release/i,
    },
    {
      args: ['reject-turn'],
      message: /only available for governed projects/i,
      hint: /Legacy projects use: agentxchain claim \/ release/i,
    },
    {
      args: ['resume'],
      message: /only available for governed projects/i,
      hint: /Legacy projects use: agentxchain start/i,
    },
    {
      args: ['step'],
      message: /only available for governed projects/i,
      hint: /Legacy projects use: agentxchain start/i,
    },
    {
      args: ['approve-transition'],
      message: /approve-transition is only available in governed mode/i,
    },
    {
      args: ['approve-completion'],
      message: /approve-completion is only available in governed mode/i,
    },
  ];

  for (const testCase of governedOnlyCases) {
    it(`${testCase.args[0]} rejects legacy projects before touching governed state`, () => {
      const dir = createLegacyProject();
      try {
        const result = runCli(dir, testCase.args);
        assert.equal(result.status, 1, result.stderr);

        const combined = result.stdout + result.stderr;
        assert.match(combined, testCase.message);
        if (testCase.hint) {
          assert.match(combined, testCase.hint);
        }

        assert.equal(existsSync(join(dir, '.agentxchain')), false, 'guard path should not create governed state');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('malformed config rejection', () => {
  it('rejects invalid JSON in agentxchain.json before any governed side effects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-malformed-'));
    try {
      writeFileSync(join(dir, 'agentxchain.json'), '{ this is not valid json!!!');

      for (const args of [['status'], ['step'], ['resume'], ['validate']]) {
        const result = runCli(dir, args);
        assert.notEqual(result.status, 0, `${args[0]} should fail on malformed JSON`);
        const combined = result.stdout + result.stderr;
        assert.match(combined, /agentxchain\.json|invalid JSON|Warning|No agentxchain/i,
          `${args[0]} should report config parse error`);
      }

      // No governed state files should have been created
      const stateExists = existsSync(join(dir, '.agentxchain', 'state.json'));
      assert.equal(stateExists, false, 'No state.json should be created from malformed config');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects governed config with missing required sections before side effects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-incomplete-'));
    try {
      // Valid JSON but missing roles, runtimes, routing
      writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
        schema_version: '1.0',
        project: { id: 'test', name: 'Test' },
      }));

      for (const args of [['status'], ['step'], ['resume']]) {
        const result = runCli(dir, args);
        const combined = result.stdout + result.stderr;
        // Should fail or warn — not silently proceed
        assert.match(combined, /agentxchain\.json|Warning|issues|No agentxchain/i,
          `${args[0]} should report config validation issues`);
      }

      // No governed state files should have been created
      const stateExists = existsSync(join(dir, '.agentxchain', 'state.json'));
      assert.equal(stateExists, false, 'No state.json should be created from incomplete config');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('concurrent step invocation detection', () => {
  it('step rejects concurrent invocation when a turn is already active', () => {
    const dir = createGovernedProject();
    try {
      // state.json already has an active turn from createGovernedProject()
      const result = runCli(dir, ['step']);
      assert.equal(result.status, 1, 'step should exit non-zero when turn is already active');
      const combined = result.stdout + result.stderr;
      assert.match(combined, /already active/i, 'should report an active turn exists');
      assert.match(combined, /--resume/, 'should suggest --resume to continue waiting');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resume rejects double assignment when a turn is already active', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['resume']);
      assert.notEqual(result.status, 0, 'resume should fail when turn is already active');
      const combined = result.stdout + result.stderr;
      assert.match(combined, /already|active|assigned/i, 'should report existing active turn');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Hook Failure CLI Surface Tests ─────────────────────────────────────────

describe('CLI hook failure surface', () => {
  function createGovernedProjectWithHook(hookScript) {
    const dir = createGovernedProject();

    // Initialize git so observation works
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    // Write the hook script
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hooks', 'tamper-hook.sh'), hookScript, { mode: 0o755 });

    // Add after_acceptance hook to config
    const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    config.hooks = {
      after_acceptance: [{
        name: 'tamper-hook',
        type: 'process',
        command: ['/bin/sh', './hooks/tamper-hook.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));

    // Commit hook and config changes so they don't appear as undeclared changes
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add hooks"', { cwd: dir, stdio: 'ignore' });

    // Stage a valid turn result
    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    const turnId = state.current_turn?.turn_id || Object.keys(state.active_turns || {})[0];
    mkdirSync(join(dir, '.agentxchain', 'staging', turnId), { recursive: true });

    const turnResult = makeTurnResult(state, {
      turn_id: turnId,
      status: 'completed',
      artifact: { type: 'workspace', ref: null },
    });
    writeFileSync(
      join(dir, '.agentxchain', 'staging', turnId, 'turn-result.json'),
      JSON.stringify(turnResult, null, 2),
    );

    // Touch the declared changed file so observation finds it
    writeFileSync(join(dir, 'README.md'), '# Updated\n');

    return { dir, turnId };
  }

  it('accept-turn exits non-zero with hook failure message on post-commit tamper', () => {
    const tamperScript = `#!/bin/sh
# Tamper with state.json after acceptance
echo '{"tampered":true}' > .agentxchain/state.json
echo '{"verdict":"allow"}'
`;
    const { dir } = createGovernedProjectWithHook(tamperScript);
    try {
      const result = runCli(dir, ['accept-turn']);
      assert.notEqual(result.status, 0, 'should exit non-zero on post-commit tamper');
      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Accepted.*Hook Failure|hook.*fail/i,
        'should display hook failure message');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn exits zero when hook succeeds without tamper', () => {
    const cleanScript = `#!/bin/sh
echo '{"verdict":"allow","message":"all good"}'
`;
    const { dir } = createGovernedProjectWithHook(cleanScript);
    try {
      const result = runCli(dir, ['accept-turn']);
      const combined = result.stdout + result.stderr;
      // Should succeed — no tamper, advisory hook allows
      assert.equal(result.status, 0, `Expected success but got: ${combined}`);
      assert.match(combined, /Turn Accepted/i, 'should display acceptance message');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn blocks before validation when a before_validation hook returns block', () => {
    const dir = createGovernedProject();
    try {
      execSync('git init', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
      execSync('git add .', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.hooks = {
        before_validation: [{
          name: 'pre-validate-gate',
          type: 'process',
          command: ['./hooks/pre-validate-gate.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'pre-validate-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"manual review required before validation"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const turnResult = makeTurnResult(state, {
        verification: {
          status: 'pass',
          evidence_summary: 'Checked manually.',
        },
      });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(turnResult, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Acceptance Blocked By Hook/);
      assert.match(combined, /pre-validate-gate/);
      assert.match(combined, /manual review required before validation/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accept-turn blocks after validation when an after_validation hook returns block', () => {
    const dir = createGovernedProject();
    try {
      execSync('git init', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
      execSync('git add .', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.hooks = {
        after_validation: [{
          name: 'post-validate-gate',
          type: 'process',
          command: ['./hooks/post-validate-gate.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'post-validate-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"manual release review required after validation"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const state = readGovernedState(join(dir, '.agentxchain', 'state.json'));
      const turnResult = makeTurnResult(state, {
        verification: {
          status: 'pass',
          evidence_summary: 'Checked manually.',
        },
      });
      writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(turnResult, null, 2));

      const result = runCli(dir, ['accept-turn']);
      assert.equal(result.status, 1, result.stderr);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Acceptance Blocked By Hook/);
      assert.match(combined, /post-validate-gate/);
      assert.match(combined, /manual release review required after validation/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Tests: resume after_dispatch hook enforcement ───────────────────────────

describe('resume after_dispatch hooks', () => {
  it('resume blocks and exits non-zero when after_dispatch hook returns block', () => {
    const dir = createGovernedProject();
    try {
      // Reset to idle with no run so resume can initialize a new run and assign
      const statePath = join(dir, '.agentxchain', 'state.json');
      const idleState = {
        schema_version: '1.0',
        run_id: null,
        project_id: 'baby-tracker',
        status: 'idle',
        phase: 'planning',
        accepted_integration_ref: null,
        current_turn: null,
        blocked_on: null,
        escalation: null,
      };
      writeFileSync(statePath, JSON.stringify(idleState, null, 2));

      // Add after_dispatch blocking hook
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.hooks = {
        after_dispatch: [{
          name: 'block-dispatch',
          type: 'process',
          command: ['./hooks/block-dispatch.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        }],
      };
      writeExecutableHook(dir, 'block-dispatch.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Security review required before dispatch"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(dir, ['resume', '--role', 'pm']);
      assert.equal(result.status, 1, `resume should fail with blocking after_dispatch hook. stderr: ${result.stderr}`);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Dispatch Blocked By Hook/, 'should show structured dispatch hook failure');
      assert.match(combined, /block-dispatch/, 'should name the blocking hook');

      // State should be blocked
      const finalState = readGovernedState(statePath);
      assert.equal(finalState.status, 'blocked');
      assert.match(finalState.blocked_on, /hook:after_dispatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resume succeeds when after_dispatch advisory hook returns block (downgraded to warn)', () => {
    const dir = createGovernedProject();
    try {
      const statePath = join(dir, '.agentxchain', 'state.json');
      const idleState = {
        schema_version: '1.0',
        run_id: null,
        project_id: 'baby-tracker',
        status: 'idle',
        phase: 'planning',
        accepted_integration_ref: null,
        current_turn: null,
        blocked_on: null,
        escalation: null,
      };
      writeFileSync(statePath, JSON.stringify(idleState, null, 2));

      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.hooks = {
        after_dispatch: [{
          name: 'advisory-dispatch',
          type: 'process',
          command: ['./hooks/advisory-dispatch.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        }],
      };
      writeExecutableHook(dir, 'advisory-dispatch.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"advisory block is harmless"}\'');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(dir, ['resume', '--role', 'pm']);
      // Advisory block is downgraded — resume should succeed
      assert.equal(result.status, 0, `resume should succeed with advisory hook. stderr: ${result.stderr}`);

      const combined = result.stdout + result.stderr;
      assert.match(combined, /Turn Assigned/, 'should show turn assigned');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
