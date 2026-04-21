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

function readJsonl(dir, relPath) {
  const content = readFileSync(join(dir, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function writePlanningSignoff(dir) {
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
}

function markGateCredentialed(dir, gateId) {
  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gates[gateId] = {
    ...config.gates[gateId],
    credentialed: true,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function writeArchitectureArtifact(dir, note) {
  writeFileSync(
    join(dir, '.planning', 'ARCHITECTURE.md'),
    `# Architecture\n\n## Context\n\n${note}\n\n## Proposed Design\n\nCapture the architecture decision explicitly before implementation.\n\n## Trade-offs\n\nThis proves phase-level participation before gate exit.\n\n## Risks\n\nIf the wrong role authors this alone, the phase must not advance.\n`
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
        category: 'process',
        statement: 'Advance the enterprise-app workflow one governed turn at a time.',
        rationale: 'Charter enforcement must be proven against the real scaffold.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Keep role ownership explicit at gate time.',
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

describe('CLI subprocess E2E — enterprise-app charter enforcement', () => {
  it('AT-CHARTER-E2E-001: scaffolded enterprise-app roadmap survives into runtime charter enforcement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-enterprise-charter-'));

    try {
      const init = runCli(dir, ['init', '--governed', '--template', 'enterprise-app', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.stderr);
      markGateCredentialed(dir, 'planning_signoff');

      const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
      assert.match(roadmap, /\| Planning \|/);
      assert.match(roadmap, /\| Architecture \|/);
      assert.match(roadmap, /\| Implementation \|/);
      assert.match(roadmap, /\| Security Review \|/);
      assert.match(roadmap, /\| QA \|/);
      assert.match(roadmap, /Architecture \| Define the system boundary, integration contracts, and technical trade-offs before implementation commits to a design\./);
      assert.match(roadmap, /Security Review \| Challenge data handling, auth boundaries, and exploit paths before work proceeds to final QA\./);

      const systemSpec = readFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.match(systemSpec, /## Purpose/);
      assert.match(systemSpec, /## Interface/);
      assert.match(systemSpec, /## Acceptance Tests/);

      writePlanningSignoff(dir);

      const resumePlanning = runCli(dir, ['resume']);
      assert.equal(resumePlanning.status, 0, resumePlanning.stderr);
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
      assert.equal(acceptPlanning.status, 0, acceptPlanning.stderr);
      state = readState(dir);
      assert.equal(state.status, 'paused');
      assert.equal(state.pending_phase_transition.to, 'architecture');

      const approvePlanning = runCli(dir, ['approve-transition']);
      assert.equal(approvePlanning.status, 0, approvePlanning.stderr);
      state = readState(dir);
      assert.equal(state.phase, 'architecture');
      assert.equal(state.status, 'active');

      const assignDev = runCli(dir, ['resume', '--role', 'dev']);
      assert.equal(assignDev.status, 0, assignDev.stderr);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'dev');

      writeArchitectureArtifact(dir, 'Developer attempted to satisfy the architecture gate alone.');
      writeTurnResult(dir, state, {
        role: 'dev',
        runtime_id: 'local-dev',
        summary: 'Developer drafted architecture and requested implementation.',
        files_changed: ['.planning/ARCHITECTURE.md'],
        artifacts_created: ['.planning/ARCHITECTURE.md'],
        artifact: { type: 'workspace', ref: null },
        proposed_next_role: 'dev',
        phase_transition_request: 'implementation',
      });

      const acceptDev = runCli(dir, ['accept-turn']);
      assert.equal(acceptDev.status, 0, acceptDev.stderr);
      state = readState(dir);
      assert.equal(state.phase, 'architecture', 'phase must stay blocked until architect participates');
      assert.equal(state.status, 'active');
      assert.ok(!state.pending_phase_transition, 'wrong-role turn must not create pending transition');
      assert.ok(!state.current_turn, 'accepted turn should clear the active assignment');
      assert.equal(
        state.phase_gate_status.architecture_review,
        'failed',
        'an evaluated architecture gate that rejects the wrong role must record failed, not pending'
      );

      const historyAfterDev = readJsonl(dir, HISTORY_PATH);
      assert.equal(historyAfterDev.length, 2);
      assert.equal(historyAfterDev[1].role, 'dev');
      assert.equal(historyAfterDev[1].phase_transition_request, 'implementation');

      const assignArchitect = runCli(dir, ['resume', '--role', 'architect']);
      assert.equal(assignArchitect.status, 0, assignArchitect.stderr);
      state = readState(dir);
      assert.equal(state.current_turn.assigned_role, 'architect');

      writeArchitectureArtifact(dir, 'Architect reviewed and accepted the architecture contract.');
      writeTurnResult(dir, state, {
        role: 'architect',
        runtime_id: 'manual-architect',
        summary: 'Architecture review complete. Ready for implementation.',
        files_changed: ['.planning/ARCHITECTURE.md'],
        artifacts_created: ['.planning/ARCHITECTURE.md'],
        proposed_next_role: 'dev',
        phase_transition_request: 'implementation',
      });

      const acceptArchitect = runCli(dir, ['accept-turn']);
      assert.equal(acceptArchitect.status, 0, acceptArchitect.stderr);
      state = readState(dir);
      assert.equal(state.phase, 'implementation');
      assert.equal(state.status, 'active');
      assert.equal(state.phase_gate_status.architecture_review, 'passed');

      const historyAfterArchitect = readJsonl(dir, HISTORY_PATH);
      assert.equal(historyAfterArchitect.length, 3);
      assert.equal(historyAfterArchitect[2].role, 'architect');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
