#!/usr/bin/env node

/**
 * Replay round-trip proof — coordinator variant.
 *
 * Proves the full coordinator export → replay → dashboard endpoint path:
 *   1. Scaffold a coordinator workspace with 2 governed child repos
 *   2. Run each child repo to completion with local_cli mock agent
 *   3. Run `agentxchain export` from coordinator workspace
 *   4. Start `agentxchain replay export <export> --json --no-open`
 *   5. Hit `/api/coordinator/state` and `/api/coordinator/events`
 *   6. Verify coordinator data round-trips correctly through replay
 *   7. Verify /api/coordinator/events type, limit, and combined filters
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'replay-roundtrip-mock-agent.mjs');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
  spawnSync('git', ['config', 'user.name', 'Coordinator Replay Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'coord-replay@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function waitForServer(port, maxWait = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await httpGet(port, '/api/session');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

function makeChildConfig(repoId, repoName) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: repoId,
      name: repoName,
      description: `Child repo ${repoId} for coordinator replay proof.`,
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [mockAgentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    phases: ['implementation'],
    gates: {},
    budget: { per_turn_max_usd: 1, per_run_max_usd: 5 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function scaffoldChildRepo(repoRoot, repoId, repoName) {
  mkdirSync(join(repoRoot, '.agentxchain'), { recursive: true });
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeJson(join(repoRoot, 'agentxchain.json'), makeChildConfig(repoId, repoName));
  writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: repoId,
    status: 'idle',
    phase: 'implementation',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  });
  writeFileSync(join(repoRoot, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(repoRoot, 'src', 'mock.js'), 'export const ok = true;\n');
  writeFileSync(join(repoRoot, 'TALK.md'), `# ${repoName}\n`);
  gitInit(repoRoot);
}

function makeCoordinatorConfig() {
  return {
    schema_version: '0.1',
    project: {
      id: `coord-replay-proof-${randomBytes(4).toString('hex')}`,
      name: 'Coordinator Replay Proof',
    },
    repos: {
      web: { path: './repos/web' },
      api: { path: './repos/api' },
    },
    workstreams: {
      core: {
        phase: 'implementation',
        repos: ['web', 'api'],
        entry_repo: 'web',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
  };
}

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'coordinator-replay-roundtrip-proof',
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
  console.log(`Coordinator Replay Roundtrip Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Checks:     ${payload.artifacts?.checks_passed || 0} passed`);
    console.log('  Result:     PASS — coordinator export → replay → dashboard round-trip verified');
  } else {
    console.log('  Result:     FAIL');
    for (const error of payload.errors) {
      console.log(`  Error:      ${error}`);
    }
  }
}

async function main() {
  const root = join(tmpdir(), `axc-coord-replay-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  const errors = [];
  const traces = [];
  let replayProc = null;
  const port = 30000 + Math.floor(Math.random() * 10000);

  try {
    // ── Step 1: Scaffold coordinator workspace with 2 child repos ───────────
    const webRoot = join(root, 'repos', 'web');
    const apiRoot = join(root, 'repos', 'api');
    scaffoldChildRepo(webRoot, 'web-app', 'Web App');
    scaffoldChildRepo(apiRoot, 'api-app', 'API App');

    // Write coordinator config
    mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });
    writeJson(join(root, 'agentxchain-multi.json'), makeCoordinatorConfig());

    // Initialize coordinator state
    writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
      schema_version: '1.1',
      super_run_id: null,
      status: 'idle',
      phase: 'implementation',
      repo_runs: {},
    });
    writeFileSync(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), '');
    writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});
    writeFileSync(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), '');
    writeFileSync(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), '');

    traces.push({ step: 'scaffold_complete' });

    // ── Step 2: Run each child repo to completion ───────────────────────────
    const webRun = runCli(webRoot, ['run', '--auto-approve']);
    if (webRun.status !== 0) {
      throw new Error(`web run failed:\n${webRun.stdout}\n${webRun.stderr}`);
    }
    const webState = readJson(join(webRoot, '.agentxchain', 'state.json'));
    if (webState.status !== 'completed') {
      throw new Error(`web run expected completed, got ${webState.status}`);
    }
    traces.push({ step: 'web_run_complete', run_id: webState.run_id });

    const apiRun = runCli(apiRoot, ['run', '--auto-approve']);
    if (apiRun.status !== 0) {
      throw new Error(`api run failed:\n${apiRun.stdout}\n${apiRun.stderr}`);
    }
    const apiState = readJson(join(apiRoot, '.agentxchain', 'state.json'));
    if (apiState.status !== 'completed') {
      throw new Error(`api run expected completed, got ${apiState.status}`);
    }
    traces.push({ step: 'api_run_complete', run_id: apiState.run_id });

    // Update coordinator state to reflect child runs
    writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
      schema_version: '1.1',
      super_run_id: `srun_${randomBytes(8).toString('hex')}`,
      status: 'active',
      phase: 'implementation',
      repo_runs: {
        web: { run_id: webState.run_id, status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
        api: { run_id: apiState.run_id, status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
      },
    });

    // ── Step 3: Export from coordinator workspace ────────────────────────────
    const exportPath = join(root, 'coord-export.json');
    const exportResult = runCli(root, ['export', '--output', 'coord-export.json']);
    if (exportResult.status !== 0) {
      throw new Error(`coordinator export failed:\n${exportResult.stdout}\n${exportResult.stderr}`);
    }
    if (!existsSync(exportPath)) {
      throw new Error('coord-export.json not created');
    }

    const exportData = readJson(exportPath);
    if (exportData.export_kind !== 'agentxchain_coordinator_export') {
      throw new Error(`unexpected export_kind: ${exportData.export_kind}`);
    }
    traces.push({ step: 'export_complete', export_kind: exportData.export_kind });

    // ── Step 4: Replay the coordinator export ───────────────────────────────
    replayProc = spawn(process.execPath, [binPath, 'replay', 'export', exportPath, '--port', String(port), '--json', '--no-open'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });

    const ready = await waitForServer(port);
    if (!ready) {
      throw new Error('replay server did not start within 8s');
    }
    traces.push({ step: 'replay_server_started', port });

    // ── Step 5: Verify coordinator dashboard endpoints ──────────────────────
    let checksPassed = 0;

    // Check 1: /api/session is replay_mode
    const session = await httpGet(port, '/api/session');
    const sessionData = JSON.parse(session.body);
    if (!sessionData.replay_mode) {
      errors.push('session.replay_mode expected true');
    } else {
      checksPassed++;
    }

    // Check 2: /api/coordinator/state exists and has repo_runs
    const coordStateResp = await httpGet(port, '/api/coordinator/state');
    if (coordStateResp.status !== 200) {
      errors.push(`/api/coordinator/state expected 200, got ${coordStateResp.status}`);
    } else {
      const coordData = JSON.parse(coordStateResp.body);
      if (!coordData.repo_runs) {
        errors.push('/api/coordinator/state missing repo_runs');
      } else {
        if (!coordData.repo_runs.web) {
          errors.push('/api/coordinator/state missing web repo');
        } else {
          checksPassed++;
        }
        if (!coordData.repo_runs.api) {
          errors.push('/api/coordinator/state missing api repo');
        } else {
          checksPassed++;
        }
      }
      // Verify child run IDs match
      if (coordData.repo_runs?.web?.run_id !== webState.run_id) {
        errors.push(`coordinator web run_id mismatch: ${coordData.repo_runs?.web?.run_id} vs ${webState.run_id}`);
      } else {
        checksPassed++;
      }
      if (coordData.repo_runs?.api?.run_id !== apiState.run_id) {
        errors.push(`coordinator api run_id mismatch: ${coordData.repo_runs?.api?.run_id} vs ${apiState.run_id}`);
      } else {
        checksPassed++;
      }
    }

    // Check 3: /api/coordinator/events returns aggregated child events
    const coordEventsResp = await httpGet(port, '/api/coordinator/events');
    if (coordEventsResp.status !== 200) {
      errors.push(`/api/coordinator/events expected 200, got ${coordEventsResp.status}`);
    } else {
      const coordEvents = JSON.parse(coordEventsResp.body);
      if (!Array.isArray(coordEvents)) {
        errors.push('/api/coordinator/events expected array');
      } else {
        // Both repos had runs → at least 4 events each (run_started, turn_dispatched, turn_accepted, run_completed) × 2 repos
        if (coordEvents.length < 4) {
          errors.push(`expected >= 4 coordinator events, got ${coordEvents.length}`);
        } else {
          checksPassed++;
        }

        // Every event must have repo_id
        const missingRepoId = coordEvents.filter((e) => !e.repo_id);
        if (missingRepoId.length > 0) {
          errors.push(`${missingRepoId.length} coordinator events missing repo_id`);
        } else {
          checksPassed++;
        }

        // Events from both repos must be present
        const repoIds = [...new Set(coordEvents.map((e) => e.repo_id))].sort();
        if (!repoIds.includes('web') || !repoIds.includes('api')) {
          errors.push(`expected events from both web and api repos, got [${repoIds.join(', ')}]`);
        } else {
          checksPassed++;
        }

        // Timestamps must be monotonically non-decreasing
        let ordered = true;
        for (let i = 1; i < coordEvents.length; i++) {
          if (coordEvents[i].timestamp < coordEvents[i - 1].timestamp) {
            ordered = false;
            break;
          }
        }
        if (!ordered) {
          errors.push('coordinator events not in timestamp order');
        } else {
          checksPassed++;
        }
      }
    }

    // Check 4: /api/coordinator/events?repo_id=web returns only web events
    const webEventsResp = await httpGet(port, '/api/coordinator/events?repo_id=web');
    if (webEventsResp.status === 200) {
      const webEvents = JSON.parse(webEventsResp.body);
      const nonWeb = webEvents.filter((e) => e.repo_id !== 'web');
      if (nonWeb.length > 0) {
        errors.push(`repo_id=web filter returned ${nonWeb.length} non-web events`);
      } else {
        checksPassed++;
      }
    }

    // Check 5: /api/coordinator/events?type=run_started returns only run_started events
    const typeFilterResp = await httpGet(port, '/api/coordinator/events?type=run_started');
    if (typeFilterResp.status !== 200) {
      errors.push(`/api/coordinator/events?type=run_started expected 200, got ${typeFilterResp.status}`);
    } else {
      const typeEvents = JSON.parse(typeFilterResp.body);
      if (!Array.isArray(typeEvents) || typeEvents.length === 0) {
        errors.push('type=run_started filter returned empty or non-array');
      } else {
        const wrongType = typeEvents.filter((e) => e.event_type !== 'run_started');
        if (wrongType.length > 0) {
          errors.push(`type=run_started filter returned ${wrongType.length} events with wrong event_type: ${wrongType.map((e) => e.event_type).join(', ')}`);
        } else {
          checksPassed++;
        }
        // Both repos should have a run_started event
        const typeRepoIds = [...new Set(typeEvents.map((e) => e.repo_id))].sort();
        if (!typeRepoIds.includes('web') || !typeRepoIds.includes('api')) {
          errors.push(`type=run_started expected events from both repos, got [${typeRepoIds.join(', ')}]`);
        } else {
          checksPassed++;
        }
      }
    }

    // Check 6: /api/coordinator/events?limit=2 returns at most 2 events
    const limitFilterResp = await httpGet(port, '/api/coordinator/events?limit=2');
    if (limitFilterResp.status !== 200) {
      errors.push(`/api/coordinator/events?limit=2 expected 200, got ${limitFilterResp.status}`);
    } else {
      const limitEvents = JSON.parse(limitFilterResp.body);
      if (!Array.isArray(limitEvents)) {
        errors.push('/api/coordinator/events?limit=2 expected array');
      } else if (limitEvents.length > 2) {
        errors.push(`limit=2 filter returned ${limitEvents.length} events, expected <= 2`);
      } else if (limitEvents.length === 0) {
        errors.push('limit=2 filter returned 0 events, expected > 0');
      } else {
        checksPassed++;
      }
    }

    // Check 7: /api/coordinator/events?type=run_started&limit=1 combines type+limit filters
    const combinedFilterResp = await httpGet(port, '/api/coordinator/events?type=run_started&limit=1');
    if (combinedFilterResp.status !== 200) {
      errors.push(`combined type+limit filter expected 200, got ${combinedFilterResp.status}`);
    } else {
      const combinedEvents = JSON.parse(combinedFilterResp.body);
      if (!Array.isArray(combinedEvents)) {
        errors.push('combined type+limit filter expected array');
      } else if (combinedEvents.length !== 1) {
        errors.push(`combined filter expected 1 event, got ${combinedEvents.length}`);
      } else if (combinedEvents[0].event_type !== 'run_started') {
        errors.push(`combined filter event type expected run_started, got ${combinedEvents[0].event_type}`);
      } else {
        checksPassed++;
      }
    }

    // Check 8: Export repos are both ok
    if (!exportData.repos?.web?.ok || !exportData.repos?.api?.ok) {
      errors.push('export repos expected both ok');
    } else {
      checksPassed++;
    }

    traces.push({ step: 'verification_complete', checks_passed: checksPassed, errors: errors.length });

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        web_run_id: webState.run_id,
        api_run_id: apiState.run_id,
        checks_passed: checksPassed,
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
    if (replayProc && !replayProc.killed) {
      replayProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      if (!replayProc.killed) replayProc.kill('SIGKILL');
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main();
