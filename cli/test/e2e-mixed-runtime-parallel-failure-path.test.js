/**
 * E2E — Mixed-Runtime Parallel Failure-Path Proof
 *
 * Proves that when two parallel turns with different runtime types
 * (local_cli + api_proxy) execute in implementation and the queued
 * phase-transition gate FAILS at drain time, the governed state machine:
 *
 *   1. Persists gate failure durably as `last_gate_failure`
 *   2. Appends a `gate_failure` ledger entry
 *   3. Clears the queued transition without advancing
 *   4. Does not lose the successful turn's acceptance
 *   5. Surfaces the failure via `status --json` and `report --format json`
 *   6. Allows recovery via a subsequent turn
 *
 * Spec: .planning/MIXED_RUNTIME_PARALLEL_FAILURE_PATH_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assignGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
} from '../src/lib/governed-state.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function git(cwd, command) {
  execSync(command, { cwd, stdio: 'ignore' });
}

function initGitRepo(cwd, message) {
  git(cwd, 'git init');
  git(cwd, 'git config user.email "test@example.com"');
  git(cwd, 'git config user.name "Test User"');
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}"`);
}

function commitAll(cwd, message) {
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}" --allow-empty`);
}

function readState(cwd) {
  const raw = JSON.parse(readFileSync(join(cwd, '.agentxchain', 'state.json'), 'utf8'));
  const normalized = normalizeGovernedStateShape(raw).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(normalized);
    },
  });
  return normalized;
}

function readJsonl(cwd, relPath) {
  const raw = readFileSync(join(cwd, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readNormalizedConfig(cwd) {
  const raw = JSON.parse(readFileSync(join(cwd, 'agentxchain.json'), 'utf8'));
  const loaded = loadNormalizedConfig(raw);
  assert.equal(loaded.ok, true, `loadNormalizedConfig failed: ${loaded.errors?.join(', ')}`);
  return loaded.normalized;
}

/**
 * Configure mixed-runtime parallel with approval policy.
 * Same shape as the happy-path test — dev (local_cli), integrator (api_proxy).
 * Key difference: implementation_complete gate does NOT have requires_human_approval
 * so the auto-approval path is attempted (and will fail due to bad gate predicates).
 */
function writeMixedRuntimeConfig(cwd) {
  const configPath = join(cwd, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  config.roles.pm.runtime = 'manual-pm';
  config.roles.dev.runtime = 'local-dev';
  config.roles.qa.runtime = 'manual-qa';
  config.roles.integrator = {
    title: 'Integration Engineer',
    mandate: 'Review integration-facing implementation work via API proxy runtime.',
    write_authority: 'proposed',
    runtime: 'proxy-integrator',
  };

  if (config.roles.eng_director) {
    config.roles.eng_director.runtime = 'manual-pm';
  }

  config.runtimes = {
    'manual-pm': { type: 'manual' },
    'local-dev': { type: 'local_cli' },
    'proxy-integrator': {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'ANTHROPIC_API_KEY',
    },
    'manual-qa': { type: 'manual' },
  };

  config.routing.implementation.max_concurrent_turns = 2;
  config.routing.implementation.allowed_next_roles = ['dev', 'integrator', 'qa', 'eng_director', 'human'];

  // Set requires_human_approval so that when the gate PASSES (recovery),
  // it routes through the approval policy for auto-approve. When the gate
  // FAILS (drain), this flag is irrelevant — gate_failed takes precedence.
  config.gates.implementation_complete.requires_human_approval = true;

  config.approval_policy = {
    phase_transitions: {
      default: 'require_human',
      rules: [
        {
          from_phase: 'planning',
          to_phase: 'implementation',
          action: 'auto_approve',
          when: { gate_passed: true },
        },
        {
          from_phase: 'implementation',
          to_phase: 'qa',
          action: 'auto_approve',
          when: {
            gate_passed: true,
            roles_participated: ['dev', 'integrator'],
          },
        },
      ],
    },
    run_completion: {
      action: 'auto_approve',
      when: {
        gate_passed: true,
        all_phases_visited: true,
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function stageTurnResult(cwd, turn, state, overrides = {}) {
  const result = {
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
        category: turn.assigned_role === 'qa' ? 'quality' : 'implementation',
        statement: `${turn.assigned_role} turn completed for failure-path proof.`,
        rationale: 'Mixed-runtime parallel failure-path proof.',
      },
    ],
    objections: turn.assigned_role === 'dev'
      ? []
      : [
          {
            id: 'OBJ-001',
            severity: 'low',
            statement: `${turn.assigned_role} review observation.`,
            status: 'raised',
          },
        ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [],
    },
    artifact: { type: turn.assigned_role === 'qa' || turn.assigned_role === 'pm' ? 'review' : 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 200, usd: 0.01 },
    ...overrides,
  };

  const stagingDir = join(cwd, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2) + '\n');
}

function writePlanningArtifacts(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'PM_SIGNOFF.md'),
    '# PM Planning Sign-Off\n\nApproved: YES\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n- Planning: complete\n- Implementation: parallel mixed-runtime failure path\n- QA: pending\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nMixed-runtime parallel failure-path proof.\n\n## Interface\n\nN/A — governance proof only.\n\n## Behavior\n\nParallel implementation with gate failure at drain time.\n\n## Error Cases\n\nGate fails due to malformed IMPLEMENTATION_NOTES.md.\n\n## Acceptance Tests\n\nSee MIXED_RUNTIME_PARALLEL_FAILURE_PATH_SPEC.md\n',
  );
}

