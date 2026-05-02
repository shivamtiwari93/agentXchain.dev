/**
 * E2E coordinator recovery with real agent execution
 *
 * Proves that the coordinator blocked→resume→complete lifecycle works
 * when child repos execute through real `step --resume` (local_cli adapter →
 * mock-agent → staged result → accept-turn), not through hand-staged
 * turn-result.json files.
 *
 * See: .planning/COORDINATOR_RECOVERY_REAL_AGENT_SPEC.md
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const CHILD_AGENT = join(__dirname, '..', 'test-support', 'coordinator-child-run-agent.mjs');
const tempDirs = [];

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function runCli(cwd, args, timeout = 60000) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function parseJsonResult(result, label) {
  assert.equal(result.exitCode, 0, `${label} failed:\n${result.combined}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON:\n${result.stdout}\n${error.message}`);
  }
}

function tamperHookScript(workspacePath) {
  const stateFile = join(workspacePath, '.agentxchain', 'multirepo', 'state.json');
  return [
    'node', '-e',
    `const fs = require("fs"); ` +
    `const f = ${JSON.stringify(stateFile)}; ` +
    `const d = JSON.parse(fs.readFileSync(f, "utf8")); ` +
    `d._tampered = true; ` +
    `fs.writeFileSync(f, JSON.stringify(d));`,
  ];
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    protocol_mode: 'governed',
  });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [CHILD_AGENT],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    rules: {
      challenge_required: false,
      max_turn_retries: 1,
    },
  });
}

function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-recovery-real-'));
  tempDirs.push(workspace);

  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeGovernedRepo(webRepo, 'web');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-recovery-real', name: 'Coordinator Recovery Real Agent' },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      delivery: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'delivery' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
    hooks: {
      after_acceptance: [
        {
          name: 'tamper-trigger',
          type: 'process',
          command: tamperHookScript(workspace),
          timeout_ms: 5000,
        },
      ],
    },
  });

  return { workspace, apiRepo, webRepo };
}

function disableBrokenHook(workspace) {
  const configPath = join(workspace, 'agentxchain-multi.json');
  const config = readJson(configPath);
  delete config.hooks;
  writeJson(configPath, config);
}

function writeRecoveryReport(workspace) {
  const reportDir = join(workspace, '.agentxchain', 'multirepo');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, 'RECOVERY_REPORT.md'),
    '# Recovery Report\n\n' +
    '## Trigger\n\n' +
    'Coordinator hook violation: tamper detection false positive.\n\n' +
    '## Impact\n\n' +
    'Coordinator blocked after api turn acceptance projection. No child data lost.\n\n' +
    '## Mitigation\n\n' +
    'Disabled broken after_acceptance hook. Verified repo state integrity before resume.\n',
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('Coordinator recovery with real agent execution', () => {
  it('AT-COORD-RECOVERY-REAL-001..004: blocked coordinator recovers and completes through real step --resume agent execution', () => {
    const { workspace, apiRepo, webRepo } = makeWorkspace();

    // --- Init ---
    const init = runCli(workspace, ['multi', 'init']);
    assert.equal(init.exitCode, 0, `multi init failed:\n${init.combined}`);

    // --- Dispatch to api ---
    const apiDispatch = parseJsonResult(
      runCli(workspace, ['multi', 'step', '--json']),
      'multi step api dispatch',
    );
    assert.equal(apiDispatch.repo_id, 'api');
    assert.ok(existsSync(join(apiDispatch.bundle_path, 'ASSIGNMENT.json')));

    // --- Real agent execution in api via step --resume ---
    const apiStep = runCli(apiRepo, ['step', '--resume']);
    assert.equal(apiStep.exitCode, 0, `api step --resume failed:\n${apiStep.combined}`);
    assert.match(apiStep.combined, /Turn accepted/i, 'api step must complete with acceptance');

    // --- multi step triggers hook violation → coordinator blocks ---
    // AT-COORD-RECOVERY-REAL-001
    const blockedStep = runCli(workspace, ['multi', 'step', '--json']);
    assert.notEqual(blockedStep.exitCode, 0, 'multi step should fail when hook violation blocks coordinator');

    const blockedState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
    assert.equal(blockedState.status, 'blocked', 'coordinator must be blocked after hook violation');
    assert.match(blockedState.blocked_reason, /coordinator_hook_violation/);

    // --- Operator recovery ---
    // AT-COORD-RECOVERY-REAL-002
    disableBrokenHook(workspace);
    writeRecoveryReport(workspace);

    const resumed = parseJsonResult(
      runCli(workspace, ['multi', 'resume', '--json']),
      'multi resume',
    );
    assert.equal(resumed.ok, true);
    assert.equal(resumed.resumed_status, 'active');
    assert.match(resumed.blocked_reason, /coordinator_hook_violation/);

    const resumedState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
    assert.equal(resumedState.status, 'active', 'coordinator must be active after resume');

    const history = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'history.jsonl'));
    const recoveryEntry = history.find((entry) => entry.type === 'blocked_resolved');
    assert.ok(recoveryEntry, 'coordinator history must record blocked_resolved');
    assert.equal(recoveryEntry.to, 'active');

    // --- Post-recovery dispatch to web ---
    // AT-COORD-RECOVERY-REAL-003
    const webDispatch = parseJsonResult(
      runCli(workspace, ['multi', 'step', '--json']),
      'multi step web dispatch after recovery',
    );
    assert.equal(webDispatch.repo_id, 'web');
    assert.ok(existsSync(join(webDispatch.bundle_path, 'ASSIGNMENT.json')));

    // --- Real agent execution in web via step --resume ---
    const webStep = runCli(webRepo, ['step', '--resume']);
    assert.equal(webStep.exitCode, 0, `web step --resume failed:\n${webStep.combined}`);
    assert.match(webStep.combined, /Turn accepted/i, 'web step must complete with acceptance');

    // --- Completion gate ---
    // AT-COORD-RECOVERY-REAL-004
    const completionGate = parseJsonResult(
      runCli(workspace, ['multi', 'step', '--json']),
      'multi step completion gate',
    );
    assert.equal(completionGate.action, 'run_completion_requested');
    assert.equal(completionGate.gate_type, 'run_completion');

    const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approveCompletion.exitCode, 0, `approve completion failed:\n${approveCompletion.combined}`);

    // --- Final assertions ---
    const finalState = readJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'));
    assert.equal(finalState.status, 'completed', 'coordinator must be completed');

    const finalHistory = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'history.jsonl'));
    assert.equal(
      finalHistory.filter((e) => e.type === 'turn_dispatched').length,
      2,
      'must have 2 turn_dispatched entries',
    );
    assert.equal(
      finalHistory.filter((e) => e.type === 'acceptance_projection').length,
      2,
      'must have 2 acceptance_projection entries',
    );
    assert.ok(
      finalHistory.some((e) => e.type === 'blocked_resolved'),
      'history must include blocked_resolved',
    );
    assert.ok(
      finalHistory.some((e) => e.type === 'run_completed'),
      'history must include run_completed',
    );

    // Verify child repos have real accepted entries (written by accept-turn, not by test)
    const apiHistory = readJsonl(join(apiRepo, '.agentxchain', 'history.jsonl'));
    const webHistory = readJsonl(join(webRepo, '.agentxchain', 'history.jsonl'));
    assert.ok(apiHistory.length >= 1, 'api repo must have history entries from real accept-turn');
    assert.ok(webHistory.length >= 1, 'web repo must have history entries from real accept-turn');

    // Verify staging results were written by the agent, not the test
    assert.ok(
      existsSync(join(apiRepo, 'src', 'output.js')),
      'api repo must have agent-written implementation artifact',
    );
    assert.ok(
      existsSync(join(webRepo, 'src', 'output.js')),
      'web repo must have agent-written implementation artifact',
    );
  });
});
