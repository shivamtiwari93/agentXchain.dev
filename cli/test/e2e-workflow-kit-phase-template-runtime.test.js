import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeGovernedStateShape, getActiveTurn } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';

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

function readJsonl(dir, relPath) {
  const content = readFileSync(join(dir, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
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
        statement: 'Advance the workflow-kit phase-template run through the governed phase chain.',
        rationale: 'Template-backed phase contracts must be runtime-proven, not only scaffolded.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Keep ownership overrides explicit where phase templates do not infer them.',
        status: 'raised',
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
    '# System Spec\n\n## Purpose\n\nProve built-in workflow-kit phase templates through the enterprise-app runtime path.\n\n## Interface\n\n- planning -> architecture -> implementation -> security_review -> qa\n\n## Acceptance Tests\n\n- [ ] Planning advances to architecture.\n- [ ] Architecture advances only after the architect turn is accepted.\n- [ ] Security review reaches QA before completion approval.\n',
  );
}

function fillArchitectureArtifact(dir) {
  writeFileSync(
    join(dir, '.planning', 'ARCHITECTURE.md'),
    '# Architecture\n\n## Context\n\nCapture the system boundary before implementation starts.\n\n## Proposed Design\n\nThe implementation phase only starts after the architecture contract is explicit.\n\n## Trade-offs\n\nThe built-in phase template keeps the structural contract centralized while owned_by stays local.\n\n## Risks\n\nSkipping the architect-owned handoff would make the protocol theater.\n',
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
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|---|---|---|---|---|---|\n| 1 | Phase templates run at runtime | Planning, architecture, implementation, security review, and QA all transition cleanly | pass | 2026-04-10 | pass |\n',
  );
  writeFileSync(
    join(dir, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\n## Rationale\n\nAll phase-template-backed artifacts and ownership checks passed.\n',
  );
  writeFileSync(
    join(dir, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nOperators can now rely on built-in workflow-kit phase templates in a real enterprise-app governed run.\n\n## Verification Summary\n\nA full five-phase enterprise-app CLI E2E passed with template-backed workflow-kit phases.\n',
  );
}

describe('CLI subprocess E2E — workflow-kit phase-template runtime', () => {
  it('AT-WK-PHASE-RUNTIME-001: enterprise-app reuses built-in phase templates and completes the five-phase governed run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-wk-phase-runtime-'));

    try {
      const init = runCli(dir, ['init', '--governed', '--template', 'enterprise-app', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.combined);

      const config = readJson(dir, 'agentxchain.json');
      assert.equal(config.workflow_kit.phases.planning.template, 'planning-default');
      assert.equal(config.workflow_kit.phases.architecture.template, 'architecture-review');
      assert.equal(config.workflow_kit.phases.implementation.template, 'implementation-default');
      assert.equal(config.workflow_kit.phases.security_review.template, 'security-review');
      assert.equal(config.workflow_kit.phases.qa.template, 'qa-default');
      assert.equal(config.workflow_kit.phases.architecture.artifacts[0].owned_by, 'architect');
      assert.equal(config.workflow_kit.phases.security_review.artifacts[0].owned_by, 'security_reviewer');

      fillPlanningArtifacts(dir);

      const resumePlanning = runCli(dir, ['resume']);
      assert.equal(resumePlanning.status, 0, resumePlanning.combined);
      let state = readState(dir);
      assert.equal(state.phase, 'planning');
      assert.equal(state.current_turn.assigned_role, 'pm');

      writeTurnResult(dir, state, {
        role: 'pm',
        runtime_id: 'manual-pm',
        summary: 'Planning complete. Ready for architecture review.',
        proposed_next_role: 'human',
        phase_transition_request: 'architecture',
      });

      const acceptPlanning = runCli(dir, ['accept-turn']);
      assert.equal(acceptPlanning.status, 0, acceptPlanning.combined);
      state = readState(dir);
      assert.equal(state.status, 'paused');
      assert.equal(state.pending_phase_transition.to, 'architecture');

      const approvePlanning = runCli(dir, ['approve-transition']);
      assert.equal(approvePlanning.status, 0, approvePlanning.combined);
      state = readState(dir);
      assert.equal(state.phase, 'architecture');
      assert.equal(state.status, 'active');

      const resumeArchitecture = runCli(dir, ['resume']);
      assert.equal(resumeArchitecture.status, 0, resumeArchitecture.combined);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'architect');
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
      assert.equal(state.status, 'active');
      assert.equal(state.phase_gate_status.architecture_review, 'passed');

      const resumeImplementation = runCli(dir, ['resume']);
      assert.equal(resumeImplementation.status, 0, resumeImplementation.combined);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'dev');
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
      assert.equal(state.status, 'active');
      assert.equal(state.phase_gate_status.implementation_complete, 'passed');

      const resumeSecurity = runCli(dir, ['resume']);
      assert.equal(resumeSecurity.status, 0, resumeSecurity.combined);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'security_reviewer');
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
      assert.equal(state.status, 'active');
      assert.equal(state.phase_gate_status.security_review_signoff, 'passed');

      const resumeQa = runCli(dir, ['resume']);
      assert.equal(resumeQa.status, 0, resumeQa.combined);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'qa');
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
      assert.equal(state.pending_run_completion.gate, 'qa_ship_verdict');
      assert.equal(state.phase_gate_status.qa_ship_verdict, 'pending');

      const approveCompletion = runCli(dir, ['approve-completion']);
      assert.equal(approveCompletion.status, 0, approveCompletion.combined);
      state = readState(dir);
      assert.equal(state.status, 'completed');
      assert.equal(state.phase, 'qa');
      assert.equal(state.pending_run_completion, null);
      assert.equal(state.phase_gate_status.qa_ship_verdict, 'passed');

      const history = readJsonl(dir, HISTORY_PATH);
      assert.equal(history.length, 5);
      assert.deepEqual(
        history.map((entry) => entry.role),
        ['pm', 'architect', 'dev', 'security_reviewer', 'qa'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
