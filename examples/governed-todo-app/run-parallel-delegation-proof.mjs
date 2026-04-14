#!/usr/bin/env node

/**
 * Governed Todo App — Parallel Delegation Proof
 *
 * Proves that delegation children execute concurrently when max_concurrent_turns > 1.
 * This composes DEC-DELEGATION-CHAINS-001 with DEC-PARALLEL-RUN-LOOP-001.
 *
 * Approach:
 * 1. `step` — director seed turn (establishes 2 delegations)
 * 2. `git checkpoint` (clean baseline for delegated turns)
 * 3. `run --auto-approve` — continues the active run; dev+qa dispatch concurrently
 *    via max_concurrent_turns: 2, then director review completes
 *
 * Validation:
 * - 4 history entries: director → dev + qa (concurrent) → director (review)
 * - AGENTXCHAIN_TURN_ID env var present in delegation child summaries
 * - Delegation review summary references both delegation IDs
 * - Final status: completed
 *
 * Usage:
 *   node examples/governed-todo-app/run-parallel-delegation-proof.mjs [--json]
 *
 * Exit codes:
 *   0 — parallel delegation dispatch observed, governance artifacts valid
 *   1 — run failed or parallel delegation not observed
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'parallel-delegation-mock-agent.mjs');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
    },
  });
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'AgentXchain Parallel Delegation Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'parallel-delegation-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function gitCheckpoint(root, message) {
  spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  spawnSync('git', ['commit', '--allow-empty', '-m', message], { cwd: root, stdio: 'ignore' });
}

function makeConfig() {
  const runtime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `parallel-delegation-proof-${randomBytes(4).toString('hex')}`,
      name: 'Parallel Delegation CLI Proof',
      description: 'Prove that delegation children execute concurrently when max_concurrent_turns > 1.',
      default_branch: 'main',
    },
    roles: {
      director: {
        title: 'Engineering Director',
        mandate: 'Decompose work, delegate it, then review the delegated results.',
        write_authority: 'authoritative',
        runtime: 'local-director',
        runtime_class: 'local_cli',
        runtime_id: 'local-director',
      },
      dev: {
        title: 'Developer',
        mandate: 'Execute delegated implementation work.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Execute delegated review work.',
        write_authority: 'authoritative',
        runtime: 'local-qa',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
      },
    },
    runtimes: {
      'local-director': runtime,
      'local-dev': runtime,
      'local-qa': runtime,
    },
    routing: {
      delivery: {
        entry_role: 'director',
        allowed_next_roles: ['director', 'dev', 'qa', 'human'],
        max_concurrent_turns: 2,
        exit_gate: 'delivery_signoff',
      },
    },
    phases: ['delivery'],
    gates: {
      delivery_signoff: {},
    },
    budget: {
      per_turn_max_usd: 1,
      per_run_max_usd: 5,
    },
    rules: {
      challenge_required: false,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
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
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), makeConfig());
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'parallel-delegation-proof',
    status: 'idle',
    phase: 'delivery',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  });
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(
    join(root, 'TALK.md'),
    '# Parallel Delegation CLI Proof\n\nProve director delegates to dev + qa concurrently, then reviews aggregated results.\n',
  );
  gitInit(root);
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'parallel-delegation-cli-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result,
    artifacts,
    traces,
    errors,
  };
}

function printPayload(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(`Parallel Delegation CLI Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run:            ${payload.artifacts.run_id}`);
    console.log(`  Roles:          ${payload.artifacts.role_order.join(' -> ')}`);
    console.log(`  Concurrent:     ${payload.artifacts.concurrent_dispatch ? 'YES' : 'NO'}`);
    console.log(`  TURN_ID env:    dev=${payload.artifacts.env_turn_ids.dev || 'not-found'}, qa=${payload.artifacts.env_turn_ids.qa || 'not-found'}`);
    console.log(`  Review:         ${payload.artifacts.review_references_both_delegations ? 'both delegations referenced' : 'MISSING'}`);
    console.log('  Result:         PASS — parallel delegation completed through the real run loop');
    return;
  }

  console.log('  Result:         FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:          ${error}`);
  }
}

async function main() {
  const root = join(tmpdir(), `axc-pardel-proof-${randomBytes(6).toString('hex')}`);
  const errors = [];
  const traces = [];

  try {
    mkdirSync(root, { recursive: true });
    scaffoldProject(root);

    // ── Step 1: Director seed turn (sequential, establishes delegations) ───
    const stepResult = runCli(root, ['step']);
    traces.push({ phase: 'seed', exitCode: stepResult.status });

    if (stepResult.status !== 0) {
      errors.push(`step (director seed) exited with code ${stepResult.status}: ${(stepResult.stdout + stepResult.stderr).slice(0, 300)}`);
    }

    // Verify delegation queue was populated
    const postSeedState = existsSync(join(root, '.agentxchain', 'state.json'))
      ? readJson(join(root, '.agentxchain', 'state.json'))
      : {};
    const queueLength = (postSeedState.delegation_queue || []).length;
    if (queueLength !== 2) {
      errors.push(`expected 2 queued delegations after director seed, got ${queueLength}`);
    }

    // Checkpoint for clean baseline
    gitCheckpoint(root, 'proof: director delegation seed');

    // ── Step 2: Run with parallel dispatch for delegation children + review ─
    const runResult = runCli(root, ['run', '--auto-approve', '--max-turns', '10']);
    traces.push({ phase: 'parallel-run', exitCode: runResult.status, stdout: runResult.stdout });

    if (runResult.status !== 0) {
      errors.push(`run (parallel delegation) exited with code ${runResult.status}: ${(runResult.stdout + runResult.stderr).slice(0, 500)}`);
    }

    // ── Validate governance artifacts ──────────────────────────────────────
    const finalState = existsSync(join(root, '.agentxchain', 'state.json'))
      ? readJson(join(root, '.agentxchain', 'state.json'))
      : {};
    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    const roleOrder = history.map((e) => e.role);

    // Expect 4 history entries: director (seed), dev, qa, director (review)
    if (history.length !== 4) {
      errors.push(`expected 4 history entries, got ${history.length}`);
    }

    if (roleOrder[0] !== 'director') {
      errors.push(`expected first role director, got ${roleOrder[0]}`);
    }

    // Middle two should be dev and qa in some order (concurrency may reorder)
    const middleRoles = roleOrder.slice(1, 3).sort();
    if (JSON.stringify(middleRoles) !== JSON.stringify(['dev', 'qa'])) {
      errors.push(`expected middle roles [dev, qa], got [${middleRoles.join(', ')}]`);
    }

    if (roleOrder[3] !== 'director') {
      errors.push(`expected last role director (review), got ${roleOrder[3]}`);
    }

    if (finalState.status !== 'completed') {
      errors.push(`expected final status completed, got ${finalState.status}`);
    }

    if (finalState.pending_delegation_review !== null) {
      errors.push('expected pending_delegation_review to be cleared');
    }

    // ── Validate AGENTXCHAIN_TURN_ID was passed ────────────────────────────
    const devEntry = history.find((h) => h.role === 'dev');
    const qaEntry = history.find((h) => h.role === 'qa');

    const devTurnId = devEntry?.summary?.match(/AGENTXCHAIN_TURN_ID=(turn_[a-f0-9]+)/)?.[1] || null;
    const qaTurnId = qaEntry?.summary?.match(/AGENTXCHAIN_TURN_ID=(turn_[a-f0-9]+)/)?.[1] || null;

    if (!devTurnId) {
      errors.push('dev summary missing AGENTXCHAIN_TURN_ID — env var not passed');
    }
    if (!qaTurnId) {
      errors.push('qa summary missing AGENTXCHAIN_TURN_ID — env var not passed');
    }
    if (devTurnId && qaTurnId && devTurnId === qaTurnId) {
      errors.push(`dev and qa received same AGENTXCHAIN_TURN_ID (${devTurnId}) — turn resolution broken`);
    }

    // ── Validate concurrent dispatch ───────────────────────────────────────
    const devConcurrent = Array.isArray(devEntry?.concurrent_with) && devEntry.concurrent_with.length > 0;
    const qaConcurrent = Array.isArray(qaEntry?.concurrent_with) && qaEntry.concurrent_with.length > 0;
    const concurrentDispatch = devConcurrent || qaConcurrent;

    if (!concurrentDispatch && history.length >= 3) {
      errors.push('no concurrent_with found on delegation children — not dispatched in parallel');
    }

    // ── Validate delegation review references both delegations ─────────────
    const reviewEntry = history.length >= 4 ? history[3] : null;
    const reviewRefsBoth = reviewEntry?.summary?.includes('del-001') && reviewEntry?.summary?.includes('del-002');
    if (reviewEntry && !reviewRefsBoth) {
      errors.push('review summary does not reference both delegation IDs');
    }

    // ── Validate delegation history retention ──────────────────────────────
    const directorSeed = history[0];
    if (!directorSeed?.delegations_issued) {
      errors.push('director seed entry missing delegations_issued in history');
    }
    if (devEntry && !devEntry?.delegation_context) {
      errors.push('dev entry missing delegation_context in history');
    }
    if (reviewEntry && !reviewEntry?.delegation_review) {
      errors.push('review entry missing delegation_review in history');
    }

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        run_id: finalState.run_id,
        final_status: finalState.status,
        role_order: roleOrder,
        concurrent_dispatch: concurrentDispatch,
        env_turn_ids: {
          dev: devTurnId,
          qa: qaTurnId,
        },
        review_references_both_delegations: reviewRefsBoth,
      },
    });
    printPayload(payload);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch (error) {
    const payload = buildPayload({
      result: 'fail',
      errors: [error.message],
      traces,
      artifacts: null,
    });
    printPayload(payload);
    process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
