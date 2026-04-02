/**
 * E2E tests for coordinator hook integration in the real CLI lifecycle.
 *
 * Tests:
 *   AT-CR-005: after_acceptance hook that attempts repo-local mutation is rejected and restored
 *   AT-CR-006: before_assignment hook block prevents dispatch
 *   AT-CR-007: before_gate hook block prevents phase advancement
 *   AT-CR-008: on_escalation fires when coordinator enters blocked state
 *   AT-CR-009: full coordinator hook composition preserves order and payload contract
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCoordinatorState, readCoordinatorHistory } from '../src/lib/coordinator-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── Helpers ────────────────────────────────────────────────────────────────

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

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
    phase: 'planning',
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
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
  });
}

function writeHookScript(dir, name, script) {
  const hookDir = join(dir, 'hooks');
  mkdirSync(hookDir, { recursive: true });
  const hookPath = join(hookDir, name);
  writeFileSync(hookPath, script, { mode: 0o755 });
  return hookPath;
}

function buildCoordinatorConfig(repoPaths, hooks = {}) {
  return {
    schema_version: '0.1',
    project: { id: 'test-hooks-e2e', name: 'Test Coordinator Hooks E2E' },
    repos: {
      api: { path: repoPaths.api, default_branch: 'main', required: true },
      web: { path: repoPaths.web, default_branch: 'main', required: true },
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
      planning: { entry_workstream: 'planning_sync' },
      implementation: { entry_workstream: 'implementation_sync' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
    hooks,
  };
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function makeWorkspace(hooks = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeGovernedRepo(webRepo, 'web');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
  );
  return { workspace, apiRepo, webRepo };
}

function simulateAcceptedTurn(repoRoot, summary, options = {}) {
  const statePath = join(repoRoot, '.agentxchain', 'state.json');
  const historyPath = join(repoRoot, '.agentxchain', 'history.jsonl');
  const state = readJson(statePath);
  const activeTurn = Object.values(state.active_turns || {})[0];
  assert.ok(activeTurn, `expected active turn in ${repoRoot}`);

  writeJson(statePath, {
    ...state,
    status: options.completed ? 'completed' : 'active',
    active_turns: {},
    accepted_count: (state.accepted_count || 0) + 1,
    next_recommended_role: 'dev',
  });

  appendFileSync(
    historyPath,
    JSON.stringify({
      turn_id: activeTurn.turn_id,
      role: activeTurn.assigned_role,
      status: 'accepted',
      summary,
      files_changed: [`src/${summary.replace(/\s+/g, '-').toLowerCase()}.ts`],
      decisions: [`DEC-${summary.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase()}`],
      verification: { command: 'npm test', exit_code: 0 },
    }) + '\n',
  );

  return activeTurn.turn_id;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Coordinator hook lifecycle integration', () => {
  it('AT-CR-005: after_acceptance hook tamper is rejected, restored, and blocks the coordinator', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    const apiStatePath = join(apiRepo, '.agentxchain', 'state.json');
    const hookScript = `#!/bin/sh
node -e '
const fs = require("fs");
const file = process.argv[1];
const state = JSON.parse(fs.readFileSync(file, "utf8"));
state.tampered_by_hook = true;
fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\\n");
' "${apiStatePath}"
cat <<'HOOKEOF'
{"verdict":"allow","message":"tamper attempted"}
HOOKEOF
`;
    writeHookScript(workspace, 'tamper-after-acceptance.sh', hookScript);

    const hooks = {
      after_acceptance: [
        {
          name: 'tamper-after-acceptance',
          type: 'process',
          command: ['./hooks/tamper-after-acceptance.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      const stepApi = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(stepApi.status, 0, `step api stderr: ${stepApi.stderr}`);

      simulateAcceptedTurn(apiRepo, 'planning api done');
      const preHookApiState = readFileSync(apiStatePath, 'utf8');

      const stepAfterAcceptance = runCli(workspace, ['multi', 'step']);
      assert.notEqual(stepAfterAcceptance.status, 0, 'step should fail when after_acceptance hook tampers');
      assert.ok(
        stepAfterAcceptance.stderr.includes('after_acceptance hook')
          || stepAfterAcceptance.stderr.includes('tampered with protected file'),
        `Expected tamper failure, got: ${stepAfterAcceptance.stderr}`,
      );

      const apiStateAfter = readFileSync(apiStatePath, 'utf8');
      assert.equal(apiStateAfter, preHookApiState, 'repo-local state should be restored after tamper detection');

      const webState = readJson(join(webRepo, '.agentxchain', 'state.json'));
      assert.deepEqual(webState.active_turns, {}, 'web should not receive a dispatch after tamper');

      const state = loadCoordinatorState(workspace);
      assert.equal(state.status, 'blocked', 'coordinator should enter blocked state after tamper');
      assert.match(state.blocked_reason || '', /coordinator_hook_violation|tampered with protected file/i);

      const audit = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'hook-audit.jsonl'));
      assert.ok(
        audit.some((entry) => entry.hook_phase === 'after_acceptance' && entry.orchestrator_action === 'aborted_tamper'),
        'hook audit should record the tamper rejection',
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-007: before_gate hook block prevents phase advancement', () => {
    // Create a blocking before_gate hook that rejects phase transitions
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    // Write the blocking hook script
    const hookScript = `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Compliance review required before phase transition"}
HOOKEOF
`;
    writeHookScript(workspace, 'block-gate.sh', hookScript);

    const hooks = {
      before_gate: [
        {
          name: 'compliance-gate',
          type: 'process',
          command: ['./hooks/block-gate.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      // Init
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      // Dispatch to api, accept, dispatch to web, accept → triggers phase gate request
      const stepApi = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(stepApi.status, 0, `step api stderr: ${stepApi.stderr}`);
      simulateAcceptedTurn(apiRepo, 'planning api done');

      const stepWeb = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(stepWeb.status, 0, `step web stderr: ${stepWeb.stderr}`);
      simulateAcceptedTurn(webRepo, 'planning web done');

      // This step should auto-request the phase gate
      const stepGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(stepGateRequest.status, 0, `gate request stderr: ${stepGateRequest.stderr}`);
      const gatePayload = JSON.parse(stepGateRequest.stdout);
      assert.equal(gatePayload.action, 'phase_transition_requested');

      // Now try to approve the gate — the before_gate hook should BLOCK it
      const approveResult = runCli(workspace, ['multi', 'approve-gate']);
      assert.notEqual(approveResult.status, 0, 'approve-gate should fail when hook blocks');
      assert.ok(
        approveResult.stderr.includes('blocked by hook') || approveResult.stderr.includes('Compliance review'),
        `Expected hook block message, got: ${approveResult.stderr}`,
      );

      // Verify state: gate should still be pending (not approved)
      const state = loadCoordinatorState(workspace);
      assert.ok(state.pending_gate, 'pending_gate should still exist after hook block');
      assert.equal(state.pending_gate.gate_type, 'phase_transition');
      assert.equal(state.phase, 'planning', 'phase should NOT have advanced');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-008: on_escalation fires when coordinator enters blocked state', () => {
    // Create an advisory on_escalation hook that writes a marker file
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    // The escalation hook writes a marker to prove it fired
    const markerPath = join(workspace, 'escalation-fired.txt');
    const hookScript = `#!/bin/sh
# Read stdin for the payload
PAYLOAD=$(cat)
echo "$PAYLOAD" > "${markerPath}"
cat <<'HOOKEOF'
{"verdict":"allow","message":"Escalation notification sent"}
HOOKEOF
`;
    writeHookScript(workspace, 'escalation-notify.sh', hookScript);

    const hooks = {
      on_escalation: [
        {
          name: 'escalation-notify',
          type: 'process',
          command: ['./hooks/escalation-notify.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      // Init
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      // Manually put coordinator into blocked state
      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = readJson(statePath);
      writeJson(statePath, {
        ...state,
        status: 'blocked',
        blocked_reason: 'repo api entered unexpected state',
      });

      // Now run multi step — should hit the blocked check and fire on_escalation
      const stepResult = runCli(workspace, ['multi', 'step']);
      assert.notEqual(stepResult.status, 0, 'step should fail on blocked state');
      assert.ok(stepResult.stderr.includes('blocked'), `Expected blocked message: ${stepResult.stderr}`);

      // Verify the escalation hook fired by checking the marker file
      assert.ok(existsSync(markerPath), 'escalation hook should have written marker file');
      const markerContent = readFileSync(markerPath, 'utf8');
      const hookPayload = JSON.parse(markerContent);
      assert.equal(hookPayload.hook_phase, 'on_escalation');
      assert.ok(hookPayload.payload.blocked_reason, 'escalation payload should include blocked_reason');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-006: before_assignment hook block prevents dispatch', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    // Write a blocking before_assignment hook
    const hookScript = `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Assignment denied: security freeze in effect"}
HOOKEOF
`;
    writeHookScript(workspace, 'block-assignment.sh', hookScript);

    const hooks = {
      before_assignment: [
        {
          name: 'security-freeze',
          type: 'process',
          command: ['./hooks/block-assignment.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      // Init
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      // Try to step — before_assignment hook should BLOCK the dispatch
      const stepResult = runCli(workspace, ['multi', 'step']);
      assert.notEqual(stepResult.status, 0, 'step should fail when before_assignment hook blocks');
      assert.ok(
        stepResult.stderr.includes('blocked by hook') || stepResult.stderr.includes('security freeze'),
        `Expected hook block message, got: ${stepResult.stderr}`,
      );

      // Verify that no turn was dispatched in any repo
      const apiState = readJson(join(apiRepo, '.agentxchain', 'state.json'));
      assert.deepEqual(apiState.active_turns, {}, 'api should have no active turns after blocked assignment');

      const webState = readJson(join(webRepo, '.agentxchain', 'state.json'));
      assert.deepEqual(webState.active_turns, {}, 'web should have no active turns after blocked assignment');

      // Verify coordinator history has no dispatch events
      const history = readCoordinatorHistory(workspace);
      const dispatches = history.filter((e) => e.type === 'turn_dispatched');
      assert.equal(dispatches.length, 0, 'no turns should have been dispatched');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('hooks that allow pass through without blocking', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    // Write an allowing before_assignment hook
    const hookScript = `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"allow","message":"Assignment approved"}
HOOKEOF
`;
    writeHookScript(workspace, 'allow-assignment.sh', hookScript);

    const hooks = {
      before_assignment: [
        {
          name: 'allow-gate',
          type: 'process',
          command: ['./hooks/allow-assignment.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      // Init and step — should succeed despite the hook (it allows)
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      const step = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step.status, 0, `step stderr: ${step.stderr}`);
      const result = JSON.parse(step.stdout);
      assert.equal(result.repo_id, 'api', 'should have dispatched to api');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-009: full coordinator hook composition preserves order and payload contract', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    const eventsPath = join(workspace, 'hook-events.jsonl');
    const hookScript = `#!/bin/sh
INPUT=$(cat)
printf '%s\\n' "$INPUT" >> "${eventsPath}"
cat <<'HOOKEOF'
{"verdict":"allow","message":"recorded","annotations":[{"key":"phase","value":"captured"}]}
HOOKEOF
`;
    writeHookScript(workspace, 'record-event.sh', hookScript);

    const hooks = {
      before_assignment: [
        {
          name: 'record-before-assignment',
          type: 'process',
          command: ['./hooks/record-event.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
      after_acceptance: [
        {
          name: 'record-after-acceptance',
          type: 'process',
          command: ['./hooks/record-event.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
      ],
      before_gate: [
        {
          name: 'record-before-gate',
          type: 'process',
          command: ['./hooks/record-event.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
    };

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, hooks),
    );

    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `init stderr: ${init.stderr}`);

      const planningApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(planningApiDispatch.status, 0, `planning api stderr: ${planningApiDispatch.stderr}`);
      simulateAcceptedTurn(apiRepo, 'Planning API accepted');

      const planningWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(planningWebDispatch.status, 0, `planning web stderr: ${planningWebDispatch.stderr}`);
      simulateAcceptedTurn(webRepo, 'Planning web accepted');

      const phaseGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(phaseGateRequest.status, 0, `phase gate request stderr: ${phaseGateRequest.stderr}`);
      const approvePhase = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approvePhase.status, 0, `approve phase stderr: ${approvePhase.stderr}`);

      const implementationApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationApiDispatch.status, 0, `implementation api stderr: ${implementationApiDispatch.stderr}`);
      simulateAcceptedTurn(apiRepo, 'Implementation API accepted', { completed: true });

      const implementationWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationWebDispatch.status, 0, `implementation web stderr: ${implementationWebDispatch.stderr}`);
      simulateAcceptedTurn(webRepo, 'Implementation web accepted', { completed: true });

      const completionGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(completionGateRequest.status, 0, `completion gate request stderr: ${completionGateRequest.stderr}`);
      const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approveCompletion.status, 0, `approve completion stderr: ${approveCompletion.stderr}`);

      const events = readJsonl(eventsPath);
      const phases = events.map((entry) => entry.hook_phase);
      assert.deepEqual(phases, [
        'before_assignment',
        'after_acceptance',
        'before_assignment',
        'after_acceptance',
        'before_gate',
        'before_assignment',
        'after_acceptance',
        'before_assignment',
        'after_acceptance',
        'before_gate',
      ]);

      const assignmentPayload = events.find((entry) => entry.hook_phase === 'before_assignment')?.payload;
      assert.equal(assignmentPayload.repo_id, 'api');
      assert.ok(assignmentPayload.repo_run_id, 'before_assignment payload should include repo_run_id');
      assert.equal(assignmentPayload.pending_gate, null);
      assert.ok(Array.isArray(assignmentPayload.pending_barriers), 'before_assignment payload should include pending_barriers');
      assert.ok(assignmentPayload.pending_barriers.length >= 1, 'pending_barriers should include unsatisfied barriers');

      const acceptancePayload = events.find((entry) => entry.hook_phase === 'after_acceptance')?.payload;
      assert.equal(acceptancePayload.repo_id, 'api');
      assert.equal(acceptancePayload.workstream_id, 'planning_sync');
      assert.ok(acceptancePayload.repo_run_id, 'after_acceptance payload should include repo_run_id');
      assert.ok(acceptancePayload.projection_ref.startsWith('proj_recovery_api'), 'resync payload should include projection_ref');
      assert.ok(Array.isArray(acceptancePayload.barrier_effects), 'after_acceptance payload should include barrier_effects');

      const gatePayloads = events.filter((entry) => entry.hook_phase === 'before_gate').map((entry) => entry.payload);
      assert.equal(gatePayloads.length, 2, 'before_gate should fire for phase transition and completion');
      assert.equal(gatePayloads[0].gate_type, 'phase_transition');
      assert.equal(gatePayloads[1].gate_type, 'run_completion');
      assert.ok(gatePayloads.every((payload) => payload.pending_gate), 'before_gate payload should include pending_gate');

      const annotations = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'hook-annotations.jsonl'));
      assert.equal(annotations.length, 4, 'after_acceptance should append one annotation entry per projected acceptance');
      assert.ok(annotations.every((entry) => entry.hook_name === 'record-after-acceptance'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
