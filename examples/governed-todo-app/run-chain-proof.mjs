#!/usr/bin/env node

/**
 * Governed Todo App — Run Chain Proof
 *
 * Proves that `agentxchain run --chain` produces real continuation lineage,
 * inherited-context summaries, and per-run governance artifacts across
 * multiple chained runs on the governed-todo-app example topology.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from 'fs';
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
const MAX_TURNS = 5;
const MAX_CHAINS = 2;
const MAX_ATTEMPTS = 3;

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `governed-todo-app-chain-${randomBytes(4).toString('hex')}`,
      name: 'Governed Todo App — Run Chain Proof',
      description: 'Prove chained governed execution with preserved continuation lineage and inherited context.',
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
        mandate: 'Resolve tactical deadlocks and enforce technical coherence.',
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
      planning_signoff: {},
      implementation_complete: {},
      qa_ship_verdict: {},
    },
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 15.0 },
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
  spawnSync('git', ['config', 'user.name', 'AgentXchain Run Chain Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'agentxchain-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function scaffoldProject(root) {
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
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
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(
    join(root, 'TALK.md'),
    `# Governed Todo App — Run Chain Proof

## Task

Build a minimal todo app with add, list, complete, and delete operations.
Use Node.js with a simple HTTP server and in-memory storage.

## Acceptance Criteria

- POST /todos creates a new todo
- GET /todos lists all todos
- PATCH /todos/:id marks a todo as complete
- DELETE /todos/:id removes a todo
- Each todo has: id, title, completed (boolean), createdAt
`,
  );

  const promptsDir = join(__dirname, '.agentxchain', 'prompts');
  for (const file of ['pm.md', 'dev.md', 'qa.md', 'eng_director.md']) {
    const src = join(promptsDir, file);
    if (existsSync(src)) {
      cpSync(src, join(root, '.agentxchain', 'prompts', file));
    }
  }

  gitInit(root);
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

function readChainReport(root) {
  const reportsDir = join(root, '.agentxchain', 'reports');
  const chainFile = readdirSync(reportsDir).find((name) => name.startsWith('chain-') && name.endsWith('.json'));
  if (!chainFile) return null;
  return JSON.parse(readFileSync(join(reportsDir, chainFile), 'utf8'));
}

function validateArtifacts(root) {
  const rawState = readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8');
  const state = JSON.parse(rawState);
  const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
  const runHistory = readJsonl(join(root, '.agentxchain', 'run-history.jsonl'));
  const chainReport = readChainReport(root);

  const reportArtifacts = (chainReport?.runs || []).map((run) => ({
    run_id: run.run_id,
    export_exists: existsSync(join(root, '.agentxchain', 'reports', `export-${run.run_id}.json`)),
    report_exists: existsSync(join(root, '.agentxchain', 'reports', `report-${run.run_id}.md`)),
  }));

  return {
    state: {
      valid: ['completed', 'blocked'].includes(state.status) && Boolean(state.run_id),
      sha256: sha256(rawState),
      status: state.status,
      run_id: state.run_id,
      inherited_parent_run_id: state.inherited_context?.parent_run_id || null,
    },
    history: {
      valid: history.length >= 6,
      entry_count: history.length,
      real_api_calls: history.filter((entry) => (entry.cost?.usd || 0) > 0).length,
      total_cost_usd: history.reduce((sum, entry) => sum + (entry.cost?.usd || 0), 0),
    },
    run_history: {
      valid: runHistory.length >= 2,
      entries: runHistory.map((entry) => ({
        run_id: entry.run_id,
        status: entry.status,
        trigger: entry.provenance?.trigger || null,
        parent_run_id: entry.provenance?.parent_run_id || null,
      })),
    },
    chain_report: {
      valid: Boolean(chainReport) && chainReport.runs?.length >= 2,
      terminal_reason: chainReport?.terminal_reason || null,
      runs: chainReport?.runs || [],
      artifact_reports: reportArtifacts,
    },
  };
}

function runCli(root) {
  return spawnSync(
    process.execPath,
    [
      binPath,
      'run',
      '--chain',
      '--max-chains',
      String(MAX_CHAINS),
      '--chain-cooldown',
      '0',
      '--auto-approve',
      '--max-turns',
      String(MAX_TURNS),
    ],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      timeout: 420000,
    },
  );
}

function buildPayload(passed, cliResult, artifacts, errors) {
  const stdout = cliResult?.stdout || '';
  const stderr = cliResult?.stderr || '';
  return {
    runner: 'governed-todo-app-run-chain-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result: passed ? 'pass' : 'fail',
    cli_exit_status: cliResult?.status ?? null,
    stdout_tail: stdout.trim().split('\n').slice(-20),
    stderr_tail: stderr.trim().split('\n').slice(-20),
    artifacts,
    errors,
  };
}

function formatResult(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(`Governed Todo App Run-Chain Proof — agentxchain v${cliPkg.version}`);
  if (payload.result === 'pass') {
    console.log(`  Chain runs: ${payload.artifacts.chain_report.runs.map((run) => run.run_id).join(' -> ')}`);
    console.log(`  Total turns: ${payload.artifacts.history.entry_count}`);
    console.log(`  Total cost: $${payload.artifacts.history.total_cost_usd.toFixed(4)}`);
    console.log(`  Terminal: ${payload.artifacts.chain_report.terminal_reason}`);
    console.log('  Result: PASS — chained governed execution preserved continuation lineage and inherited context');
    return;
  }

  console.log('  Result: FAIL');
  for (const error of payload.errors) {
    console.log(`  Error: ${error}`);
  }
}

async function attempt() {
  const root = join(tmpdir(), `axc-todo-chain-${randomBytes(6).toString('hex')}`);
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
    if (!combined.includes('Chain Summary')) {
      errors.push('CLI output did not include "Chain Summary"');
    }
    if (!combined.match(/Total runs:\s+[2-9]/)) {
      errors.push('CLI output did not report at least 2 total runs');
    }

    artifacts = validateArtifacts(root);
    if (!artifacts.state.valid) errors.push(`final state is not terminal (got ${artifacts.state.status})`);
    if (!artifacts.history.valid) errors.push(`expected ≥6 accepted turns, got ${artifacts.history.entry_count}`);
    if (artifacts.history.real_api_calls < 6) {
      errors.push(`expected ≥6 real API calls, got ${artifacts.history.real_api_calls}`);
    }
    if (!artifacts.run_history.valid) {
      errors.push(`expected ≥2 run-history entries, got ${artifacts.run_history.entries.length}`);
    }
    if (!artifacts.chain_report.valid) {
      errors.push('chain report missing or does not include a continuation run');
    }

    const [firstRun, secondRun, thirdRun] = artifacts.chain_report.runs;
    if (!firstRun || !secondRun) {
      errors.push('chain report does not contain an initial run plus a continuation');
    } else {
      if (firstRun.provenance_trigger !== 'manual') errors.push('first run must be manual');
      if (secondRun.provenance_trigger !== 'continuation') errors.push('second run must be continuation');
      if (secondRun.parent_run_id !== firstRun.run_id) errors.push('second run must point to first run as parent');
      if (secondRun.inherited_context_summary?.parent_run_id !== firstRun.run_id) {
        errors.push('second run inherited_context_summary must point to first run');
      }
      if ((secondRun.inherited_context_summary?.recent_accepted_turns_count || 0) < 1) {
        errors.push('second run inherited_context_summary must include accepted-turn summaries');
      }
      if (thirdRun) {
        if (thirdRun.provenance_trigger !== 'continuation') errors.push('third run must be continuation when present');
        if (thirdRun.parent_run_id !== secondRun.run_id) errors.push('third run must point to second run as parent when present');
        if (thirdRun.inherited_context_summary?.parent_run_id !== secondRun.run_id) {
          errors.push('third run inherited_context_summary must point to second run when present');
        }
      }
    }

    for (const reportArtifact of artifacts.chain_report.artifact_reports) {
      if (!reportArtifact.export_exists) errors.push(`missing export for ${reportArtifact.run_id}`);
      if (!reportArtifact.report_exists) errors.push(`missing report for ${reportArtifact.run_id}`);
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

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required for api_proxy dispatch');
  process.exit(1);
}

const attempts = [];
let lastPayload = null;
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  const outcome = await attempt();
  lastPayload = outcome.payload;
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

const failurePayload = {
  ...(lastPayload || {
    runner: 'governed-todo-app-run-chain-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result: 'fail',
    cli_exit_status: attempts[attempts.length - 1]?.cli_exit_status ?? null,
    stdout_tail: [],
    stderr_tail: [],
    artifacts: null,
    errors: attempts[attempts.length - 1]?.errors || ['Proof failed without a captured error.'],
  }),
  result: 'fail',
  attempts_used: attempts.length,
  attempt_history: attempts,
};
formatResult(failurePayload);
process.exit(1);
