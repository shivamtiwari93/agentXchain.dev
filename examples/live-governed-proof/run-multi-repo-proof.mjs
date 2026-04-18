#!/usr/bin/env node

/**
 * Multi-Repo Coordinator — Live Proof
 *
 * Proves one real multi-repo coordinator run with:
 * - 2 governed child repos (`api`, `web`)
 * - real Anthropic api_proxy dispatch
 * - repo-local approve-transition / approve-completion gates
 * - coordinator phase + completion gates
 * - cross-repo context propagation into the downstream repo
 *
 * Usage:
 *   node examples/live-governed-proof/run-multi-repo-proof.mjs [--json] [--keep-temp] [--output <path>]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for child repo api_proxy turns
 *
 * Exit codes:
 *   0 — proof passed
 *   1 — proof failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const keepTemp = args.includes('--keep-temp');
const authEnv = process.env.AXC_PROOF_AUTH_ENV || 'ANTHROPIC_API_KEY';
const providerKey = process.env[authEnv];
let shouldCleanup = !keepTemp;

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_REPO_ATTEMPTS = 3;
const MAX_COORDINATOR_STEPS = 12;

function readFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

const outputPath = readFlagValue('--output');

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
    timeout: 300000,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
    },
  });
}

function gitInit(root, label) {
  const base = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], base);
  spawnSync('git', ['config', 'user.name', 'AgentXchain Multi Proof'], base);
  spawnSync('git', ['config', 'user.email', 'multi-proof@example.invalid'], base);
  writeFileSync(join(root, 'README.md'), `# ${label}\n\nLive proof workspace.\n`);
  spawnSync('git', ['add', '-A'], base);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], base);
}

function repoMandates(repoId) {
  if (repoId === 'api') {
    return {
      planning: 'Produce a concise API rollout plan for a shared todo system. Cover endpoints, data shape, and one integration dependency on the web repo. Then set phase_transition_request to "implementation".',
      implementation: 'Summarize the API implementation approach for the shared todo system. Mention one contract the web repo must follow. Then set run_completion_request to true.',
    };
  }

  return {
    planning: 'Produce a concise web rollout plan for a shared todo system. Cover views, user actions, and one integration dependency on the api repo. Then set phase_transition_request to "implementation".',
    implementation: 'Summarize the web implementation approach for the shared todo system. Mention one contract expected from the api repo. Then set run_completion_request to true.',
  };
}

function makeRepoConfig(repoId) {
  const mandates = repoMandates(repoId);

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `multi-proof-${repoId}-${randomBytes(4).toString('hex')}`,
      name: `Multi-Repo Proof ${repoId.toUpperCase()}`,
      description: `Live coordinator proof child repo for ${repoId}.`,
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: mandates.planning,
        write_authority: 'review_only',
        runtime: `api-${repoId}-pm`,
        runtime_class: 'api_proxy',
        runtime_id: `api-${repoId}-pm`,
      },
      dev: {
        title: 'Developer',
        mandate: mandates.implementation,
        write_authority: 'review_only',
        runtime: `api-${repoId}-dev`,
        runtime_class: 'api_proxy',
        runtime_id: `api-${repoId}-dev`,
      },
    },
    runtimes: {
      [`api-${repoId}-pm`]: {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      [`api-${repoId}-dev`]: {
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
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'implementation_complete',
      },
    },
    gates: {
      planning_signoff: {
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_human_approval: true,
      },
    },
    budget: {
      per_turn_max_usd: 1,
      per_run_max_usd: 5,
    },
    rules: {
      challenge_required: false,
      max_turn_retries: 3,
      max_deadlock_cycles: 2,
    },
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

function scaffoldRepo(root, repoId) {
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), makeRepoConfig(repoId));
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: `${repoId}-proof`,
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
  });
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(
    join(root, 'TALK.md'),
    `# ${repoId.toUpperCase()} Repo\n\nLive multi-repo coordinator proof child workspace.\n`,
  );
  gitInit(root, `${repoId.toUpperCase()} Repo`);
}

function makeCoordinatorConfig() {
  return {
    schema_version: '0.1',
    project: {
      id: `multi-proof-${randomBytes(4).toString('hex')}`,
      name: 'Multi-Repo Live Proof',
    },
    repos: {
      api: {
        path: './repos/api',
        default_branch: 'main',
        required: true,
      },
      web: {
        path: './repos/web',
        default_branch: 'main',
        required: true,
      },
    },
    workstreams: {
      planning_sync: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: {
        entry_workstream: 'planning_sync',
      },
      implementation: {
        entry_workstream: 'implementation_sync',
      },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function scaffoldWorkspace(root) {
  const apiRoot = join(root, 'repos', 'api');
  const webRoot = join(root, 'repos', 'web');
  mkdirSync(apiRoot, { recursive: true });
  mkdirSync(webRoot, { recursive: true });
  scaffoldRepo(apiRoot, 'api');
  scaffoldRepo(webRoot, 'web');
  writeJson(join(root, 'agentxchain-multi.json'), makeCoordinatorConfig());
  return { apiRoot, webRoot };
}

function maybeApproveRepoPending(repoRoot) {
  const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));

  if (state.pending_phase_transition) {
    const result = runCli(repoRoot, ['approve-transition']);
    if (result.status !== 0) {
      throw new Error(`approve-transition failed in ${repoRoot}:\n${result.stdout}\n${result.stderr}`);
    }
  }

  const refreshed = readJson(join(repoRoot, '.agentxchain', 'state.json'));
  if (refreshed.pending_run_completion) {
    const result = runCli(repoRoot, ['approve-completion']);
    if (result.status !== 0) {
      throw new Error(`approve-completion failed in ${repoRoot}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function executeRepoTurn(repoRoot) {
  for (let attempt = 1; attempt <= MAX_REPO_ATTEMPTS; attempt += 1) {
    const result = runCli(repoRoot, ['step', '--resume', '--auto-reject']);
    if (result.status !== 0) {
      throw new Error(`step --resume failed in ${repoRoot} on attempt ${attempt}:\n${result.stdout}\n${result.stderr}`);
    }

    maybeApproveRepoPending(repoRoot);
    const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));
    if (Object.keys(state.active_turns || {}).length === 0) {
      return;
    }
  }

  throw new Error(`repo ${repoRoot} retained an active turn after ${MAX_REPO_ATTEMPTS} attempts`);
}

function sumRepoCost(repoRoot) {
  const history = readJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'));
  return history.reduce((sum, entry) => sum + (entry.cost?.usd || 0), 0);
}

function extractAcceptedRoles(repoRoot) {
  const history = readJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'));
  return history.map((entry) => entry.role).filter(Boolean);
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'multi-repo-live-proof',
    recorded_at: new Date().toISOString(),
    cli_version: cliPkg.version,
    cli_path: 'cli/bin/agentxchain.js',
    script_path: 'examples/live-governed-proof/run-multi-repo-proof.mjs',
    command: 'node examples/live-governed-proof/run-multi-repo-proof.mjs --json',
    result,
    traces,
    artifacts,
    errors,
  };
}

function writePayloadFile(payload) {
  if (!outputPath) return;
  const absolutePath = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeJson(absolutePath, payload);
}

function printPayload(payload) {
  writePayloadFile(payload);
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(`Multi-Repo Live Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Super Run: ${payload.artifacts.coordinator.super_run_id}`);
    console.log(`  Repos:     ${payload.artifacts.repos.api.roles.join(' -> ')} | ${payload.artifacts.repos.web.roles.join(' -> ')}`);
    console.log(`  Context:   web saw ${payload.artifacts.context.upstream_acceptances} upstream acceptance from ${payload.artifacts.context.upstream_repo_ids.join(', ')}`);
    console.log(`  Dispatch:  ${payload.artifacts.coordinator.turn_dispatched} coordinator dispatches / ${payload.artifacts.coordinator.acceptance_projections} acceptance projections`);
    console.log(`  Cost:      $${payload.artifacts.cost.total_usd.toFixed(4)} total`);
    console.log('  Result:    PASS — real coordinator run completed across two repos');
  } else if (payload.result === 'skip') {
    console.log('  Result:    SKIP');
    console.log(`  Reason:    ${payload.reason}`);
  } else {
    console.log('  Result:    FAIL');
    for (const error of payload.errors) {
      console.log(`  Error:     ${error}`);
    }
  }
}

function sanitizeTrace(payload) {
  if (!payload?.bundle_path) return payload;
  const repoMarker = '/repos/';
  const repoIndex = payload.bundle_path.lastIndexOf(repoMarker);
  if (repoIndex !== -1) {
    return {
      ...payload,
      bundle_path: `repos/${payload.bundle_path.slice(repoIndex + repoMarker.length)}`,
    };
  }
  return {
    ...payload,
    bundle_path: payload.bundle_path,
  };
}

async function main() {
  const root = join(tmpdir(), `axc-multi-live-${randomBytes(6).toString('hex')}`);
  const errors = [];
  const traces = [];

  if (!providerKey) {
    const payload = buildPayload({
      result: 'skip',
      errors: [],
      artifacts: null,
      traces: [],
    });
    payload.reason = `Multi-repo live proof requires ${authEnv}`;
    payload.missing_env = [authEnv];
    printPayload(payload);
    process.exitCode = 0;
    return;
  }

  try {
    mkdirSync(root, { recursive: true });
    const { apiRoot, webRoot } = scaffoldWorkspace(root);

    const init = runCli(root, ['multi', 'init', '--json']);
    if (init.status !== 0) {
      throw new Error(`multi init failed:\n${init.stdout}\n${init.stderr}`);
    }

    let contextSnapshot = null;

    for (let i = 0; i < MAX_COORDINATOR_STEPS; i += 1) {
      const step = runCli(root, ['multi', 'step', '--json']);
      if (step.status !== 0) {
        throw new Error(`multi step failed on iteration ${i + 1}:\n${step.stdout}\n${step.stderr}`);
      }

      const rawPayload = JSON.parse(step.stdout);
      traces.push(sanitizeTrace(rawPayload));

      if (rawPayload.action === 'phase_transition_requested' || rawPayload.action === 'run_completion_requested') {
        const approve = runCli(root, ['multi', 'approve-gate']);
        if (approve.status !== 0) {
          throw new Error(`multi approve-gate failed:\n${approve.stdout}\n${approve.stderr}`);
        }
        const coordinatorState = readJson(join(root, '.agentxchain', 'multirepo', 'state.json'));
        if (coordinatorState.status === 'completed') {
          break;
        }
        continue;
      }

      if (!rawPayload.repo_id || !rawPayload.bundle_path) {
        throw new Error(`unexpected multi step payload: ${JSON.stringify(rawPayload)}`);
      }

      if (rawPayload.repo_id === 'web' && contextSnapshot === null) {
        const contextPath = join(rawPayload.bundle_path, 'COORDINATOR_CONTEXT.json');
        const context = readJson(contextPath);
        contextSnapshot = {
          upstream_acceptances: context.upstream_acceptances.length,
          upstream_repo_ids: context.upstream_acceptances.map((entry) => entry.repo_id),
          required_followups: context.required_followups || [],
        };
      }

      executeRepoTurn(rawPayload.repo_id === 'api' ? apiRoot : webRoot);

      const coordinatorState = readJson(join(root, '.agentxchain', 'multirepo', 'state.json'));
      if (coordinatorState.status === 'completed') {
        break;
      }
    }

    const coordinatorState = readJson(join(root, '.agentxchain', 'multirepo', 'state.json'));
    const coordinatorHistory = readJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'));
    const barriers = readJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'));
    const apiState = readJson(join(apiRoot, '.agentxchain', 'state.json'));
    const webState = readJson(join(webRoot, '.agentxchain', 'state.json'));

    if (coordinatorState.status !== 'completed') {
      errors.push(`expected coordinator status completed, got ${coordinatorState.status}`);
    }
    if (barriers.planning_sync_completion?.status !== 'satisfied') {
      errors.push(`planning_sync_completion barrier not satisfied: ${barriers.planning_sync_completion?.status || 'missing'}`);
    }
    if (barriers.implementation_sync_completion?.status !== 'satisfied') {
      errors.push(`implementation_sync_completion barrier not satisfied: ${barriers.implementation_sync_completion?.status || 'missing'}`);
    }
    if ((contextSnapshot?.upstream_acceptances || 0) < 1 || !(contextSnapshot?.upstream_repo_ids || []).includes('api')) {
      errors.push('web coordinator context did not include upstream acceptance from api');
    }

    const turnDispatched = coordinatorHistory.filter((entry) => entry.type === 'turn_dispatched').length;
    const acceptanceProjections = coordinatorHistory.filter((entry) => entry.type === 'acceptance_projection').length;
    if (turnDispatched < 4) {
      errors.push(`expected >=4 coordinator turn_dispatched entries, got ${turnDispatched}`);
    }
    if (acceptanceProjections < 4) {
      errors.push(`expected >=4 coordinator acceptance_projection entries, got ${acceptanceProjections}`);
    }

    const apiCost = sumRepoCost(apiRoot);
    const webCost = sumRepoCost(webRoot);
    if (apiCost <= 0) {
      errors.push(`expected api repo to incur real API cost, got ${apiCost}`);
    }
    if (webCost <= 0) {
      errors.push(`expected web repo to incur real API cost, got ${webCost}`);
    }

    const artifacts = {
      coordinator: {
        super_run_id: coordinatorState.super_run_id,
        status: coordinatorState.status,
        phase: coordinatorState.phase,
        turn_dispatched: turnDispatched,
        acceptance_projections: acceptanceProjections,
      },
      context: contextSnapshot,
      repos: {
        api: {
          run_id: apiState.run_id,
          status: apiState.status,
          roles: extractAcceptedRoles(apiRoot),
        },
        web: {
          run_id: webState.run_id,
          status: webState.status,
          roles: extractAcceptedRoles(webRoot),
        },
      },
      barriers: {
        planning_sync_completion: barriers.planning_sync_completion?.status || null,
        implementation_sync_completion: barriers.implementation_sync_completion?.status || null,
      },
      cost: {
        api_usd: apiCost,
        web_usd: webCost,
        total_usd: apiCost + webCost,
      },
    };
    if (keepTemp) {
      artifacts.proof_workspace = root;
    }

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      artifacts,
      traces,
    });
    printPayload(payload);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch (error) {
    shouldCleanup = false;
    const payload = buildPayload({
      result: 'fail',
      errors: [error.message],
      artifacts: {
        proof_workspace: root,
      },
      traces,
    });
    printPayload(payload);
    process.exitCode = 1;
  } finally {
    if (shouldCleanup) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

main();
