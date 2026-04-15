import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const dirs = [];

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function setupProject(mutator) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-runtime-guidance-'));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');

  const configPath = join(dir, 'agentxchain.json');
  const statePath = join(dir, '.agentxchain', 'state.json');
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'runtime-guidance-fixture', name: 'Runtime Guidance Fixture', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Plan.', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
      eng_director: { title: 'Engineering Director', mandate: 'Unblock.', write_authority: 'review_only', runtime: 'manual-pm' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-qa': { type: 'manual' },
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'eng_director', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['qa', 'eng_director', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
      },
    },
    budget: { per_turn_max_usd: 2, per_run_max_usd: 10 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
  const state = {
    schema_version: '1.1',
    project_id: 'runtime-guidance-fixture',
    run_id: 'run_runtime_guidance_001',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 1,
    last_completed_turn_id: 'turn_dev_001',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: {
      gate_type: 'phase_transition',
      gate_id: 'implementation_complete',
      phase: 'implementation',
      from_phase: 'implementation',
      to_phase: 'qa',
      requested_by_turn: 'turn_dev_001',
      failed_at: '2026-04-15T18:00:00.000Z',
      queued_request: false,
      reasons: ['Missing file: .planning/IMPLEMENTATION_NOTES.md'],
      missing_files: ['.planning/IMPLEMENTATION_NOTES.md'],
      missing_verification: false,
    },
    phase_gate_status: {
      planning_signoff: 'passed',
      implementation_complete: 'failed',
      qa_ship_verdict: 'pending',
    },
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 10 },
  };

  mutator(config, state);

  writeJson(configPath, config);
  writeJson(statePath, state);
  writeFileSync(join(dir, 'TALK.md'), '# Talk\n');

  return dir;
}

after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('status runtime-aware guidance', () => {
  it('AT-SRG-001: proposed remote ownership blocker suggests proposal apply', () => {
    const dir = setupProject((config) => {
      config.roles.dev.write_authority = 'proposed';
      config.roles.dev.runtime = 'remote-dev';
      config.runtimes['remote-dev'] = {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
      };
    });
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Runtime guidance:/);
    assert.match(result.stdout, /proposal_apply_required — agentxchain proposal apply turn_dev_001/);
    assert.match(result.stdout, /IMPLEMENTATION_NOTES\.md/);
  });

  it('AT-SRG-002: invalid local_cli review-only binding suggests config repair', () => {
    const dir = setupProject((config) => {
      config.roles.dev.write_authority = 'review_only';
    });
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /invalid_binding — Edit agentxchain\.json for role "dev", then run agentxchain validate/);
    assert.match(result.stdout, /review_only\/local_cli resolves to invalid_review_only_binding/);
  });

  it('AT-SRG-003: MCP ownership ambiguity suggests role-contract inspection', () => {
    const dir = setupProject((config) => {
      config.roles.dev.write_authority = 'authoritative';
      config.roles.dev.runtime = 'mcp-dev';
      config.runtimes['mcp-dev'] = {
        type: 'mcp',
        command: ['node', '-e', 'process.exit(0)'],
      };
    });
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /tool_defined_proof_not_strong_enough — agentxchain role show dev/);
    assert.match(result.stdout, /tool-defined and not statically provable/i);
  });
});
