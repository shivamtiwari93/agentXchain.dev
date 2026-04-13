#!/usr/bin/env node

/**
 * Governed Todo App — Auto-Run Proof
 *
 * Proves a real 4-role product example can complete end-to-end via
 * `agentxchain run --auto-approve` with real API dispatch.
 *
 * The harness transforms the governed-todo-app config:
 * - Replaces all adapters (manual, local_cli) with api_proxy (Haiku)
 * - All roles use review_only write authority (api_proxy constraint)
 * - Removes requires_files and requires_human_approval from gates
 * - Preserves 4 roles, 3 phases, routing structure, and prompts
 *
 * Usage:
 *   node examples/governed-todo-app/run-auto.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 *
 * Exit codes:
 *   0 — all 4 roles participated, governance artifacts valid
 *   1 — run failed or proof artifacts invalid
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes('--json');
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 12;
const MAX_ATTEMPTS = 3;

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `governed-todo-app-auto-${randomBytes(4).toString('hex')}`,
      name: 'Governed Todo App — Auto Run',
      description: 'Build a minimal todo app with add, list, complete, and delete operations. Express API + in-memory store.',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'The task is: build a todo app with add, list, complete, and delete operations. Produce a one-paragraph plan with acceptance criteria for this task. Then set phase_transition_request to "implementation".',
        write_authority: 'review_only',
        runtime: 'api-pm',
        runtime_class: 'api_proxy',
        runtime_id: 'api-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Review the plan produced by PM. Describe how you would implement the todo app with Node.js HTTP endpoints: POST /todos, GET /todos, PATCH /todos/:id, DELETE /todos/:id. Then set phase_transition_request to "qa".',
        write_authority: 'review_only',
        runtime: 'api-dev',
        runtime_class: 'api_proxy',
        runtime_id: 'api-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Review the implementation plan. Confirm it covers add, list, complete, and delete operations. Raise one observation about test coverage. Then set run_completion_request to true.',
        write_authority: 'review_only',
        runtime: 'api-qa',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
      eng_director: {
        title: 'Engineering Director',
        mandate: 'Resolve tactical deadlocks and enforce technical coherence. Only invoked when PM/Dev/QA loop is stuck.',
        write_authority: 'review_only',
        runtime: 'api-director',
        runtime_class: 'api_proxy',
        runtime_id: 'api-director',
      },
    },
    runtimes: {
      'api-pm': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-qa': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-director': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
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
        allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      // Empty gates: api_proxy roles cannot write files to disk, so
      // requires_files predicates would never pass. Phase advancement
      // is driven solely by phase_transition_request / run_completion_request.
      planning_signoff: {},
      implementation_complete: {},
      qa_ship_verdict: {},
    },
    budget: { per_turn_max_usd: 1.00, per_run_max_usd: 5.00 },
    rules: { challenge_required: false, max_turn_retries: 3, max_deadlock_cycles: 2 },
    workflow_kit: {},
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'AgentXchain Auto-Run Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'agentxchain-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function scaffoldProject(root) {
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  // Write config
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  // Write state
  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_id: config.project.id,
        status: 'idle',
        phase: 'planning',
        run_id: null,
        turn_sequence: 0,
        active_turns: {},
        next_role: null,
        pending_phase_transition: null,
        pending_run_completion: null,
        blocked_on: null,
        blocked_reason: null,
      },
      null,
      2,
    ),
  );

  // Write empty history and ledger
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  // Write TALK.md with task description
  writeFileSync(
    join(root, 'TALK.md'),
    `# Governed Todo App — Auto Run Proof\n\n## Task\n\nBuild a minimal todo app with add, list, complete, and delete operations.\nUse Node.js with a simple HTTP server and in-memory storage.\n\n## Acceptance Criteria\n\n- POST /todos creates a new todo\n- GET /todos lists all todos\n- PATCH /todos/:id marks a todo as complete\n- DELETE /todos/:id removes a todo\n- Each todo has: id, title, completed (boolean), createdAt\n`,
  );

  // Copy prompts from the real governed-todo-app example
  const promptsDir = join(__dirname, '.agentxchain', 'prompts');
  for (const file of ['pm.md', 'dev.md', 'qa.md', 'eng_director.md']) {
    const src = join(promptsDir, file);
    if (existsSync(src)) {
      cpSync(src, join(root, '.agentxchain', 'prompts', file));
    }
  }

  gitInit(root);
  return config;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function validateArtifacts(root) {
  const rawState = readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8');
  const state = JSON.parse(rawState);
  const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
  const ledger = readJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'));
  const talk = readFileSync(join(root, 'TALK.md'), 'utf8');

  const runId = state.run_id || 'unknown';
  const exportPath = join(root, '.agentxchain', 'reports', `export-${runId}.json`);
  const reportPath = join(root, '.agentxchain', 'reports', `report-${runId}.md`);

  const distinctRoles = [...new Set(history.map((e) => e.role))];

  return {
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at),
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
      run_id: runId,
    },
    history: {
      valid: history.length >= 3,
      entry_count: history.length,
      roles: history.map((e) => e.role),
      distinct_roles: distinctRoles,
      distinct_role_count: distinctRoles.length,
    },
    ledger: {
      valid: ledger.length >= 2,
      entry_count: ledger.length,
    },
    talk: {
      valid: ['pm', 'dev', 'qa'].every((role) => talk.toLowerCase().includes(role)),
      sha256: sha256(talk),
    },
    reports: {
      export_path: exportPath,
      report_path: reportPath,
      export_exists: existsSync(exportPath),
      report_exists: existsSync(reportPath),
    },
    cost: {
      total_usd: history.reduce((sum, e) => sum + (e.cost?.usd || 0), 0),
      per_turn: history.map((e) => ({ role: e.role, usd: e.cost?.usd || 0 })),
      real_api_calls: history.filter((e) => (e.cost?.usd || 0) > 0).length,
    },
  };
}

function runCli(root) {
  return spawnSync(
    process.execPath,
    [binPath, 'run', '--auto-approve', '--max-turns', String(MAX_TURNS)],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      timeout: 300000, // 5 min — 4 roles need more time than 2
    },
  );
}

function formatResult(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.result === 'pass') {
    console.log(`Governed Todo App Auto-Run Proof — agentxchain v${cliPkg.version}`);
    console.log(`  CLI:     ${binPath}`);
    console.log(`  Roles:   ${payload.artifacts.history.roles.join(' -> ')}`);
    console.log(`  Distinct: ${payload.artifacts.history.distinct_roles.join(', ')} (${payload.artifacts.history.distinct_role_count} roles)`);
    console.log(`  Turns:   ${payload.artifacts.history.entry_count} accepted`);
    console.log(`  Cost:    $${payload.artifacts.cost.total_usd.toFixed(4)} total`);
    console.log(`  Run ID:  ${payload.artifacts.state.run_id}`);
    console.log(`  Report:  ${payload.artifacts.reports.report_path}`);
    console.log('  Result:  PASS — 4-role product example completed unattended governed execution');
  } else {
    console.log(`Governed Todo App Auto-Run Proof — agentxchain v${cliPkg.version}`);
    console.log('  Result:  FAIL');
    for (const error of payload.errors) {
      console.log(`  Error:   ${error}`);
    }
  }
}

function buildPayload(passed, cliResult, artifacts, errors) {
  const stdout = cliResult?.stdout || '';
  const stderr = cliResult?.stderr || '';
  return {
    runner: 'governed-todo-app-auto-run-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result: passed ? 'pass' : 'fail',
    cli_exit_status: cliResult?.status ?? null,
    stdout_tail: stdout.trim().split('\n').slice(-15),
    stderr_tail: stderr.trim().split('\n').slice(-15),
    artifacts: artifacts
      ? {
          state: artifacts.state,
          history: artifacts.history,
          ledger: artifacts.ledger,
          reports: artifacts.reports,
          cost: artifacts.cost,
        }
      : null,
    errors,
  };
}

async function attempt() {
  const root = join(tmpdir(), `axc-todo-auto-${randomBytes(6).toString('hex')}`);
  const errors = [];
  let cliResult = null;
  let artifacts = null;

  try {
    mkdirSync(root, { recursive: true });
    scaffoldProject(root);
    cliResult = runCli(root);

    if (cliResult.error) {
      errors.push(`CLI spawn failed: ${cliResult.error.message}`);
    }

    if (cliResult.status !== 0) {
      errors.push(`expected CLI exit 0, got ${cliResult.status}`);
    }

    const combined = `${cliResult.stdout || ''}\n${cliResult.stderr || ''}`;
    if (!combined.includes('Run completed')) {
      errors.push('CLI output did not include "Run completed"');
    }

    artifacts = validateArtifacts(root);
    if (!artifacts.state.valid) errors.push('final state is not completed');
    if (!artifacts.history.valid) errors.push(`expected ≥3 turns, got ${artifacts.history.entry_count}`);
    if (artifacts.history.distinct_role_count < 3) {
      errors.push(`expected ≥3 distinct roles, got ${artifacts.history.distinct_role_count}: ${artifacts.history.distinct_roles.join(', ')}`);
    }
    if (!artifacts.ledger.valid) errors.push('decision ledger has < 2 entries');
    if (!artifacts.talk.valid) errors.push('TALK.md does not reference all core roles');
    if (!artifacts.reports.export_exists) errors.push('governance export not generated');
    if (!artifacts.reports.report_exists) errors.push('governance report not generated');
    if (artifacts.cost.real_api_calls < 3) {
      errors.push(`expected ≥3 real API calls, got ${artifacts.cost.real_api_calls}`);
    }

    const passed = errors.length === 0;
    return { passed, payload: buildPayload(passed, cliResult, artifacts, errors) };
  } catch (err) {
    errors.push(`Unexpected: ${err.message}`);
    return { passed: false, payload: buildPayload(false, cliResult, artifacts, errors) };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}

// --- main ---

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required for api_proxy dispatch');
  process.exit(1);
}

const attempts = [];
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  const outcome = await attempt();
  attempts.push({
    attempt: i,
    result: outcome.passed ? 'pass' : 'fail',
    cli_exit_status: outcome.payload.cli_exit_status,
    errors: outcome.payload.errors,
  });
  if (outcome.passed) {
    if (jsonMode) {
      outcome.payload.attempts_used = i;
      outcome.payload.attempt_history = attempts;
    }
    formatResult(outcome.payload);
    process.exit(0);
  }
  if (i < MAX_ATTEMPTS && !jsonMode) {
    console.log(`\n  Retrying (attempt ${i + 1}/${MAX_ATTEMPTS})...\n`);
  }
}

const last = attempts[attempts.length - 1];
formatResult({
  runner: 'governed-todo-app-auto-run-proof',
  cli_version: cliPkg.version,
  cli_path: binPath,
  result: 'fail',
  cli_exit_status: last?.cli_exit_status ?? null,
  attempts_used: attempts.length,
  attempt_history: attempts,
  errors: last?.errors || ['Proof failed without a captured error.'],
});
process.exit(1);
