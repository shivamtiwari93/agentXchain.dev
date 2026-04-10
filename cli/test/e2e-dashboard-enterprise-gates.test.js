import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { normalizeGovernedStateShape, getActiveTurn } from '../src/lib/governed-state.js';
import { render as renderGate } from '../dashboard/components/gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard', import.meta.url));
const STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';

const cleanupDirs = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    rmSync(cleanupDirs.pop(), { recursive: true, force: true });
  }
});

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-dashboard-gates-'));
  cleanupDirs.push(dir);
  return dir;
}

function runCli(dir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  result.combined = `${result.stdout || ''}${result.stderr || ''}`;
  return result;
}

function readJson(dir, relPath) {
  return JSON.parse(readFileSync(join(dir, relPath), 'utf8'));
}

function readState(dir) {
  const normalized = normalizeGovernedStateShape(readJson(dir, STATE_PATH)).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(normalized);
    },
  });
  return normalized;
}

function writeTurnResult(dir, state, overrides = {}) {
  const turn = state.current_turn;
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Completed ${turn.assigned_role} work.`,
    decisions: [
      {
        id: 'DEC-001',
        category: 'process',
        statement: 'Advance the governed enterprise workflow with truthful gate evidence.',
        rationale: 'Dashboard gate proof must come from a real governed run, not a hand-built fixture.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Keep the dashboard evidence window phase-scoped instead of leaking earlier summaries.',
        status: 'raised',
      },
    ],
    risks: [
      {
        statement: 'Shipping gate claims without render proof would overstate the operator surface.',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Manual review complete.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0.001 },
    ...overrides,
  };

  const stagingDir = join(dir, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(base, null, 2) + '\n');
}

function fillPlanningArtifacts(dir) {
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
  writeFileSync(
    join(dir, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n## Phases\n\n| Phase | Goal |\n|---|---|\n| Planning | Define scope and hand off to architecture. |\n| Architecture | Freeze the design boundary. |\n| Implementation | Build the approved slice. |\n| Security Review | Close the security verdict. |\n| QA | Approve ship readiness. |\n',
  );
  writeFileSync(
    join(dir, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nProve the enterprise dashboard gate surface through the real governed run path.\n\n## Interface\n\n- planning -> architecture -> implementation -> security_review -> qa\n\n## Acceptance Tests\n\n- [ ] Planning gate renders PM evidence.\n- [ ] Completion gate renders QA evidence.\n',
  );
}

function fillArchitectureArtifact(dir) {
  writeFileSync(
    join(dir, '.planning', 'ARCHITECTURE.md'),
    '# Architecture\n\n## Context\n\nCapture the system boundary before implementation starts.\n\n## Proposed Design\n\nThe implementation phase only starts after the architecture contract is explicit.\n\n## Trade-offs\n\nTemplate reuse centralizes the structural contract while ownership stays local.\n\n## Risks\n\nSkipping the architect-owned handoff would make the protocol theater.\n',
  );
}

function fillImplementationArtifact(dir) {
  writeFileSync(
    join(dir, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n\nImplemented the approved slice under the architecture contract.\n\n## Verification\n\nRun `echo implementation-ok` to confirm the implementation turn recorded machine evidence.\n',
  );
}

function fillSecurityArtifact(dir) {
  writeFileSync(
    join(dir, '.planning', 'SECURITY_REVIEW.md'),
    '# Security Review\n\n## Threat Model\n\nThe security reviewer validated the main data and auth boundaries.\n\n## Findings\n\nNo open blockers remain for the scoped change.\n\n## Verdict\n\nApproved for QA handoff.\n',
  );
}

function fillQaArtifacts(dir) {
  writeFileSync(
    join(dir, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|---|---|---|---|---|---|\n| 1 | Dashboard gate proof | Planning and completion gates render truthful evidence | pass | 2026-04-10 | pass |\n',
  );
  writeFileSync(
    join(dir, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\n## Rationale\n\nAll enterprise gate evidence is visible from the dashboard gate view.\n',
  );
  writeFileSync(
    join(dir, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nOperators can now trust the dashboard gate view on the enterprise-app path.\n\n## Verification Summary\n\nAll 5 enterprise phases verified through real governed workflow.\n',
  );
}

function startDashboard(dir) {
  const bridge = createBridgeServer({
    agentxchainDir: join(dir, '.agentxchain'),
    dashboardDir: DASHBOARD_DIR,
    port: 0,
  });
  return bridge.start().then(({ port }) => ({ bridge, port }));
}

function httpRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`timeout for GET ${path}`));
    });
    req.end();
  });
}

async function getJson(port, path) {
  const res = await httpRequest(port, path);
  assert.equal(res.status, 200, `expected 200 for ${path}`);
  return JSON.parse(res.body);
}

function initEnterpriseApp(dir) {
  const init = runCli(dir, ['init', '--governed', '--template', 'enterprise-app', '--dir', '.', '-y']);
  assert.equal(init.status, 0, init.combined);
}

function resumeAndRead(dir, expectedRole) {
  const resume = runCli(dir, ['resume']);
  assert.equal(resume.status, 0, resume.combined);
  const state = readState(dir);
  assert.equal(state.current_turn.assigned_role, expectedRole);
  return state;
}

function driveToPlanningGate(dir) {
  initEnterpriseApp(dir);
  let state = resumeAndRead(dir, 'pm');
  fillPlanningArtifacts(dir);
  writeTurnResult(dir, state, {
    role: 'pm',
    runtime_id: 'manual-pm',
    summary: 'Planning complete. Ready for architecture review.',
    files_changed: [
      '.planning/PM_SIGNOFF.md',
      '.planning/ROADMAP.md',
      '.planning/SYSTEM_SPEC.md',
    ],
    artifacts_created: [
      '.planning/PM_SIGNOFF.md',
      '.planning/ROADMAP.md',
      '.planning/SYSTEM_SPEC.md',
    ],
    proposed_next_role: 'human',
    phase_transition_request: 'architecture',
  });

  const acceptPlanning = runCli(dir, ['accept-turn']);
  assert.equal(acceptPlanning.status, 0, acceptPlanning.combined);
  state = readState(dir);
  assert.equal(state.status, 'paused');
  assert.equal(state.phase, 'planning');
  assert.equal(state.pending_phase_transition.gate, 'planning_signoff');
  assert.equal(state.pending_phase_transition.to, 'architecture');
  return state;
}

function driveToCompletionGate(dir) {
  let state = driveToPlanningGate(dir);

  const approvePlanning = runCli(dir, ['approve-transition']);
  assert.equal(approvePlanning.status, 0, approvePlanning.combined);
  state = readState(dir);
  assert.equal(state.phase, 'architecture');
  assert.equal(state.status, 'active');
  assert.equal(state.phase_gate_status.planning_signoff, 'passed');

  state = resumeAndRead(dir, 'architect');
  fillArchitectureArtifact(dir);
  writeTurnResult(dir, state, {
    role: 'architect',
    runtime_id: 'manual-architect',
    summary: 'Architecture review complete. Ready for implementation.',
    files_changed: ['.planning/ARCHITECTURE.md'],
    artifacts_created: ['.planning/ARCHITECTURE.md'],
    proposed_next_role: 'dev',
    phase_transition_request: 'implementation',
  });

  const acceptArchitecture = runCli(dir, ['accept-turn']);
  assert.equal(acceptArchitecture.status, 0, acceptArchitecture.combined);
  state = readState(dir);
  assert.equal(state.phase, 'implementation');
  assert.equal(state.phase_gate_status.architecture_review, 'passed');

  state = resumeAndRead(dir, 'dev');
  fillImplementationArtifact(dir);
  writeTurnResult(dir, state, {
    role: 'dev',
    runtime_id: 'local-dev',
    summary: 'Implementation complete. Ready for security review.',
    files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
    artifacts_created: ['.planning/IMPLEMENTATION_NOTES.md'],
    proposed_next_role: 'security_reviewer',
    phase_transition_request: 'security_review',
    verification: {
      status: 'pass',
      commands: ['echo implementation-ok'],
      evidence_summary: 'Implementation verification passed.',
      machine_evidence: [{ command: 'echo implementation-ok', exit_code: 0 }],
    },
  });

  const acceptImplementation = runCli(dir, ['accept-turn']);
  assert.equal(acceptImplementation.status, 0, acceptImplementation.combined);
  state = readState(dir);
  assert.equal(state.phase, 'security_review');
  assert.equal(state.phase_gate_status.implementation_complete, 'passed');

  state = resumeAndRead(dir, 'security_reviewer');
  fillSecurityArtifact(dir);
  writeTurnResult(dir, state, {
    role: 'security_reviewer',
    runtime_id: 'manual-security',
    summary: 'Security review complete. Ready for QA.',
    files_changed: ['.planning/SECURITY_REVIEW.md'],
    artifacts_created: ['.planning/SECURITY_REVIEW.md'],
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
  });

  const acceptSecurity = runCli(dir, ['accept-turn']);
  assert.equal(acceptSecurity.status, 0, acceptSecurity.combined);
  state = readState(dir);
  assert.equal(state.phase, 'qa');
  assert.equal(state.phase_gate_status.security_review_signoff, 'passed');

  state = resumeAndRead(dir, 'qa');
  fillQaArtifacts(dir);
  writeTurnResult(dir, state, {
    role: 'qa',
    runtime_id: 'api-qa',
    summary: 'QA complete. Ready for governed completion.',
    files_changed: [
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      '.planning/RELEASE_NOTES.md',
    ],
    artifacts_created: [
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      '.planning/RELEASE_NOTES.md',
    ],
    proposed_next_role: 'human',
    run_completion_request: true,
  });

  const acceptQa = runCli(dir, ['accept-turn']);
  assert.equal(acceptQa.status, 0, acceptQa.combined);
  state = readState(dir);
  assert.equal(state.status, 'paused');
  assert.equal(state.phase, 'qa');
  assert.equal(state.pending_run_completion.gate, 'qa_ship_verdict');
  assert.equal(state.phase_gate_status.qa_ship_verdict, 'pending');
  return state;
}

describe('Enterprise dashboard gate E2E', () => {
  it('AT-DASH-ENT-GATE-001: planning gate renders PM evidence from the real enterprise-app run', async () => {
    const dir = makeWorkspace();
    driveToPlanningGate(dir);

    const { bridge, port } = await startDashboard(dir);
    try {
      const state = await getJson(port, '/api/state');
      const history = await getJson(port, '/api/history');
      const html = renderGate({ state, history });

      assert.equal(state.pending_phase_transition.gate, 'planning_signoff');
      assert.ok(html.includes('Phase Transition Gate'));
      assert.ok(html.includes('planning_signoff'));
      assert.ok(html.includes('planning'));
      assert.ok(html.includes('architecture'));
      assert.ok(html.includes('Planning complete. Ready for architecture review.'));
      assert.ok(html.includes('Advance the governed enterprise workflow with truthful gate evidence.'));
      assert.ok(html.includes('Keep the dashboard evidence window phase-scoped instead of leaking earlier summaries.'));
      assert.ok(html.includes('.planning/PM_SIGNOFF.md'));
      assert.ok(html.includes('agentxchain approve-transition'));
      assert.ok(html.includes('1 turn'));
    } finally {
      await bridge.stop();
    }
  });

  it('AT-DASH-ENT-GATE-002: completion gate renders QA evidence after all earlier enterprise gates pass', async () => {
    const dir = makeWorkspace();
    const liveState = driveToCompletionGate(dir);

    assert.equal(liveState.phase_gate_status.planning_signoff, 'passed');
    assert.equal(liveState.phase_gate_status.architecture_review, 'passed');
    assert.equal(liveState.phase_gate_status.implementation_complete, 'passed');
    assert.equal(liveState.phase_gate_status.security_review_signoff, 'passed');
    assert.equal(liveState.phase_gate_status.qa_ship_verdict, 'pending');

    const { bridge, port } = await startDashboard(dir);
    try {
      const state = await getJson(port, '/api/state');
      const history = await getJson(port, '/api/history');
      const html = renderGate({ state, history });

      assert.ok(html.includes('Run Completion Gate'));
      assert.ok(html.includes('qa_ship_verdict'));
      assert.ok(html.includes('QA complete. Ready for governed completion.'));
      assert.ok(html.includes('Advance the governed enterprise workflow with truthful gate evidence.'));
      assert.ok(html.includes('.planning/acceptance-matrix.md'));
      assert.ok(html.includes('.planning/ship-verdict.md'));
      assert.ok(html.includes('.planning/RELEASE_NOTES.md'));
      assert.ok(html.includes('agentxchain approve-completion'));
      assert.ok(html.includes('1 turn'));
      assert.ok(!html.includes('Security review complete. Ready for QA.'));
    } finally {
      await bridge.stop();
    }
  });
});
