import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initializeCoordinatorRun,
  loadCoordinatorState,
  readCoordinatorDecisionLedger,
  readBarriers,
  saveCoordinatorState,
} from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import { selectNextAssignment, dispatchCoordinatorTurn } from '../src/lib/coordinator-dispatch.js';
import { projectRepoAcceptance } from '../src/lib/coordinator-acceptance.js';
import {
  approveCoordinatorCompletion,
  approveCoordinatorPhaseTransition,
  requestCoordinatorCompletion,
  requestPhaseTransition,
} from '../src/lib/coordinator-gates.js';
import { resumeCoordinatorFromBlockedState } from '../src/lib/coordinator-recovery.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-coord-ledger-'));
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

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
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
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
  });
}

function buildCoordinatorConfig(repoPaths, overrides = {}) {
  return {
    schema_version: '0.1',
    project: { id: 'coord-ledger-test', name: 'Coordinator Ledger Test' },
    repos: {
      api: { path: repoPaths.api, default_branch: 'main', required: true },
      web: { path: repoPaths.web, default_branch: 'main', required: true },
    },
    workstreams: overrides.workstreams || {
      planning_sync: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_build: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
      qa_release: {
        phase: 'qa',
        repos: ['api', 'web'],
        entry_repo: 'web',
        depends_on: ['implementation_build'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: overrides.routing || {
      planning: { entry_workstream: 'planning_sync' },
      implementation: { entry_workstream: 'implementation_build' },
      qa: { entry_workstream: 'qa_release' },
    },
    gates: overrides.gates || {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function setupWorkspace(configOverrides = {}) {
  const workspace = makeWorkspace();
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');

  writeGovernedRepo(apiRepo, 'api');
  writeGovernedRepo(webRepo, 'web');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }, configOverrides),
  );

  const configResult = loadCoordinatorConfig(workspace);
  assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

  const initResult = initializeCoordinatorRun(workspace, configResult.config);
  assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

  return {
    workspace,
    apiRepo,
    webRepo,
    config: configResult.config,
    state: loadCoordinatorState(workspace),
  };
}

function makeAcceptedTurn(turnId, overrides = {}) {
  return {
    turn_id: turnId,
    summary: overrides.summary ?? `Completed work for ${turnId}`,
    files_changed: overrides.files_changed ?? ['src/index.ts'],
    decisions: overrides.decisions ?? [`DEC-${turnId}`],
    verification: overrides.verification ?? { command: 'npm test', exit_code: 0 },
    ...overrides,
  };
}

function updateRepoState(repoRoot, patch) {
  const file = join(repoRoot, '.agentxchain/state.json');
  const current = JSON.parse(readFileSync(file, 'utf8'));
  writeJson(file, { ...current, ...patch });
}

function markAllBarriersSatisfied(workspace) {
  const barriers = readBarriers(workspace);
  for (const barrier of Object.values(barriers)) {
    barrier.status = 'satisfied';
  }
  writeJson(join(workspace, '.agentxchain/multirepo/barriers.json'), barriers);
}

describe('coordinator decision ledger writes', () => {
  it('AT-COORD-LEDGER-001: init appends an initialization decision', () => {
    const { workspace } = setupWorkspace();
    try {
      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].id, 'DEC-COORD-001');
      assert.equal(ledger[0].category, 'initialization');
      assert.match(ledger[0].statement, /Initialized coordinator run/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-002: dispatch appends repo and workstream metadata', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const assignment = selectNextAssignment(workspace, state, config);
      assert.equal(assignment.ok, true);

      const dispatch = dispatchCoordinatorTurn(workspace, state, config, assignment);
      assert.equal(dispatch.ok, true, dispatch.error);

      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.equal(ledger.length, 2);
      assert.equal(ledger[1].id, 'DEC-COORD-002');
      assert.equal(ledger[1].category, 'dispatch');
      assert.equal(ledger[1].repo_id, assignment.repo_id);
      assert.equal(ledger[1].workstream_id, assignment.workstream_id);
      assert.equal(ledger[1].repo_turn_id, dispatch.turn_id);
      assert.match(ledger[1].statement, /Dispatched api to dev for workstream planning_sync/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-003: phase-transition request and approval append ordered decisions', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_api_001'), 'planning_sync');
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_web_001'), 'planning_sync');

      const request = requestPhaseTransition(workspace, state, config, 'implementation');
      assert.equal(request.ok, true, request.error);

      const approval = approveCoordinatorPhaseTransition(workspace, request.state, config);
      assert.equal(approval.ok, true, approval.error);

      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.equal(ledger.map((entry) => entry.id).slice(-2).join(','), 'DEC-COORD-002,DEC-COORD-003');
      assert.equal(ledger[1].category, 'phase_transition');
      assert.equal(ledger[1].from, 'planning');
      assert.equal(ledger[1].to, 'implementation');
      assert.match(ledger[1].statement, /Requested phase transition from planning to implementation/);
      assert.equal(ledger[2].category, 'phase_transition');
      assert.match(ledger[2].statement, /Approved phase transition from planning to implementation/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-004: completion request and approval append ordered decisions', () => {
    const { workspace, apiRepo, webRepo, config, state } = setupWorkspace();
    try {
      saveCoordinatorState(workspace, { ...state, phase: 'qa' });
      markAllBarriersSatisfied(workspace);

      updateRepoState(apiRepo, { status: 'completed', active_turns: {} });
      updateRepoState(webRepo, { status: 'completed', active_turns: {} });

      const request = requestCoordinatorCompletion(workspace, loadCoordinatorState(workspace), config);
      assert.equal(request.ok, true, request.error);

      const approval = approveCoordinatorCompletion(workspace, request.state, config);
      assert.equal(approval.ok, true, approval.error);

      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.equal(ledger.map((entry) => entry.id).slice(-2).join(','), 'DEC-COORD-002,DEC-COORD-003');
      assert.equal(ledger[1].category, 'completion');
      assert.match(ledger[1].statement, /Requested coordinator completion gate initiative_ship/);
      assert.equal(ledger[2].category, 'completion');
      assert.match(ledger[2].statement, /Approved coordinator completion gate initiative_ship/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-005: successful blocked-state resume appends a recovery decision', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      saveCoordinatorState(workspace, {
        ...state,
        status: 'blocked',
        blocked_reason: 'hook escalation',
      });

      // Recovery report is required before resume (DEC-RECOVERY-REPORT-001)
      writeFileSync(join(workspace, '.agentxchain/multirepo/RECOVERY_REPORT.md'),
        '# Recovery Report\n\n## Trigger\n\nHook escalation detected.\n\n## Impact\n\nCoordinator blocked.\n\n## Mitigation\n\nOperator confirmed safe to resume.\n');

      const resume = resumeCoordinatorFromBlockedState(workspace, loadCoordinatorState(workspace), config);
      assert.equal(resume.ok, true, resume.error);

      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.equal(ledger.length, 2);
      assert.equal(ledger[1].id, 'DEC-COORD-002');
      assert.equal(ledger[1].category, 'recovery');
      assert.equal(ledger[1].from, 'blocked');
      assert.equal(ledger[1].to, 'active');
      assert.equal(ledger[1].reason, 'hook escalation');
      assert.match(ledger[1].statement, /Resumed coordinator from blocked to active/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-006: ids increment monotonically across coordinator-owned writes', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_api_001'), 'planning_sync');
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_web_001'), 'planning_sync');

      const request = requestPhaseTransition(workspace, loadCoordinatorState(workspace), config, 'implementation');
      assert.equal(request.ok, true, request.error);

      const ledger = readCoordinatorDecisionLedger(workspace);
      assert.deepEqual(
        ledger.map((entry) => entry.id),
        ['DEC-COORD-001', 'DEC-COORD-002'],
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-COORD-LEDGER-007: spec remains present and names the shared writer plus required surfaces', () => {
    const spec = readFileSync(
      join(REPO_ROOT, '.planning', 'COORDINATOR_DECISION_LEDGER_WRITES_SPEC.md'),
      'utf8',
    );
    assert.match(spec, /recordCoordinatorDecision/);
    assert.match(spec, /initializeCoordinatorRun/);
    assert.match(spec, /dispatchCoordinatorTurn/);
    assert.match(spec, /resumeCoordinatorFromBlockedState/);
  });
});
