#!/usr/bin/env node

/**
 * CI CLI Auto-Approve Proof — proves the shipped `agentxchain run` surface
 * can complete an unattended governed run in CI using real api_proxy dispatch.
 *
 * Usage:
 *   node examples/ci-runner-proof/run-via-cli-auto-approve.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 *
 * Exit codes:
 *   0 — CLI completed the governed run and the artifacts are valid
 *   1 — the CLI failed or the proof artifacts are invalid
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { gitInit } from './git-helpers.mjs';

const jsonMode = process.argv.includes('--json');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `ci-cli-auto-approve-${randomBytes(4).toString('hex')}`,
      name: 'CI CLI Auto-Approve Proof',
      description: 'Build a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /.',
      default_branch: 'main',
    },
    roles: {
      planner: {
        title: 'Planner',
        mandate: 'The task is: build a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /. Produce a one-paragraph plan for this task. Then set phase_transition_request to "review".',
        write_authority: 'review_only',
        runtime: 'api-planner',
        runtime_class: 'api_proxy',
        runtime_id: 'api-planner',
      },
      reviewer: {
        title: 'Reviewer',
        mandate: 'Review the plan produced by the planner for the hello-world server task. Confirm it is reasonable. Then set run_completion_request to true.',
        write_authority: 'review_only',
        runtime: 'api-reviewer',
        runtime_class: 'api_proxy',
        runtime_id: 'api-reviewer',
      },
    },
    runtimes: {
      'api-planner': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 2048,
        timeout_seconds: 60,
      },
      'api-reviewer': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 2048,
        timeout_seconds: 60,
      },
    },
    routing: {
      planning: {
        entry_role: 'planner',
        allowed_next_roles: ['planner', 'reviewer', 'human'],
        exit_gate: 'planning_done',
      },
      review: {
        entry_role: 'reviewer',
        allowed_next_roles: ['planner', 'reviewer', 'human'],
        exit_gate: 'review_done',
      },
    },
    gates: {
      planning_done: {},
      review_done: {},
    },
    budget: { per_turn_max_usd: 0.50, per_run_max_usd: 2.00 },
    rules: { challenge_required: false, max_turn_retries: 3, max_deadlock_cycles: 1 },
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

function scaffoldProject(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
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
  writeFileSync(join(root, 'TALK.md'), '# Talk\n\n## Task\n\nBuild a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /.\n');
  gitInit(root);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonl(path) {
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
  const exportPath = join(root, '.agentxchain', 'reports', `export-${state.run_id}.json`);
  const reportPath = join(root, '.agentxchain', 'reports', `report-${state.run_id}.md`);

  return {
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at),
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
      run_id: state.run_id,
    },
    history: {
      valid: history.length >= 2,
      entry_count: history.length,
      roles: history.map((entry) => entry.role),
    },
    ledger: {
      valid: ledger.length >= 2,
      entry_count: ledger.length,
    },
    talk: {
      valid: ['planner', 'reviewer'].every((role) => talk.includes(role)),
      sha256: sha256(talk),
    },
    reports: {
      export_path: exportPath,
      report_path: reportPath,
      export_exists: existsSync(exportPath),
      report_exists: existsSync(reportPath),
    },
    cost: {
      total_usd: history.reduce((sum, entry) => sum + (entry.cost?.usd || 0), 0),
      per_turn: history.map((entry) => ({ role: entry.role, usd: entry.cost?.usd || 0 })),
      real_api_calls: history.filter((entry) => (entry.cost?.usd || 0) > 0).length,
    },
  };
}

function runCli(root) {
  return spawnSync(
    process.execPath,
    [binPath, 'run', '--auto-approve', '--max-turns', '6'],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      timeout: 180000,
    },
  );
}

function formatResult(passed, cliResult, artifacts, errors) {
  const stdout = cliResult?.stdout || '';
  const stderr = cliResult?.stderr || '';
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          runner: 'ci-cli-auto-approve-proof',
          cli_version: cliPkg.version,
          cli_path: binPath,
          result: passed ? 'pass' : 'fail',
          cli_exit_status: cliResult?.status ?? null,
          stdout_tail: stdout.trim().split('\n').slice(-12),
          stderr_tail: stderr.trim().split('\n').slice(-12),
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
        },
        null,
        2,
      ),
    );
  } else if (passed) {
    console.log(`CI CLI Auto-Approve Proof — agentxchain v${cliPkg.version}`);
    console.log(`  CLI:     ${binPath}`);
    console.log(`  Roles:   ${artifacts.history.roles.join(' -> ')}`);
    console.log(`  Turns:   ${artifacts.history.entry_count} accepted`);
    console.log(`  Cost:    $${artifacts.cost.total_usd.toFixed(4)} total`);
    console.log(`  Report:  ${artifacts.reports.report_path}`);
    console.log('  Result:  PASS — CLI completed unattended governed execution via real API dispatch');
  } else {
    console.log(`CI CLI Auto-Approve Proof — agentxchain v${cliPkg.version}`);
    console.log('  Result:  FAIL');
    for (const error of errors) {
      console.log(`  Error:   ${error}`);
    }
  }
}

async function main() {
  const root = join(tmpdir(), `axc-ci-cli-proof-${randomBytes(6).toString('hex')}`);
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
      errors.push(`expected CLI exit status 0, got ${cliResult.status}`);
    }

    const combined = `${cliResult.stdout || ''}\n${cliResult.stderr || ''}`;
    if (!combined.includes('Run completed')) {
      errors.push('CLI output did not include "Run completed"');
    }

    artifacts = validateArtifacts(root);
    if (!artifacts.state.valid) errors.push('final state artifact is invalid');
    if (!artifacts.history.valid) errors.push('history does not contain at least 2 accepted turns');
    if (!artifacts.ledger.valid) errors.push('decision ledger does not contain at least 2 entries');
    if (!artifacts.talk.valid) errors.push('TALK.md does not include all role entries');
    if (!artifacts.reports.export_exists) errors.push('governance export was not generated');
    if (!artifacts.reports.report_exists) errors.push('governance report was not generated');
    if (artifacts.cost.real_api_calls < 2) {
      errors.push(
        `expected at least 2 turns with real API cost, got ${artifacts.cost.real_api_calls}`,
      );
    }

    const passed = errors.length === 0;
    formatResult(passed, cliResult, artifacts, errors);
    return passed;
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    formatResult(false, cliResult, artifacts, errors);
    return false;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}

// Retry wrapper: cheap models have transient hallucination failures
const MAX_ATTEMPTS = 3;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const passed = await main();
  if (passed) process.exit(0);
  if (attempt < MAX_ATTEMPTS) {
    if (!jsonMode) console.log(`\n  Retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...\n`);
  }
}
process.exit(1);
