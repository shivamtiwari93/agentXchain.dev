#!/usr/bin/env node

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
const mockAgentPath = join(cliRoot, 'test-support', 'delegation-mock-agent.mjs');
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
    timeout: 60000,
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
  spawnSync('git', ['config', 'user.name', 'AgentXchain Delegation Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'delegation-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function gitCheckpoint(root, message) {
  const add = spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  if (add.status !== 0) {
    throw new Error(`git add failed before "${message}"`);
  }
  const commit = spawnSync('git', ['commit', '--allow-empty', '-m', message], {
    cwd: root,
    stdio: 'ignore',
  });
  if (commit.status !== 0) {
    throw new Error(`git commit failed for "${message}"`);
  }
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
      id: `delegation-proof-${randomBytes(4).toString('hex')}`,
      name: 'Delegation Chains CLI Proof',
      description: 'Proof that delegation chains work through the real governed CLI loop.',
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
        mandate: 'Execute delegated implementation work only when explicitly delegated.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Execute delegated review work only when explicitly delegated.',
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
    project_id: 'delegation-proof',
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
    '# Delegation Chains CLI Proof\n\nProve director -> dev -> qa -> director delegation sequencing through the real CLI loop.\n',
  );
  gitInit(root);
}

function assertStep(root, expectedRole) {
  const result = runCli(root, ['step']);
  if (result.status !== 0) {
    throw new Error(`step failed for ${expectedRole}:\n${result.stdout}\n${result.stderr}`);
  }
  const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
  const last = history.at(-1);
  if (!last) {
    throw new Error(`no accepted history entry after ${expectedRole} step`);
  }
  if (last.role !== expectedRole) {
    throw new Error(`expected accepted role ${expectedRole}, got ${last.role}`);
  }
  return { result, history, state: readJson(join(root, '.agentxchain', 'state.json')) };
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'delegation-chains-cli-proof',
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

  console.log(`Delegation Chains CLI Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run:        ${payload.artifacts.run_id}`);
    console.log(`  Roles:      ${payload.artifacts.role_order.join(' -> ')}`);
    console.log(`  Delegation: ${payload.artifacts.delegate_artifacts.join(', ')}`);
    console.log(`  Review:     ${payload.artifacts.review_artifact}`);
    console.log('  Result:     PASS — delegation chain completed through the real step loop');
    return;
  }

  console.log('  Result:     FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:      ${error}`);
  }
}

async function main() {
  const root = join(tmpdir(), `axc-delegation-proof-${randomBytes(6).toString('hex')}`);
  const errors = [];
  const traces = [];

  try {
    mkdirSync(root, { recursive: true });
    scaffoldProject(root);

    const step1 = assertStep(root, 'director');
    traces.push({ step: 1, role: 'director', state: step1.state });
    if ((step1.state.delegation_queue || []).length !== 2) {
      errors.push(`expected 2 queued delegations after director step, got ${(step1.state.delegation_queue || []).length}`);
    }
    if (step1.state.next_recommended_role !== 'dev') {
      errors.push(`expected next_recommended_role dev after director step, got ${step1.state.next_recommended_role}`);
    }
    gitCheckpoint(root, 'proof: accept director delegation seed');

    const step2 = assertStep(root, 'dev');
    traces.push({ step: 2, role: 'dev', state: step2.state });
    const devProofPath = join(root, '.agentxchain', 'proof', 'delegation', 'del-001.json');
    if (!existsSync(devProofPath)) {
      errors.push('missing dev delegation proof artifact del-001.json');
    }
    if (step2.state.next_recommended_role !== 'qa') {
      errors.push(`expected next_recommended_role qa after dev step, got ${step2.state.next_recommended_role}`);
    }
    gitCheckpoint(root, 'proof: accept dev delegation');

    const step3 = assertStep(root, 'qa');
    traces.push({ step: 3, role: 'qa', state: step3.state });
    const qaProofPath = join(root, '.agentxchain', 'proof', 'delegation', 'del-002.json');
    if (!existsSync(qaProofPath)) {
      errors.push('missing qa delegation proof artifact del-002.json');
    }
    if (!step3.state.pending_delegation_review) {
      errors.push('expected pending_delegation_review after qa step');
    }
    if (step3.state.next_recommended_role !== 'director') {
      errors.push(`expected next_recommended_role director after qa step, got ${step3.state.next_recommended_role}`);
    }
    gitCheckpoint(root, 'proof: accept qa delegation');

    const step4 = assertStep(root, 'director');
    traces.push({ step: 4, role: 'director', state: step4.state });
    const reviewProofPath = join(root, '.agentxchain', 'proof', 'delegation', 'review-turn.json');
    if (!existsSync(reviewProofPath)) {
      errors.push('missing review-turn proof artifact');
    }
    gitCheckpoint(root, 'proof: accept delegation review');

    const finalState = readJson(join(root, '.agentxchain', 'state.json'));
    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    const roleOrder = history.map((entry) => entry.role);
    const expectedOrder = ['director', 'dev', 'qa', 'director'];
    if (JSON.stringify(roleOrder) !== JSON.stringify(expectedOrder)) {
      errors.push(`expected role order ${expectedOrder.join(' -> ')}, got ${roleOrder.join(' -> ')}`);
    }
    if (finalState.status !== 'completed') {
      errors.push(`expected final status completed, got ${finalState.status}`);
    }
    if (finalState.pending_delegation_review !== null) {
      errors.push('expected pending_delegation_review to be cleared after review turn');
    }

    const devProof = existsSync(devProofPath) ? readJson(devProofPath) : null;
    const qaProof = existsSync(qaProofPath) ? readJson(qaProofPath) : null;
    const reviewProof = existsSync(reviewProofPath) ? readJson(reviewProofPath) : null;
    if (devProof?.parent_role !== 'director') {
      errors.push(`expected dev proof parent_role director, got ${devProof?.parent_role || 'missing'}`);
    }
    if (qaProof?.delegation_id !== 'del-002') {
      errors.push(`expected qa proof delegation_id del-002, got ${qaProof?.delegation_id || 'missing'}`);
    }
    if ((reviewProof?.result_count || 0) !== 2) {
      errors.push(`expected review proof result_count 2, got ${reviewProof?.result_count || 0}`);
    }

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        run_id: finalState.run_id,
        final_status: finalState.status,
        role_order: roleOrder,
        delegate_artifacts: [
          '.agentxchain/proof/delegation/del-001.json',
          '.agentxchain/proof/delegation/del-002.json',
        ],
        review_artifact: '.agentxchain/proof/delegation/review-turn.json',
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
