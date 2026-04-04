import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const { runLoop, DEFAULT_MAX_TURNS } = await import(join(cliRoot, 'src', 'lib', 'run-loop.js'));
const {
  loadState,
  initRun,
  getTurnStagingResultPath,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `run-loop-test-${randomBytes(4).toString('hex')}`,
      name: 'Run Loop Test',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Implement.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
    ...overrides,
  };
}

function scaffoldProject(root, config) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
    schema_version: '1.1',
    project_id: config.project.id,
    status: 'idle',
    phase: 'planning',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  }, null, 2));
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
}

function makeTurnResult(turn, state, { summary, proposedNextRole, phaseTransitionRequest = null, runCompletionRequest = null, filesChanged = [], artifactType = 'workspace' }) {
  return {
    schema_version: '1.0',
    run_id: state?.run_id || turn.run_id || 'unknown',
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `${turn.assigned_role} completed governed slice.`,
      rationale: 'Test.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: `Proof objection by ${turn.assigned_role}.`,
      status: 'raised',
    }],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'pass',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: artifactType, ref: null },
    proposed_next_role: proposedNextRole,
    phase_transition_request: phaseTransitionRequest,
    run_completion_request: runCompletionRequest,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function ensureFiles(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

function makeTempRoot() {
  const root = join(tmpdir(), `axc-runloop-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  return root;
}

// ── Standard 3-turn callbacks ────────────────────────────────────────────────

const ROLE_SEQUENCE = ['pm', 'dev', 'qa'];

function makeStandardCallbacks(root) {
  let turnIndex = 0;

  return {
    selectRole(state) {
      if (turnIndex >= ROLE_SEQUENCE.length) return null;
      return ROLE_SEQUENCE[turnIndex];
    },

    async dispatch(ctx) {
      const role = ctx.turn.assigned_role;
      turnIndex++;

      if (role === 'pm') {
        ensureFiles(root, {
          '.planning/PM_SIGNOFF.md': '# PM Signoff\nApproved.\n',
          '.planning/ROADMAP.md': '# Roadmap\nRunner proof.\n',
        });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'PM planned.',
            proposedNextRole: 'human',
            phaseTransitionRequest: 'implementation',
            filesChanged: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
            artifactType: 'review',
          }),
        };
      }

      if (role === 'dev') {
        ensureFiles(root, { 'src/output.js': 'export const ok = true;\n' });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'Dev implemented.',
            proposedNextRole: 'qa',
            phaseTransitionRequest: 'qa',
            filesChanged: ['src/output.js'],
          }),
        };
      }

      if (role === 'qa') {
        ensureFiles(root, {
          '.planning/acceptance-matrix.md': '# Acceptance\nAll passed.\n',
          '.planning/ship-verdict.md': '# Ship Verdict\nComplete.\n',
        });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'QA approved.',
            proposedNextRole: 'human',
            runCompletionRequest: true,
            filesChanged: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
            artifactType: 'review',
          }),
        };
      }

      return { accept: false, reason: `Unknown role: ${role}` };
    },

    async approveGate(gateType, state) {
      return true;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('run-loop', () => {

  // AT-RUNLOOP-010 + AT-RUNLOOP-012: Boundary purity
  describe('boundary purity', () => {
    let source;
    before(async () => {
      source = readFileSync(join(cliRoot, 'src', 'lib', 'run-loop.js'), 'utf8');
    });

    it('imports only from runner-interface.js for governed operations', () => {
      assert.ok(source.includes("from './runner-interface.js'"), 'must import from runner-interface.js');
      assert.ok(!source.includes("from './governed-state.js'"), 'must not import governed-state.js directly');
      assert.ok(!source.includes("from './turn-paths.js'"), 'must not import turn-paths.js directly');
      assert.ok(!source.includes("from './config.js'"), 'must not import config.js directly');
    });

    it('contains no process.exit', () => {
      assert.ok(!source.includes('process.exit'), 'must not call process.exit');
    });

    it('contains no console output', () => {
      assert.ok(!source.includes('console.log'), 'must not call console.log');
      assert.ok(!source.includes('console.error'), 'must not call console.error');
      assert.ok(!source.includes('console.warn'), 'must not call console.warn');
    });

    it('contains no child_process', () => {
      assert.ok(!source.includes('child_process'), 'must not import child_process');
    });

    it('exports DEFAULT_MAX_TURNS', () => {
      assert.equal(typeof DEFAULT_MAX_TURNS, 'number');
      assert.ok(DEFAULT_MAX_TURNS > 0);
    });
  });

  // AT-RUNLOOP-001 + AT-RUNLOOP-011: Full lifecycle to completed
  describe('full governed lifecycle', () => {
    let root, config, result;
    const events = [];

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);
      const cbs = makeStandardCallbacks(root);
      cbs.onEvent = (evt) => events.push(evt);
      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('returns ok: true', () => {
      assert.deepEqual(result.errors, [], `errors: ${JSON.stringify(result.errors)}`);
      assert.equal(result.ok, true);
    });

    it('stop_reason is completed', () => {
      assert.equal(result.stop_reason, 'completed');
    });

    it('executed 3 turns', () => {
      assert.equal(result.turns_executed, 3);
    });

    it('turn_history contains pm, dev, qa', () => {
      assert.deepEqual(result.turn_history.map(t => t.role), ['pm', 'dev', 'qa']);
      assert.ok(result.turn_history.every(t => t.accepted === true));
    });

    it('approved gates', () => {
      // planning_signoff (human) + qa_ship_verdict (human) = 2 gates
      // implementation_complete is auto-advance, not counted
      assert.equal(result.gates_approved, 2);
    });

    it('final state is completed', () => {
      assert.equal(result.state.status, 'completed');
    });

    it('no errors', () => {
      assert.equal(result.errors.length, 0);
    });
  });

  // AT-RUNLOOP-009: onEvent lifecycle events
  describe('onEvent emissions', () => {
    let root, config, events;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);
      events = [];
      const cbs = makeStandardCallbacks(root);
      cbs.onEvent = (evt) => events.push(evt);
      await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('emits turn_assigned for each turn', () => {
      const assigned = events.filter(e => e.type === 'turn_assigned');
      assert.equal(assigned.length, 3);
    });

    it('emits turn_accepted for each turn', () => {
      const accepted = events.filter(e => e.type === 'turn_accepted');
      assert.equal(accepted.length, 3);
    });

    it('emits gate_paused and gate_approved for human gates', () => {
      const paused = events.filter(e => e.type === 'gate_paused');
      const approved = events.filter(e => e.type === 'gate_approved');
      assert.ok(paused.length >= 2, 'at least 2 gate pauses');
      assert.ok(approved.length >= 2, 'at least 2 gate approvals');
    });

    it('emits completed', () => {
      const completed = events.filter(e => e.type === 'completed');
      assert.equal(completed.length, 1);
    });
  });

  describe('onEvent callback failures are advisory', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);
      const cbs = makeStandardCallbacks(root);
      cbs.onEvent = () => {
        throw new Error('observer failed');
      };
      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('still completes the governed lifecycle', () => {
      assert.equal(result.ok, true);
      assert.equal(result.stop_reason, 'completed');
      assert.equal(result.turns_executed, 3);
    });

    it('records observer errors instead of throwing', () => {
      assert.ok(
        result.errors.some((entry) => entry.includes('onEvent threw')),
        'runLoop must record onEvent callback failures',
      );
    });
  });

  // AT-RUNLOOP-002: gate_held on phase transition
  describe('gate_held on phase transition', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);
      let turnIndex = 0;

      const cbs = {
        selectRole() { return 'pm'; },
        async dispatch(ctx) {
          ensureFiles(root, {
            '.planning/PM_SIGNOFF.md': '# PM Signoff\nApproved.\n',
            '.planning/ROADMAP.md': '# Roadmap\nTest.\n',
          });
          return {
            accept: true,
            turnResult: makeTurnResult(ctx.turn, ctx.state, {
              summary: 'PM planned.',
              proposedNextRole: 'human',
              phaseTransitionRequest: 'implementation',
              filesChanged: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
              artifactType: 'review',
            }),
          };
        },
        async approveGate(gateType, state) {
          return false; // hold the gate
        },
      };

      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('returns ok: false', () => {
      assert.equal(result.ok, false);
    });

    it('stop_reason is gate_held', () => {
      assert.equal(result.stop_reason, 'gate_held');
    });

    it('executed 1 turn before gate', () => {
      assert.equal(result.turns_executed, 1);
    });
  });

  // AT-RUNLOOP-003: caller_stopped
  describe('caller_stopped', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);

      const cbs = {
        selectRole() { return null; },
        async dispatch() { return { accept: false, reason: 'should not be called' }; },
        async approveGate() { return true; },
      };

      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('returns ok: false with caller_stopped', () => {
      assert.equal(result.ok, false);
      assert.equal(result.stop_reason, 'caller_stopped');
    });

    it('executed 0 turns', () => {
      assert.equal(result.turns_executed, 0);
    });
  });

  // AT-RUNLOOP-004: max_turns_reached
  describe('max_turns_reached', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);

      // Keep assigning PM in planning until max_turns hit
      const cbs = {
        selectRole() { return 'pm'; },
        async dispatch(ctx) {
          return {
            accept: true,
            turnResult: makeTurnResult(ctx.turn, ctx.state, {
              summary: 'PM turn.',
              proposedNextRole: 'pm',
              artifactType: 'review',
            }),
          };
        },
        async approveGate() { return true; },
      };

      result = await runLoop(root, config, cbs, { maxTurns: 2 });
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('stop_reason is max_turns_reached', () => {
      assert.equal(result.stop_reason, 'max_turns_reached');
    });

    it('executed exactly maxTurns turns', () => {
      assert.equal(result.turns_executed, 2);
    });
  });

  // AT-RUNLOOP-006: rejection and retry
  describe('rejection and retry', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);

      let pmAttempts = 0;

      const cbs = {
        selectRole(state) {
          if (state.phase === 'planning') return 'pm';
          return null;
        },
        async dispatch(ctx) {
          if (ctx.turn.assigned_role === 'pm') {
            pmAttempts++;
            if (pmAttempts === 1) {
              // First attempt: reject
              return { accept: false, reason: 'Needs better planning artifacts' };
            }
            // Second attempt: accept
            ensureFiles(root, {
              '.planning/PM_SIGNOFF.md': '# PM Signoff\nApproved.\n',
              '.planning/ROADMAP.md': '# Roadmap\nRetried.\n',
            });
            return {
              accept: true,
              turnResult: makeTurnResult(ctx.turn, ctx.state, {
                summary: 'PM planned on retry.',
                proposedNextRole: 'human',
                phaseTransitionRequest: 'implementation',
                filesChanged: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
                artifactType: 'review',
              }),
            };
          }
          return { accept: false, reason: 'unexpected' };
        },
        async approveGate() { return false; }, // hold after PM
      };

      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('executed 1 accepted turn after a rejection', () => {
      assert.equal(result.turns_executed, 1);
    });

    it('turn_history shows rejection then acceptance', () => {
      assert.equal(result.turn_history.length, 2);
      assert.equal(result.turn_history[0].accepted, false);
      assert.equal(result.turn_history[1].accepted, true);
    });

    it('stopped at gate_held after acceptance', () => {
      assert.equal(result.stop_reason, 'gate_held');
    });
  });

  // AT-RUNLOOP-005: blocked state
  describe('dispatch callback error', () => {
    let root, config, result;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig();
      scaffoldProject(root, config);

      const cbs = {
        selectRole() { return 'pm'; },
        async dispatch() { throw new Error('Adapter exploded'); },
        async approveGate() { return true; },
      };

      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('returns dispatch_error', () => {
      assert.equal(result.stop_reason, 'dispatch_error');
      assert.equal(result.ok, false);
    });

    it('records the error', () => {
      assert.ok(result.errors.some(e => e.includes('Adapter exploded')));
    });
  });

  // AT-RUNLOOP-008: auto-advancing phase gates
  describe('auto-advancing phase gates', () => {
    let root, config, result, gateCallCount;

    before(async () => {
      root = makeTempRoot();
      config = makeConfig({
        gates: {
          planning_signoff: { requires_verification_pass: true }, // no human approval
          implementation_complete: { requires_verification_pass: true },
          qa_ship_verdict: {
            requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
            requires_human_approval: true,
          },
        },
      });
      scaffoldProject(root, config);
      gateCallCount = 0;

      const cbs = makeStandardCallbacks(root);
      const origApprove = cbs.approveGate;
      cbs.approveGate = async (gateType, state) => {
        gateCallCount++;
        return origApprove(gateType, state);
      };

      result = await runLoop(root, config, cbs);
    });

    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    it('completed successfully', () => {
      assert.equal(result.ok, true);
      assert.equal(result.stop_reason, 'completed');
    });

    it('only called approveGate for human-required gates', () => {
      // Only qa_ship_verdict requires human approval
      assert.equal(gateCallCount, 1);
    });
  });

});
