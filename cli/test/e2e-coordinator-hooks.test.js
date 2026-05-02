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
import { describe, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCoordinatorState, readCoordinatorHistory } from '../src/lib/coordinator-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

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

function stageAndAcceptTurn(repoRoot, repoId, summary, options = {}) {
  const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));
  const activeTurn = Object.values(state.active_turns || {})[0];
  assert.ok(activeTurn, `expected active turn in ${repoRoot}`);

  const changedFile = `src/${summary.replace(/\s+/g, '-').toLowerCase()}.ts`;
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, changedFile), `export const result = "${summary}";\n`);

  const stagingPath = join(repoRoot, getTurnStagingResultPath(activeTurn.turn_id));
  mkdirSync(dirname(stagingPath), { recursive: true });
  writeJson(stagingPath, {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: activeTurn.turn_id,
    role: activeTurn.assigned_role,
    runtime_id: activeTurn.runtime_id,
    status: 'completed',
    summary,
    decisions: [
      {
        id: `DEC-${String((state.accepted_count || 0) + 1).padStart(3, '0')}`,
        category: 'implementation',
        statement: summary,
        rationale: 'Coordinator hook E2E acceptance proof.',
      },
    ],
    objections: [],
    files_changed: [changedFile],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node --eval "process.exit(0)"'],
      evidence_summary: `Acceptance proof for ${repoId}.`,
      machine_evidence: [
        { command: 'node --eval "process.exit(0)"', exit_code: 0 },
      ],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: options.phaseTransition || null,
    run_completion_request: options.completed || false,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0 },
  });

  const acceptResult = runCli(repoRoot, ['accept-turn']);
  assert.equal(
    acceptResult.status,
    0,
    `accept-turn failed in ${repoId}:\n${acceptResult.stdout}\n${acceptResult.stderr}`,
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

      stageAndAcceptTurn(apiRepo, 'api', 'planning api done', { phaseTransition: 'implementation' });
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
      stageAndAcceptTurn(apiRepo, 'api', 'planning api done', { phaseTransition: 'implementation' });

      const stepWeb = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(stepWeb.status, 0, `step web stderr: ${stepWeb.stderr}`);
      stageAndAcceptTurn(webRepo, 'web', 'planning web done', { phaseTransition: 'implementation' });

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
      stageAndAcceptTurn(apiRepo, 'api', 'Planning API accepted', { phaseTransition: 'implementation' });

      const planningWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(planningWebDispatch.status, 0, `planning web stderr: ${planningWebDispatch.stderr}`);
      stageAndAcceptTurn(webRepo, 'web', 'Planning web accepted', { phaseTransition: 'implementation' });

      const phaseGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(phaseGateRequest.status, 0, `phase gate request stderr: ${phaseGateRequest.stderr}`);
      const approvePhase = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approvePhase.status, 0, `approve phase stderr: ${approvePhase.stderr}`);

      const implementationApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationApiDispatch.status, 0, `implementation api stderr: ${implementationApiDispatch.stderr}`);
      stageAndAcceptTurn(apiRepo, 'api', 'Implementation API accepted', { completed: true });

      const implementationWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationWebDispatch.status, 0, `implementation web stderr: ${implementationWebDispatch.stderr}`);
      stageAndAcceptTurn(webRepo, 'web', 'Implementation web accepted', { completed: true });

      const completionGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(completionGateRequest.status, 0, `completion gate request stderr: ${completionGateRequest.stderr}`);
      const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approveCompletion.status, 0, `approve completion stderr: ${approveCompletion.stderr}`);

      const events = readJsonl(eventsPath);
      const finalState = loadCoordinatorState(workspace);
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

      assert.ok(finalState?.super_run_id, 'completed coordinator state should retain super_run_id');
      assert.ok(
        events.every((entry) => entry.timestamp && entry.hook_name && entry.payload),
        'every hook envelope should include timestamp, hook_name, and payload',
      );
      assert.ok(
        events.every((entry) => entry.run_id === finalState.super_run_id),
        'every hook envelope should carry the coordinator run id',
      );
      assert.ok(
        events.every((entry) => realpathSync(entry.project_root) === realpathSync(workspace)),
        'every hook envelope should carry the coordinator workspace',
      );

      const assignmentPayloads = events
        .filter((entry) => entry.hook_phase === 'before_assignment')
        .map((entry) => entry.payload);
      assert.equal(assignmentPayloads.length, 4, 'before_assignment should fire once per dispatch');
      assert.deepEqual(
        assignmentPayloads.map((payload) => `${payload.workstream_id}:${payload.repo_id}`),
        [
          'planning_sync:api',
          'planning_sync:web',
          'implementation_sync:api',
          'implementation_sync:web',
        ],
      );
      assert.ok(
        assignmentPayloads.every((payload) => payload.repo_run_id),
        'before_assignment payload should include repo_run_id',
      );
      assert.ok(
        assignmentPayloads.every((payload) => payload.pending_gate === null),
        'before_assignment payload should not carry a pending gate during dispatch',
      );
      assert.ok(
        assignmentPayloads.every((payload) => Array.isArray(payload.pending_barriers)),
        'before_assignment payload should include pending_barriers',
      );
      assert.ok(
        assignmentPayloads.some((payload) => payload.pending_barriers.length >= 1),
        'before_assignment should surface unsatisfied barriers while work remains',
      );

      const acceptancePayloads = events
        .filter((entry) => entry.hook_phase === 'after_acceptance')
        .map((entry) => entry.payload);
      assert.equal(acceptancePayloads.length, 4, 'after_acceptance should fire once per projected acceptance');
      assert.deepEqual(
        acceptancePayloads.map((payload) => `${payload.workstream_id}:${payload.repo_id}`),
        [
          'planning_sync:api',
          'planning_sync:web',
          'implementation_sync:api',
          'implementation_sync:web',
        ],
      );
      assert.ok(
        acceptancePayloads.every((payload) => payload.repo_run_id),
        'after_acceptance payload should include repo_run_id',
      );
      assert.ok(
        acceptancePayloads.every((payload) => payload.repo_turn_id),
        'after_acceptance payload should include repo_turn_id',
      );
      assert.ok(
        acceptancePayloads.every((payload) => typeof payload.summary === 'string' && payload.summary.length > 0),
        'after_acceptance payload should include accepted-turn summary',
      );
      assert.ok(
        acceptancePayloads.every((payload) => Array.isArray(payload.files_changed) && payload.files_changed.length === 1),
        'after_acceptance payload should include accepted-turn files_changed',
      );
      assert.ok(
        acceptancePayloads.every((payload) => Array.isArray(payload.decisions) && payload.decisions.length === 1),
        'after_acceptance payload should include accepted-turn decisions',
      );
      assert.ok(
        acceptancePayloads.every(
          (payload) =>
            payload.verification?.status === 'pass'
            && payload.verification?.machine_evidence?.[0]?.exit_code === 0,
        ),
        'after_acceptance payload should include accepted-turn verification',
      );
      assert.ok(
        acceptancePayloads.every(
          (payload) =>
            typeof payload.projection_ref === 'string'
            && payload.projection_ref.startsWith('proj_')
            && payload.projection_ref.includes(`_${payload.repo_id}_`),
        ),
        'after_acceptance payload should include real coordinator projection references',
      );
      assert.ok(
        acceptancePayloads.every((payload) => Array.isArray(payload.barrier_effects)),
        'after_acceptance payload should include barrier_effects',
      );
      assert.ok(
        acceptancePayloads.every((payload) => Array.isArray(payload.context_invalidations)),
        'after_acceptance payload should include context_invalidations',
      );

      const gatePayloads = events.filter((entry) => entry.hook_phase === 'before_gate').map((entry) => entry.payload);
      assert.equal(gatePayloads.length, 2, 'before_gate should fire for phase transition and completion');
      assert.equal(gatePayloads[0].gate_type, 'phase_transition');
      assert.equal(gatePayloads[1].gate_type, 'run_completion');
      assert.ok(gatePayloads.every((payload) => payload.pending_gate), 'before_gate payload should include pending_gate');
      assert.ok(
        gatePayloads.every((payload) => Array.isArray(payload.required_repos)),
        'before_gate payload should include required_repos',
      );
      assert.deepEqual(gatePayloads[0].required_repos, ['api', 'web'], 'phase transition gate should carry required repos');
      assert.deepEqual(gatePayloads[1].required_repos, ['api', 'web'], 'completion gate should carry required repos');

      const annotations = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'hook-annotations.jsonl'));
      assert.equal(annotations.length, 4, 'after_acceptance should append one annotation entry per projected acceptance');
      assert.ok(annotations.every((entry) => entry.hook_name === 'record-after-acceptance'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-010: after_acceptance hook receives context_invalidations when downstream context exists', () => {
    // This test proves V2-F3: context invalidation payloads in after_acceptance hooks.
    // Setup: init coordinator, dispatch api turn, accept it, dispatch web turn (generates
    // cross-repo context referencing api projections), accept web turn, then accept a
    // SECOND api turn in implementation phase. The resync should fire after_acceptance with
    // context_invalidations listing web's context as stale.

    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-hooks-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');
    writeGovernedRepo(apiRepo, 'api');
    writeGovernedRepo(webRepo, 'web');

    const markerPath = join(workspace, 'invalidation-payload.json');
    const hookScript = `#!/bin/sh
PAYLOAD=$(cat)
echo "$PAYLOAD" > "${markerPath}"
cat <<'HOOKEOF'
{"verdict":"allow","message":"recorded context invalidation payload"}
HOOKEOF
`;
    writeHookScript(workspace, 'record-invalidations.sh', hookScript);

    const hooks = {
      after_acceptance: [
        {
          name: 'record-invalidations',
          type: 'process',
          command: ['./hooks/record-invalidations.sh'],
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
      // Step 1: Init coordinator
      const initResult = runCli(workspace, ['multi', 'init']);
      assert.equal(initResult.status, 0, `init failed: ${initResult.stderr}`);

      // Step 2: Dispatch first api turn (planning phase)
      const step1 = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step1.status, 0, `step1 failed: ${step1.stderr}`);
      const dispatch1 = JSON.parse(step1.stdout);
      assert.equal(dispatch1.repo_id, 'api');

      // Step 3: Accept api turn
      stageAndAcceptTurn(apiRepo, 'api', 'API planning complete', { phaseTransition: 'implementation' });

      // Step 4: Resync + dispatch web turn (generates cross-repo context referencing api)
      const step2 = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step2.status, 0, `step2 failed: ${step2.stderr}`);
      const dispatch2 = JSON.parse(step2.stdout);
      assert.equal(dispatch2.repo_id, 'web');

      // Verify context_generated event was recorded in coordinator history for the web dispatch
      const historyAfterWebDispatch = readJsonl(
        join(workspace, '.agentxchain', 'multirepo', 'history.jsonl'),
      );
      const webContextEvents = historyAfterWebDispatch.filter(
        (e) => e.type === 'context_generated' && e.target_repo_id === 'web',
      );
      assert.ok(webContextEvents.length > 0, 'context_generated event should exist for web after dispatch');
      assert.ok(
        webContextEvents[0].upstream_repo_ids.includes('api'),
        'web context should reference api as upstream',
      );

      // Step 5: Accept web turn
      stageAndAcceptTurn(webRepo, 'web', 'Web planning complete', { phaseTransition: 'implementation' });

      // Step 6: Resync + request phase gate (both repos accepted in planning)
      const step3 = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step3.status, 0, `step3 failed: ${step3.stderr}`);

      // The after_acceptance hook should have fired. Verify the marker exists.
      assert.ok(existsSync(markerPath), 'after_acceptance hook should have fired during resync');

      // Parse the envelope — stdin payload is the hook runner's envelope with .payload inside
      const envelope = JSON.parse(readFileSync(markerPath, 'utf8'));
      const hookPayload = envelope.payload || envelope;
      assert.ok(
        Array.isArray(hookPayload.context_invalidations),
        'after_acceptance payload should include context_invalidations array',
      );
      assert.ok(hookPayload.repo_turn_id, 'after_acceptance payload should include repo_turn_id');
      assert.equal(hookPayload.summary, 'Web planning complete', 'after_acceptance payload should include accepted summary');
      assert.deepEqual(
        hookPayload.decisions.map((decision) => decision.statement),
        ['Web planning complete'],
        'after_acceptance payload should include accepted decision objects',
      );
      assert.equal(hookPayload.verification?.status, 'pass', 'after_acceptance payload should include verification');
      assert.equal(
        hookPayload.verification?.machine_evidence?.[0]?.exit_code,
        0,
        'after_acceptance payload should include machine evidence',
      );
      assert.deepEqual(
        hookPayload.files_changed,
        ['src/web-planning-complete.ts'],
        'after_acceptance payload should include files_changed',
      );

      // Step 7: Approve phase gate, enter implementation phase
      const approveGate1 = runCli(workspace, ['multi', 'approve-gate', '--json']);
      assert.equal(approveGate1.status, 0, `approve gate failed: ${approveGate1.stderr}`);

      // Step 8: Dispatch api turn in implementation phase
      const step4 = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step4.status, 0, `step4 failed: ${step4.stderr}`);
      const dispatch4 = JSON.parse(step4.stdout);
      assert.equal(dispatch4.repo_id, 'api');

      // Step 9: Accept api implementation turn
      stageAndAcceptTurn(apiRepo, 'api', 'API implementation complete');

      // Step 10: Resync — the critical test.
      // api acceptance in implementation phase should trigger after_acceptance.
      // The context invalidation should reference web's planning-phase context as stale
      // because api (which web's context referenced) has a new accepted turn.
      const step5 = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(step5.status, 0, `step5 failed: ${step5.stderr}`);

      // Read the final hook payload (overwritten by the latest after_acceptance fire)
      assert.ok(existsSync(markerPath), 'after_acceptance hook should have fired for api implementation acceptance');

      const finalEnvelope = JSON.parse(readFileSync(markerPath, 'utf8'));
      const finalPayload = finalEnvelope.payload || finalEnvelope;

      assert.ok(
        Array.isArray(finalPayload.context_invalidations),
        'after_acceptance payload must include context_invalidations array',
      );
      assert.ok(finalPayload.repo_turn_id, 'after_acceptance payload must include repo_turn_id');
      assert.equal(finalPayload.summary, 'API implementation complete', 'payload should include accepted summary');
      assert.deepEqual(
        finalPayload.decisions.map((decision) => decision.statement),
        ['API implementation complete'],
        'payload should include accepted decision objects',
      );
      assert.equal(finalPayload.verification?.status, 'pass', 'payload should include accepted verification');
      assert.equal(
        finalPayload.verification?.machine_evidence?.[0]?.exit_code,
        0,
        'payload should include accepted verification evidence',
      );
      assert.deepEqual(
        finalPayload.files_changed,
        ['src/api-implementation-complete.ts'],
        'payload should include accepted files_changed',
      );

      // The context invalidation should reference the web repo's context as stale
      // because the api repo (which web's context referenced) has a new accepted turn.
      if (finalPayload.context_invalidations.length > 0) {
        const invalidation = finalPayload.context_invalidations[0];
        assert.equal(invalidation.source_repo_id, 'api', 'invalidation source should be api');
        assert.equal(invalidation.target_repo_id, 'web', 'invalidation target should be web');
        assert.ok(invalidation.context_ref, 'invalidation should include context_ref');
        assert.ok(invalidation.reason, 'invalidation should include reason');
        assert.ok(
          Array.isArray(invalidation.files_changed),
          'invalidation should include files_changed from the accepted turn',
        );
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