/**
 * Write a MALFORMED implementation notes file — missing ## Verification section.
 * This will cause the `implementation_complete` gate semantic validation to fail.
 */
function writeMalformedImplementationNotes(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n- Added governed application artifact via local_cli runtime.\n',
    // NOTE: deliberately missing ## Verification section
  );
}

/**
 * Write VALID implementation notes with both required sections.
 */
function writeValidImplementationNotes(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n- Added governed application artifact via local_cli runtime.\n- Fixed malformed notes from prior turn.\n\n## Verification\n- `node -e "import(\'./app.js\').then(m => console.log(m.hello()))"` -> "governed"\n',
  );
}

function writeIntegrationReviewArtifact(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'INTEGRATION_REVIEW.md'),
    '# Integration Review\n\n## Findings\n\n- Application artifact is well-structured.\n- Integration paths are clean.\n- Delivered via api_proxy runtime.\n',
  );
}

async function waitFor(check, timeoutMs = 10000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

function spawnStep(cwd, args = []) {
  const child = spawn(process.execPath, [CLI_BIN, 'step', '--poll', '1', ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  return {
    child,
    async waitForExit() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`step timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 15000);
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, combined: `${stdout}${stderr}` });
        });
      });
    },
  };
}

describe('E2E — Mixed-runtime parallel failure-path proof', () => {
  it('AT-MRFP-001..011: gate failure at drain persists context and allows recovery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentxchain-mixed-runtime-fail-'));
    const projectDir = join(root, 'failure-path-governed');

    try {
      mkdirSync(projectDir, { recursive: true });

      // --- Scaffold ---
      const init = runCli(projectDir, ['init', '--governed', '--template', 'cli-tool', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.combined);

      initGitRepo(projectDir, 'initial governed scaffold');
      writeMixedRuntimeConfig(projectDir);
      commitAll(projectDir, 'configure mixed-runtime parallel failure-path fixture');

      // --- Planning phase (manual PM) ---
      const planningStep = spawnStep(projectDir);
      const planningState = await waitFor(() => {
        const state = readState(projectDir);
        return state.current_turn?.assigned_role === 'pm' ? state : null;
      });
      const planningTurn = planningState.current_turn;

      writePlanningArtifacts(projectDir);
      stageTurnResult(projectDir, planningTurn, planningState, {
        role: 'pm',
        runtime_id: 'manual-pm',
        summary: 'Planning complete; advance to implementation.',
        phase_transition_request: 'implementation',
      });
      const planningExit = await planningStep.waitForExit();
      assert.equal(planningExit.code, 0, planningExit.combined);

      // AT-MRFP-001: Planning auto-advances via approval policy
      let state = readState(projectDir);
      assert.equal(state.phase, 'implementation', 'AT-MRFP-001: planning should auto-advance to implementation');
      assert.equal(state.status, 'active');

      commitAll(projectDir, 'complete planning turn');

      // --- Implementation phase (parallel, mixed-runtime) ---
      const implConfig = readNormalizedConfig(projectDir);

      // AT-MRFP-002: Assign dev (local_cli) and integrator (api_proxy) concurrently
      const devAssign = assignGovernedTurn(projectDir, implConfig, 'dev');
      assert.equal(devAssign.ok, true, devAssign.error);

      const integratorAssign = assignGovernedTurn(projectDir, implConfig, 'integrator');
      assert.equal(integratorAssign.ok, true, integratorAssign.error);

      const parallelState = integratorAssign.state;
      const activeTurns = parallelState.active_turns;
      const devTurn = Object.values(activeTurns).find((t) => t.assigned_role === 'dev');
      const integratorTurn = Object.values(activeTurns).find((t) => t.assigned_role === 'integrator');

      assert.ok(devTurn, 'AT-MRFP-002: dev turn must exist');
      assert.ok(integratorTurn, 'AT-MRFP-002: integrator turn must exist');
      assert.equal(devTurn.runtime_id, 'local-dev', 'AT-MRFP-002: dev must use local_cli runtime');
      assert.equal(integratorTurn.runtime_id, 'proxy-integrator', 'AT-MRFP-002: integrator must use api_proxy runtime');

      // Write dispatch bundles
      const devBundle = writeDispatchBundle(projectDir, parallelState, implConfig, { turnId: devTurn.turn_id });
      const integratorBundle = writeDispatchBundle(projectDir, parallelState, implConfig, { turnId: integratorTurn.turn_id });
      assert.equal(devBundle.ok, true, devBundle.error);
      assert.equal(integratorBundle.ok, true, integratorBundle.error);

      // Dev writes MALFORMED implementation notes (missing ## Verification)
      // and requests phase transition to QA
      writeMalformedImplementationNotes(projectDir);
      writeFileSync(
        join(projectDir, 'app.js'),
        '// Mixed-runtime proof application artifact\nexport function hello() { return "governed"; }\n',
      );
      stageTurnResult(projectDir, devTurn, parallelState, {
        role: 'dev',
        runtime_id: 'local-dev',
        summary: 'Implemented artifact (notes incomplete).',
        files_changed: ['app.js', '.planning/IMPLEMENTATION_NOTES.md'],
        artifacts_created: ['app.js'],
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
      });

      // Accept dev turn first — transition should be QUEUED (integrator still active)
      const acceptDev = runCli(projectDir, ['accept-turn', '--turn', devTurn.turn_id]);
      assert.equal(acceptDev.status, 0, acceptDev.combined);

      // AT-MRFP-003: First acceptance queues transition
      state = readState(projectDir);
      assert.equal(state.phase, 'implementation', 'AT-MRFP-003: phase must not advance yet');
      assert.equal(Object.keys(state.active_turns).length, 1, 'AT-MRFP-003: one parallel turn must remain');
      assert.equal(state.queued_phase_transition?.to, 'qa', 'AT-MRFP-003: phase transition must be queued to qa');
      assert.equal(state.queued_phase_transition?.requested_by_turn, devTurn.turn_id, 'AT-MRFP-003: queued by dev turn');

      commitAll(projectDir, 'accept dev with malformed implementation notes');

      // Integrator produces review artifacts
      writeIntegrationReviewArtifact(projectDir);
      stageTurnResult(projectDir, integratorTurn, state, {
        role: 'integrator',
        runtime_id: 'proxy-integrator',
        summary: 'Integration review complete via api_proxy runtime.',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        proposed_changes: [
          {
            path: '.planning/INTEGRATION_REVIEW.md',
            action: 'create',
            content: '# Integration Review\n\nIntegration paths are clean.\n',
          },
        ],
        proposed_next_role: 'qa',
      });

      // Accept integrator turn — this drains the parallel phase.
      // Gate evaluation should FAIL because IMPLEMENTATION_NOTES.md is malformed.
      const acceptIntegrator = runCli(projectDir, ['accept-turn', '--turn', integratorTurn.turn_id]);
      assert.equal(acceptIntegrator.status, 0, acceptIntegrator.combined);

      // AT-MRFP-004: Drain-time gate failure persisted
      state = readState(projectDir);
      assert.ok(state.last_gate_failure, 'AT-MRFP-004: last_gate_failure must be persisted');
      assert.equal(state.last_gate_failure.gate_type, 'phase_transition', 'AT-MRFP-004: gate_type must be phase_transition');
      assert.equal(state.last_gate_failure.gate_id, 'implementation_complete', 'AT-MRFP-004: gate_id must be implementation_complete');
      assert.equal(state.last_gate_failure.queued_request, true, 'AT-MRFP-004: must be flagged as queued drain request');
      assert.equal(state.last_gate_failure.from_phase, 'implementation', 'AT-MRFP-004: from_phase');
      assert.equal(state.last_gate_failure.to_phase, 'qa', 'AT-MRFP-004: to_phase');
      assert.equal(state.last_gate_failure.requested_by_turn, devTurn.turn_id, 'AT-MRFP-004: requested_by_turn must be dev');
      assert.ok(state.last_gate_failure.reasons.length > 0, 'AT-MRFP-004: reasons must be non-empty');
      assert.ok(
        state.last_gate_failure.reasons.some((r) => r.includes('Verification') || r.includes('IMPLEMENTATION_NOTES')),
        'AT-MRFP-004: reasons must reference the semantic validation failure',
      );

      // AT-MRFP-005: Phase does not advance
      assert.equal(state.phase, 'implementation', 'AT-MRFP-005: phase must remain implementation');
      assert.equal(state.status, 'active', 'AT-MRFP-005: run must remain active');

      // AT-MRFP-006: Queued transition cleared
      assert.equal(state.queued_phase_transition, null, 'AT-MRFP-006: queued_phase_transition must be null');

      // AT-MRFP-007: Gate failure ledger entry
      const ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl');
      const gateFailureEntries = ledger.filter((e) => e.type === 'gate_failure');
      assert.ok(gateFailureEntries.length >= 1, 'AT-MRFP-007: at least one gate_failure ledger entry');
      const latestGateFailure = gateFailureEntries[gateFailureEntries.length - 1];
      assert.equal(latestGateFailure.gate_type, 'phase_transition', 'AT-MRFP-007: ledger gate_type');
      assert.equal(latestGateFailure.gate_id, 'implementation_complete', 'AT-MRFP-007: ledger gate_id');
      assert.equal(latestGateFailure.queued_request, true, 'AT-MRFP-007: ledger queued_request');
      assert.ok(latestGateFailure.reasons.length > 0, 'AT-MRFP-007: ledger reasons non-empty');

      // AT-MRFP-008: Status --json surfaces failure
      const statusResult = runCli(projectDir, ['status', '--json']);
      assert.equal(statusResult.status, 0, statusResult.combined);
      const statusJson = JSON.parse(statusResult.stdout);
      const statusFailure = statusJson.state?.last_gate_failure || statusJson.last_gate_failure;
      assert.ok(statusFailure, 'AT-MRFP-008: status --json must include last_gate_failure');
      assert.equal(statusFailure.gate_type, 'phase_transition', 'AT-MRFP-008: status gate_type');
      assert.equal(statusFailure.gate_id, 'implementation_complete', 'AT-MRFP-008: status gate_id');
      assert.equal(statusFailure.queued_request, true, 'AT-MRFP-008: status queued_request');

      // AT-MRFP-009: Report surfaces gate failure digest
      const exportPath = join(projectDir, 'governance-export.json');
      const exportResult = runCli(projectDir, ['export', '--output', exportPath]);
      assert.equal(exportResult.status, 0, exportResult.combined);

      const reportResult = runCli(projectDir, ['report', '--input', exportPath, '--format', 'json']);
      assert.equal(reportResult.status, 0, reportResult.combined);
      const report = JSON.parse(reportResult.stdout);
      const reportGateFailures = report.subject?.run?.gate_failures;
      assert.ok(Array.isArray(reportGateFailures), 'AT-MRFP-009: report must have gate_failures array');
      assert.ok(reportGateFailures.length >= 1, 'AT-MRFP-009: at least one gate failure in report');
      const reportFailure = reportGateFailures.find((f) => f.gate_id === 'implementation_complete');
      assert.ok(reportFailure, 'AT-MRFP-009: report must include implementation_complete failure');
      assert.equal(reportFailure.gate_type, 'phase_transition', 'AT-MRFP-009: report gate_type');
      assert.equal(reportFailure.queued_request, true, 'AT-MRFP-009: report queued_request');

      // AT-MRFP-010: Successful sibling acceptance preserved
      const history = readJsonl(projectDir, '.agentxchain/history.jsonl');
      const devHistory = history.find((e) => e.role === 'dev');
      const integratorHistory = history.find((e) => e.role === 'integrator');
      assert.ok(devHistory, 'AT-MRFP-010: dev history entry must exist');
      assert.ok(integratorHistory, 'AT-MRFP-010: integrator history entry must exist');
      assert.equal(devHistory.runtime_id, 'local-dev', 'AT-MRFP-010: dev runtime_id preserved');
      assert.equal(integratorHistory.runtime_id, 'proxy-integrator', 'AT-MRFP-010: integrator runtime_id preserved');

      // Verify concurrent_with metadata is correct
      assert.ok(
        Array.isArray(integratorHistory.concurrent_with) && integratorHistory.concurrent_with.includes(devTurn.turn_id),
        'AT-MRFP-010: integrator must reference dev as concurrent',
      );

      commitAll(projectDir, 'gate failure persisted after drain');

      // --- AT-MRFP-011: Recovery — new turn fixes gate and advances ---
      const recoveryConfig = readNormalizedConfig(projectDir);
      const recoveryAssign = assignGovernedTurn(projectDir, recoveryConfig, 'dev');
      assert.equal(recoveryAssign.ok, true, recoveryAssign.error);
      const recoveryTurn = recoveryAssign.state.current_turn;

      // Write valid implementation notes (with both ## Changes and ## Verification)
      writeValidImplementationNotes(projectDir);
      stageTurnResult(projectDir, recoveryTurn, recoveryAssign.state, {
        role: 'dev',
        runtime_id: 'local-dev',
        summary: 'Fixed implementation notes; requesting phase transition.',
        files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
      });

      const acceptRecovery = runCli(projectDir, ['accept-turn', '--turn', recoveryTurn.turn_id]);
      assert.equal(acceptRecovery.status, 0, acceptRecovery.combined);

      // After recovery, the gate should pass and phase should advance
      // (approval policy: implementation→qa auto-approves when gate_passed + roles_participated)
      state = readState(projectDir);
      assert.equal(state.phase, 'qa', 'AT-MRFP-011: phase must advance to qa after recovery');
      assert.equal(state.last_gate_failure, null, 'AT-MRFP-011: last_gate_failure must be cleared after success');
      assert.equal(state.status, 'active', 'AT-MRFP-011: run must remain active');

      // Verify the approval policy fired for the recovery advance
      const finalLedger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl');
      const approvalEntries = finalLedger.filter((e) => e.type === 'approval_policy');
      const implAdvance = approvalEntries.find(
        (e) => e.gate_type === 'phase_transition' && e.matched_rule?.from_phase === 'implementation',
      );
      assert.ok(implAdvance, 'AT-MRFP-011: approval policy must have fired for implementation→qa advance');

    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
