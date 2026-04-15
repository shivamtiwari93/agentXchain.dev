#!/usr/bin/env node

/**
 * Cross-run decision carryover proof.
 *
 * Proves that decisions with durability: "repo" persist across governed runs
 * and that override chains work correctly.
 *
 * Flow:
 *   Run 1: agent emits DEC-100 with durability: "repo" → completes
 *   Verify: repo-decisions.jsonl contains the decision
 *   Run 2: new run starts → verify DEC-100 injected into state
 *   Run 2: agent overrides DEC-100 with DEC-200 → completes
 *   Verify: DEC-100 is overridden, DEC-200 is active
 *   CLI:   agentxchain decisions shows correct state
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
const mockAgentPath = join(cliRoot, 'test-support', 'decision-carryover-mock-agent.mjs');
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

function runCli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
      ...env,
    },
  });
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'Decision Carryover Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'carryover-proof@example.invalid'], opts);
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
      id: `carryover-proof-${randomBytes(4).toString('hex')}`,
      name: 'Decision Carryover Proof',
      description: 'Prove repo-durable decisions persist across runs.',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement and make decisions.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': runtime,
    },
    routing: {
      delivery: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
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
    project_id: 'carryover-proof',
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
  writeFileSync(join(root, 'src', 'mock.js'), 'export const ok = true;\n');
  writeFileSync(join(root, 'TALK.md'), '# Decision Carryover Proof\n');
  gitInit(root);
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'decision-carryover-proof',
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

  console.log(`Decision Carryover Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run 1:      ${payload.artifacts?.run1_id || 'n/a'}`);
    console.log(`  Run 2:      ${payload.artifacts?.run2_id || 'n/a'}`);
    console.log(`  Repo decs:  ${payload.artifacts?.final_repo_decisions || 0}`);
    console.log('  Result:     PASS — repo decisions persist across runs and override correctly');
    return;
  }

  console.log('  Result:     FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:      ${error}`);
  }
}

async function main() {
  const root = join(tmpdir(), `axc-carryover-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  const errors = [];
  const traces = [];

  try {
    scaffoldProject(root);

    // ── Run 1: emit repo-durable decision ──────────────────────────────────
    const run1 = runCli(root, ['run', '--auto-approve'], { AGENTXCHAIN_CARRYOVER_MODE: 'repo-decision' });
    if (run1.status !== 0) {
      throw new Error(`run 1 failed:\n${run1.stdout}\n${run1.stderr}`);
    }

    const state1 = readJson(join(root, '.agentxchain', 'state.json'));
    traces.push({ step: 'run1_complete', run_id: state1.run_id, status: state1.status });

    if (state1.status !== 'completed') {
      errors.push(`run 1 expected status completed, got ${state1.status}`);
    }

    // Verify repo-decisions.jsonl exists and has DEC-100
    const repoDecPath = join(root, '.agentxchain', 'repo-decisions.jsonl');
    if (!existsSync(repoDecPath)) {
      errors.push('repo-decisions.jsonl not created after run 1');
    } else {
      const repoDecs1 = readJsonl(repoDecPath);
      const dec001 = repoDecs1.find((d) => d.id === 'DEC-100');
      if (!dec001) {
        errors.push('DEC-100 not found in repo-decisions.jsonl after run 1');
      } else {
        if (dec001.status !== 'active') {
          errors.push(`DEC-100 expected status active, got ${dec001.status}`);
        }
        traces.push({ step: 'run1_repo_decision', decision: dec001 });
      }
    }

    // Verify CLI: agentxchain decisions
    const decList1 = runCli(root, ['decisions', '--json']);
    if (decList1.status !== 0) {
      errors.push(`decisions command failed after run 1: ${decList1.stderr}`);
    } else {
      const decData1 = JSON.parse(decList1.stdout);
      if (!Array.isArray(decData1) || decData1.length !== 1) {
        errors.push(`expected 1 active decision, got ${Array.isArray(decData1) ? decData1.length : 'non-array'}`);
      }
    }

    gitCheckpoint(root, 'proof: run 1 complete with repo decision');

    // ── Run 2: verify injection + override ─────────────────────────────────
    // Reset state so a new run can start
    writeJson(join(root, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'carryover-proof',
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
    gitCheckpoint(root, 'proof: reset state for run 2');

    const run2 = runCli(root, ['run', '--auto-approve'], { AGENTXCHAIN_CARRYOVER_MODE: 'override' });
    if (run2.status !== 0) {
      throw new Error(`run 2 failed:\n${run2.stdout}\n${run2.stderr}`);
    }

    const state2 = readJson(join(root, '.agentxchain', 'state.json'));
    traces.push({ step: 'run2_complete', run_id: state2.run_id, status: state2.status });

    if (state2.status !== 'completed') {
      errors.push(`run 2 expected status completed, got ${state2.status}`);
    }

    // Verify repo state after run 2
    if (existsSync(repoDecPath)) {
      const repoDecs2 = readJsonl(repoDecPath);
      const dec001After = repoDecs2.find((d) => d.id === 'DEC-100');
      const dec002 = repoDecs2.find((d) => d.id === 'DEC-200');

      if (!dec001After) {
        errors.push('DEC-100 missing from repo-decisions.jsonl after run 2');
      } else if (dec001After.status !== 'overridden') {
        errors.push(`DEC-100 expected status overridden, got ${dec001After.status}`);
      }

      if (!dec002) {
        errors.push('DEC-200 not found in repo-decisions.jsonl after run 2');
      } else {
        if (dec002.status !== 'active') {
          errors.push(`DEC-200 expected status active, got ${dec002.status}`);
        }
        traces.push({ step: 'run2_override', original: dec001After, override: dec002 });
      }
    }

    // Verify CLI: agentxchain decisions --json (only DEC-200 active)
    const decList2 = runCli(root, ['decisions', '--json']);
    if (decList2.status !== 0) {
      errors.push(`decisions command failed after run 2: ${decList2.stderr}`);
    } else {
      const decData2 = JSON.parse(decList2.stdout);
      if (!Array.isArray(decData2) || decData2.length !== 1) {
        errors.push(`expected 1 active decision after override, got ${Array.isArray(decData2) ? decData2.length : 'non-array'}`);
      } else if (decData2[0].id !== 'DEC-200') {
        errors.push(`expected active decision DEC-200, got ${decData2[0].id}`);
      }
    }

    // Verify CLI: agentxchain decisions --all --json (both decisions, 001 overridden)
    const decListAll = runCli(root, ['decisions', '--all', '--json']);
    if (decListAll.status !== 0) {
      errors.push(`decisions --all failed after run 2: ${decListAll.stderr}`);
    } else {
      const decDataAll = JSON.parse(decListAll.stdout);
      if (!Array.isArray(decDataAll) || decDataAll.length !== 2) {
        errors.push(`expected 2 total decisions, got ${Array.isArray(decDataAll) ? decDataAll.length : 'non-array'}`);
      }
    }

    gitCheckpoint(root, 'proof: run 2 complete with override');

    const finalRepoDecs = existsSync(repoDecPath) ? readJsonl(repoDecPath) : [];
    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        run1_id: state1.run_id,
        run2_id: state2.run_id,
        final_repo_decisions: finalRepoDecs.length,
        active_decisions: finalRepoDecs.filter((d) => d.status === 'active').length,
        overridden_decisions: finalRepoDecs.filter((d) => d.status === 'overridden').length,
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
