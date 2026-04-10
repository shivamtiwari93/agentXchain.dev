import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function createGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    protocol_mode: 'governed',
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
      'manual-qa': {
        type: 'manual',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
      },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
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
  });

  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
}

function createWorkspace(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-intake-handoff-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');

  createGovernedRepo(apiRepo, 'api');
  createGovernedRepo(webRepo, 'web');

  writeJson(join(workspace, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Test' },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstreams: options.workstreams || {
      delivery: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: options.entryWorkstream || 'delivery' },
    },
    gates: {
      ship_gate: { requires_human_approval: true, requires_repos: ['api', 'web'] },
    },
  });

  return { workspace, apiRepo, webRepo };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
  });
}

function parseJsonResult(result, context) {
  assert.equal(result.stderr, '', `${context} stderr should be empty`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${context} returned invalid JSON:\n${result.stdout}\n${error.message}`);
  }
}

function pipelineThroughPlan(repoRoot) {
  const record = runCli([
    'intake', 'record',
    '--source', 'manual',
    '--signal', `{"desc":"handoff ${Date.now()}"}`,
    '--evidence', '{"type":"text","value":"operator report"}',
    '--json',
  ], repoRoot);
  assert.equal(record.status, 0, record.stderr);
  const intentId = parseJsonResult(record, 'record').intent.intent_id;

  const triage = runCli([
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'generic',
    '--charter', 'Coordinate delivery work across repos',
    '--acceptance', 'api and web stay aligned',
    '--json',
  ], repoRoot);
  assert.equal(triage.status, 0, triage.stderr);

  const approve = runCli(['intake', 'approve', '--intent', intentId, '--json'], repoRoot);
  assert.equal(approve.status, 0, approve.stderr);

  const plan = runCli(['intake', 'plan', '--intent', intentId, '--json'], repoRoot);
  assert.equal(plan.status, 0, plan.stderr);

  return intentId;
}

function initializeCoordinator(workspace) {
  const result = runCli(['multi', 'init', '--json'], workspace);
  assert.equal(result.status, 0, result.stderr);
  return parseJsonResult(result, 'multi init');
}

function readCoordinatorState(workspace) {
  return JSON.parse(readFileSync(join(workspace, '.agentxchain', 'multirepo', 'state.json'), 'utf8'));
}

function writeCoordinatorState(workspace, state) {
  writeJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'), state);
}

function readBarrierSnapshot(workspace) {
  return JSON.parse(readFileSync(join(workspace, '.agentxchain', 'multirepo', 'barriers.json'), 'utf8'));
}

function writeBarrierSnapshot(workspace, barriers) {
  writeJson(join(workspace, '.agentxchain', 'multirepo', 'barriers.json'), barriers);
}

function readIntent(repoRoot, intentId) {
  return JSON.parse(readFileSync(join(repoRoot, '.agentxchain', 'intake', 'intents', `${intentId}.json`), 'utf8'));
}

function writeIntent(repoRoot, intentId, intent) {
  writeJson(join(repoRoot, '.agentxchain', 'intake', 'intents', `${intentId}.json`), intent);
}

describe('intake handoff', () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it('AT-HANDOFF-001: writes a run-bound handoff ref and sets target_workstream on success', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    const init = initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const result = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(result.status, 0, result.stderr);
    const out = parseJsonResult(result, 'intake handoff');

    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'executing');
    assert.equal(out.intent.target_run, null);
    assert.equal(out.intent.target_workstream.workstream_id, 'delivery');
    assert.equal(out.intent.target_workstream.super_run_id, init.super_run_id);

    const handoffPath = join(workspace, '.agentxchain', 'multirepo', 'handoffs', `${intentId}.json`);
    assert.ok(existsSync(handoffPath), 'handoff ref must be written');
    const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'));
    assert.equal(handoff.super_run_id, init.super_run_id);
    assert.equal(handoff.source_repo, 'api');
    assert.equal(handoff.source_signal_source, 'manual');
    assert.equal(handoff.source_signal_category, 'manual_signal');
  });

  it('AT-HANDOFF-002: rejects handoff when intent is not in planned state', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    initializeCoordinator(workspace);

    const record = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"not planned"}',
      '--evidence', '{"type":"text","value":"operator report"}',
      '--json',
    ], apiRepo);
    const intentId = parseJsonResult(record, 'record').intent.intent_id;

    const result = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(result.status, 1, result.stderr);
    const out = parseJsonResult(result, 'handoff reject');
    assert.match(out.error, /planned state/);
    assert.match(out.error, /detected/);
  });

  it('AT-HANDOFF-003 and AT-HANDOFF-004: rejects missing coordinator config and unknown workstream', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const missingCoordinator = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', './missing',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(missingCoordinator.status, 1, missingCoordinator.stderr);
    assert.match(parseJsonResult(missingCoordinator, 'handoff missing coordinator').error, /agentxchain-multi\.json/);

    const unknownWorkstream = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'missing_ws',
      '--json',
    ], apiRepo);
    assert.equal(unknownWorkstream.status, 1, unknownWorkstream.stderr);
    assert.match(parseJsonResult(unknownWorkstream, 'handoff missing workstream').error, /missing_ws/);
  });

  it('AT-HANDOFF-005 and AT-HANDOFF-010: rejects repos outside the workstream and inactive coordinator runs', () => {
    const { workspace, apiRepo } = createWorkspace({
      workstreams: {
        web_only: {
          phase: 'implementation',
          repos: ['web'],
          entry_repo: 'web',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      entryWorkstream: 'web_only',
    });
    cleanup.push(workspace);
    initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const wrongRepo = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'web_only',
      '--json',
    ], apiRepo);
    assert.equal(wrongRepo.status, 1, wrongRepo.stderr);
    assert.match(parseJsonResult(wrongRepo, 'handoff wrong repo').error, /repo api is not a member/);

    const { workspace: workspace2, apiRepo: apiRepo2 } = createWorkspace();
    cleanup.push(workspace2);
    initializeCoordinator(workspace2);
    const intentId2 = pipelineThroughPlan(apiRepo2);
    const inactiveState = readCoordinatorState(workspace2);
    inactiveState.status = 'completed';
    writeCoordinatorState(workspace2, inactiveState);

    const inactive = runCli([
      'intake', 'handoff',
      '--intent', intentId2,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo2);
    assert.equal(inactive.status, 1, inactive.stderr);
    assert.match(parseJsonResult(inactive, 'handoff inactive coordinator').error, /status: completed/);
  });

  it('AT-HANDOFF-006, AT-HANDOFF-007, AT-HANDOFF-008, and AT-HANDOFF-011: resolve tracks coordinator barrier truth', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const handoff = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(handoff.status, 0, handoff.stderr);

    const noChange = runCli(['intake', 'resolve', '--intent', intentId, '--json'], apiRepo);
    assert.equal(noChange.status, 0, noChange.stderr);
    const noChangeOut = parseJsonResult(noChange, 'resolve no-change');
    assert.equal(noChangeOut.no_change, true);
    assert.equal(noChangeOut.run_outcome, 'active');

    const blockedState = readCoordinatorState(workspace);
    blockedState.status = 'blocked';
    blockedState.blocked_reason = 'repo_api_blocked';
    writeCoordinatorState(workspace, blockedState);

    const blocked = runCli(['intake', 'resolve', '--intent', intentId, '--json'], apiRepo);
    assert.equal(blocked.status, 0, blocked.stderr);
    const blockedOut = parseJsonResult(blocked, 'resolve blocked');
    assert.equal(blockedOut.new_status, 'blocked');
    assert.equal(blockedOut.intent.run_blocked_reason, 'repo_api_blocked');
    assert.equal(blockedOut.intent.run_blocked_on, 'coordinator:delivery');

    const intent = readIntent(apiRepo, intentId);
    intent.status = 'executing';
    intent.updated_at = new Date().toISOString();
    writeIntent(apiRepo, intentId, intent);

    const completedState = readCoordinatorState(workspace);
    completedState.status = 'active';
    completedState.blocked_reason = null;
    writeCoordinatorState(workspace, completedState);
    const barriers = readBarrierSnapshot(workspace);
    barriers.delivery_completion.status = 'satisfied';
    writeBarrierSnapshot(workspace, barriers);

    const completed = runCli(['intake', 'resolve', '--intent', intentId, '--json'], apiRepo);
    assert.equal(completed.status, 0, completed.stderr);
    const completedOut = parseJsonResult(completed, 'resolve completed');
    assert.equal(completedOut.new_status, 'completed');

    const intentAgain = readIntent(apiRepo, intentId);
    intentAgain.status = 'executing';
    intentAgain.updated_at = new Date().toISOString();
    writeIntent(apiRepo, intentId, intentAgain);
    const failingBarriers = readBarrierSnapshot(workspace);
    failingBarriers.delivery_completion.status = 'pending';
    writeBarrierSnapshot(workspace, failingBarriers);
    const finishedState = readCoordinatorState(workspace);
    finishedState.status = 'completed';
    writeCoordinatorState(workspace, finishedState);

    const blockedByCoord = runCli(['intake', 'resolve', '--intent', intentId, '--json'], apiRepo);
    assert.equal(blockedByCoord.status, 0, blockedByCoord.stderr);
    const coordBlockedOut = parseJsonResult(blockedByCoord, 'resolve blocked by coordinator completion');
    assert.equal(coordBlockedOut.new_status, 'blocked');
    assert.ok(coordBlockedOut.intent.run_blocked_reason);
  });

  it('AT-HANDOFF-009: coordinator dispatch context includes the intake handoff section and filters stale run refs', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    const init = initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const handoff = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(handoff.status, 0, handoff.stderr);

    writeJson(join(workspace, '.agentxchain', 'multirepo', 'handoffs', 'stale-intent.json'), {
      schema_version: '1.0',
      super_run_id: 'srun_stale',
      intent_id: 'stale-intent',
      source_repo: 'api',
      source_event_id: 'evt_stale',
      source_signal_source: 'manual',
      source_signal_category: 'manual_signal',
      source_event_ref: '.agentxchain/intake/events/evt_stale.json',
      workstream_id: 'delivery',
      charter: 'stale charter',
      acceptance_contract: ['ignore me'],
      evidence_refs: ['.agentxchain/intake/events/evt_stale.json'],
      handed_off_at: new Date().toISOString(),
      handed_off_by: 'operator',
    });

    const step = runCli(['multi', 'step', '--json'], workspace);
    assert.equal(step.status, 0, step.stderr);
    const stepOut = parseJsonResult(step, 'multi step');
    const contextMd = readFileSync(join(stepOut.bundle_path, 'COORDINATOR_CONTEXT.md'), 'utf8');
    const contextJson = JSON.parse(readFileSync(join(stepOut.bundle_path, 'COORDINATOR_CONTEXT.json'), 'utf8'));

    assert.equal(stepOut.workstream_id, 'delivery');
    assert.ok(contextJson.intake_handoffs.length > 0, 'current-run handoff must be included');
    assert.equal(contextJson.intake_handoffs[0].intent_id, intentId);
    assert.equal(contextJson.intake_handoffs[0].source_repo, 'api');
    assert.equal(contextJson.super_run_id, init.super_run_id);
    assert.match(contextMd, /## Intake Handoff/);
    assert.match(contextMd, new RegExp(intentId));
    assert.match(contextMd, /Coordinate delivery work across repos/);
    assert.doesNotMatch(contextMd, /stale charter/);
  });

  it('AT-HANDOFF-012: resolve rejects coordinator super-run drift instead of attaching to a new run', () => {
    const { workspace, apiRepo } = createWorkspace();
    cleanup.push(workspace);
    initializeCoordinator(workspace);
    const intentId = pipelineThroughPlan(apiRepo);

    const handoff = runCli([
      'intake', 'handoff',
      '--intent', intentId,
      '--coordinator-root', '../..',
      '--workstream', 'delivery',
      '--json',
    ], apiRepo);
    assert.equal(handoff.status, 0, handoff.stderr);

    const state = readCoordinatorState(workspace);
    state.super_run_id = 'srun_new';
    writeCoordinatorState(workspace, state);

    const resolve = runCli(['intake', 'resolve', '--intent', intentId, '--json'], apiRepo);
    assert.equal(resolve.status, 1, resolve.stderr);
    assert.match(parseJsonResult(resolve, 'resolve super-run mismatch').error, /super_run_id mismatch/);
  });
});
