import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeGovernedStateShape, getActiveTurn } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const STAGING_PATH = '.agentxchain/staging/turn-result.json';
const CONFIG_PATH = 'agentxchain.json';
const STATE_PATH = '.agentxchain/state.json';

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
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

function updateScaffoldToCustomPhases(dir) {
  const config = readJson(dir, CONFIG_PATH);
  config.roles.architect = {
    title: 'Architect',
    mandate: 'Challenge the plan and define the system design.',
    write_authority: 'review_only',
    runtime: 'manual-architect',
  };
  config.runtimes['manual-architect'] = { type: 'manual' };
  config.prompts.architect = '.agentxchain/prompts/architect.md';
  config.routing = {
    planning: {
      entry_role: 'pm',
      allowed_next_roles: ['pm', 'architect', 'eng_director', 'human'],
      exit_gate: 'planning_signoff',
    },
    design: {
      entry_role: 'architect',
      allowed_next_roles: ['architect', 'dev', 'eng_director', 'human'],
      exit_gate: 'design_review',
    },
    implementation: config.routing.implementation,
    qa: config.routing.qa,
  };
  config.gates.design_review = {
    requires_files: ['.planning/DESIGN_REVIEW.md'],
  };
  writeFileSync(join(dir, CONFIG_PATH), JSON.stringify(config, null, 2) + '\n');

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  writeFileSync(
    join(dir, '.agentxchain', 'prompts', 'architect.md'),
    '# Architect\n\nChallenge the plan, define the design, and keep the interfaces coherent.\n'
  );
}

function writePlanningArtifacts(dir) {
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Slice\n\n- [ ] Design the governed custom phase flow.\n');
  writeFileSync(
    join(dir, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nProve custom phases work at runtime.\n\n## Interface\n\n- planning -> design -> implementation -> qa\n\n## Acceptance Tests\n\n- [ ] Planning can advance only to design.\n- [ ] Design can advance to implementation.\n'
  );
}

function writeDesignReview(dir) {
  writeFileSync(
    join(dir, '.planning', 'DESIGN_REVIEW.md'),
    '# Design Review\n\n## Summary\n\nArchitecture reviewed and approved for implementation handoff.\n'
  );
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
        category: 'architecture',
        statement: 'Advance the governed workflow in declared order.',
        rationale: 'Custom phases must be ordered protocol steps, not optional labels.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Document the custom phase boundary explicitly.',
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

  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, STAGING_PATH), JSON.stringify(base, null, 2) + '\n');
}

describe('CLI subprocess E2E — custom phases runtime', () => {
  it('AT-CP-003: advances from custom design phase to implementation in declared order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-custom-phase-'));

    try {
      const init = runCli(dir, ['init', '--governed', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.stderr);

      updateScaffoldToCustomPhases(dir);
      writePlanningArtifacts(dir);

      const resumePlanning = runCli(dir, ['resume']);
      assert.equal(resumePlanning.status, 0, resumePlanning.stderr);
      let state = readState(dir);
      assert.equal(state.phase, 'planning');
      assert.equal(state.current_turn.assigned_role, 'pm');

      writeTurnResult(dir, state, {
        role: 'pm',
        runtime_id: 'manual-pm',
        summary: 'Planning complete. Ready for architecture review.',
        decisions: [
          {
            id: 'DEC-001',
            category: 'scope',
            statement: 'Insert a dedicated design phase before implementation.',
            rationale: 'The architecture needs explicit review before code starts.',
          },
        ],
        proposed_next_role: 'human',
        phase_transition_request: 'design',
      });

      const acceptPlanning = runCli(dir, ['accept-turn']);
      assert.equal(acceptPlanning.status, 0, acceptPlanning.stderr);
      state = readState(dir);
      assert.equal(state.status, 'paused');
      assert.equal(state.pending_phase_transition.to, 'design');

      const approvePlanning = runCli(dir, ['approve-transition']);
      assert.equal(approvePlanning.status, 0, approvePlanning.stderr);
      state = readState(dir);
      assert.equal(state.phase, 'design');
      assert.equal(state.status, 'active');

      const resumeDesign = runCli(dir, ['resume']);
      assert.equal(resumeDesign.status, 0, resumeDesign.stderr);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'architect');

      const prompt = readFileSync(
        join(dir, '.agentxchain', 'dispatch', 'turns', state.current_turn.turn_id, 'PROMPT.md'),
        'utf8'
      );
      assert.match(prompt, /Valid phases:.*planning.*design.*implementation.*qa/i);
      assert.match(prompt, /\*\*Phase:\*\* design/);
      assert.match(prompt, /phase_transition_request/);

      writeDesignReview(dir);
      writeTurnResult(dir, state, {
        role: 'architect',
        runtime_id: 'manual-architect',
        summary: 'Design review complete. Ready for implementation.',
        decisions: [
          {
            id: 'DEC-002',
            category: 'architecture',
            statement: 'Approve the design handoff to implementation.',
            rationale: 'Required interfaces and constraints are now explicit.',
          },
        ],
        proposed_next_role: 'dev',
        phase_transition_request: 'implementation',
      });

      const acceptDesign = runCli(dir, ['accept-turn']);
      assert.equal(acceptDesign.status, 0, acceptDesign.stderr);
      state = readState(dir);
      assert.equal(state.phase, 'implementation');
      assert.equal(state.status, 'active');
      assert.ok(!state.current_turn);
      assert.ok(!state.pending_phase_transition);
      assert.equal(state.phase_gate_status.design_review, 'passed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CP-004: rejects a CLI turn result that skips the declared design phase', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-custom-phase-skip-'));

    try {
      const init = runCli(dir, ['init', '--governed', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.stderr);

      updateScaffoldToCustomPhases(dir);
      writePlanningArtifacts(dir);

      const resumePlanning = runCli(dir, ['resume']);
      assert.equal(resumePlanning.status, 0, resumePlanning.stderr);
      const state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'pm');

      writeTurnResult(dir, state, {
        role: 'pm',
        runtime_id: 'manual-pm',
        summary: 'Attempted to skip design and go straight to implementation.',
        proposed_next_role: 'human',
        phase_transition_request: 'implementation',
      });

      const acceptPlanning = runCli(dir, ['accept-turn']);
      assert.notEqual(acceptPlanning.status, 0);
      assert.match(acceptPlanning.stdout, /Validation failed at stage protocol/);
      assert.match(acceptPlanning.stdout, /next phase is "design"/);

      const after = readState(dir);
      assert.equal(after.phase, 'planning');
      assert.equal(after.status, 'active');
      assert.equal(after.current_turn.assigned_role, 'pm');
      assert.ok(!after.pending_phase_transition);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
