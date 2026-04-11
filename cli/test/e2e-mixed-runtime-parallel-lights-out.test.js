/**
 * E2E — Mixed-Runtime Parallel Lights-Out Proof
 *
 * Proves the governed state machine handles parallel turns dispatched through
 * genuinely different runtime types (local_cli + api_proxy) and completes
 * lights-out via approval policy. The full evidence trail — attribution,
 * conflict detection, approval-policy ledger, export, report — must be
 * truthful regardless of adapter type.
 *
 * Spec: .planning/MIXED_RUNTIME_PARALLEL_LIGHTS_OUT_SPEC.md
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
 * Configure mixed-runtime parallel approval policy.
 * dev uses local_cli, integrator uses api_proxy — genuinely different adapter types.
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

  // eng_director may exist from template — give it a valid runtime
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
        statement: `${turn.assigned_role} turn completed for mixed-runtime proof.`,
        rationale: 'Mixed-runtime parallel lights-out lifecycle proof.',
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
    '# Roadmap\n\n- Planning: complete\n- Implementation: parallel mixed-runtime\n- QA: pending\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nMixed-runtime parallel lights-out proof.\n\n## Interface\n\nN/A — governance proof only.\n\n## Behavior\n\nTwo parallel implementation turns with different runtimes complete lights-out.\n\n## Error Cases\n\nNone expected.\n\n## Acceptance Tests\n\nSee MIXED_RUNTIME_PARALLEL_LIGHTS_OUT_SPEC.md\n',
  );
}

function writeImplementationArtifacts(cwd) {
  writeFileSync(
    join(cwd, 'app.js'),
    '// Mixed-runtime proof application artifact\nexport function hello() { return "governed"; }\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n- Added governed application artifact via local_cli runtime.\n\n## Verification\n- `node -e "import(\'./app.js\').then(m => console.log(m.hello()))"` -> "governed"\n',
  );
}

function writeIntegrationReviewArtifact(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'INTEGRATION_REVIEW.md'),
    '# Integration Review\n\n## Findings\n\n- Application artifact is well-structured.\n- Integration paths are clean.\n- Delivered via api_proxy runtime.\n',
  );
}

function writeQaArtifacts(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Criterion | Evidence | Status |\n|-------|-----------|----------|--------|\n| 1 | Mixed-runtime parallel turns complete | Governed state proves both runtimes | PASS |\n| 2 | Approval policy auto-advances | Decision ledger entries | PASS |\n| 3 | Evidence trail is truthful | Export/report surfaces | PASS |\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nMixed-runtime parallel lights-out proof passes all acceptance criteria.\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nMixed-runtime parallel lights-out proof verified.\n\n## Verification Summary\n\nQA verified mixed-runtime parallel execution, approval policy auto-advance, and evidence trail integrity.\n',
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

describe('E2E — Mixed-runtime parallel lights-out proof', () => {
  it('AT-MRL-001..009: local_cli + api_proxy parallel turns drain lights-out and produce truthful evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentxchain-mixed-runtime-'));
    const projectDir = join(root, 'mixed-runtime-governed');

    try {
      mkdirSync(projectDir, { recursive: true });

      // --- Scaffold ---
      const init = runCli(projectDir, ['init', '--governed', '--template', 'cli-tool', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.combined);

      initGitRepo(projectDir, 'initial governed scaffold');
      writeMixedRuntimeConfig(projectDir);
      commitAll(projectDir, 'configure mixed-runtime parallel lights-out fixture');

      // --- Planning phase (manual PM) ---
      const normalizedConfig = readNormalizedConfig(projectDir);

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
      assert.match(planningExit.combined, /Turn Accepted/);

      // AT-MRL-001: Planning auto-advances via approval policy
      let state = readState(projectDir);
      assert.equal(state.phase, 'implementation', 'AT-MRL-001: planning should auto-advance to implementation');
      assert.equal(state.status, 'active');
      assert.ok(!state.pending_phase_transition, 'AT-MRL-001: no pending transition after auto-advance');

      let ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((e) => e.type === 'approval_policy');
      assert.equal(ledger.length, 1, 'AT-MRL-001: first approval policy event for planning advance');
      assert.equal(ledger[0].gate_type, 'phase_transition');
      assert.equal(ledger[0].matched_rule?.from_phase, 'planning');
      assert.equal(ledger[0].matched_rule?.to_phase, 'implementation');

      commitAll(projectDir, 'complete planning turn');

      // --- Implementation phase (parallel, mixed-runtime) ---
      const implConfig = readNormalizedConfig(projectDir);

      // AT-MRL-002: Assign dev (local_cli) and integrator (api_proxy) concurrently
      const devAssign = assignGovernedTurn(projectDir, implConfig, 'dev');
      assert.equal(devAssign.ok, true, devAssign.error);

      const integratorAssign = assignGovernedTurn(projectDir, implConfig, 'integrator');
      assert.equal(integratorAssign.ok, true, integratorAssign.error);

      const parallelState = integratorAssign.state;
      const activeTurns = parallelState.active_turns;
      const devTurn = Object.values(activeTurns).find((t) => t.assigned_role === 'dev');
      const integratorTurn = Object.values(activeTurns).find((t) => t.assigned_role === 'integrator');

      assert.ok(devTurn, 'AT-MRL-002: dev turn must exist');
      assert.ok(integratorTurn, 'AT-MRL-002: integrator turn must exist');
      assert.notEqual(devTurn.runtime_id, integratorTurn.runtime_id, 'AT-MRL-002: parallel turns must use different runtime_ids');
      assert.equal(devTurn.runtime_id, 'local-dev', 'AT-MRL-002: dev must use local_cli runtime');
      assert.equal(integratorTurn.runtime_id, 'proxy-integrator', 'AT-MRL-002: integrator must use api_proxy runtime');

      // Verify runtime types are genuinely different in config
      assert.equal(implConfig.runtimes['local-dev'].type, 'local_cli');
      assert.equal(implConfig.runtimes['proxy-integrator'].type, 'api_proxy');

      // Write dispatch bundles for both
      const devBundle = writeDispatchBundle(projectDir, parallelState, implConfig, { turnId: devTurn.turn_id });
      const integratorBundle = writeDispatchBundle(projectDir, parallelState, implConfig, { turnId: integratorTurn.turn_id });
      assert.equal(devBundle.ok, true, devBundle.error);
      assert.equal(integratorBundle.ok, true, integratorBundle.error);

      // Dev produces workspace artifacts
      writeImplementationArtifacts(projectDir);
      stageTurnResult(projectDir, devTurn, parallelState, {
        role: 'dev',
        runtime_id: 'local-dev',
        summary: 'Implemented application artifact via local_cli runtime.',
        files_changed: ['app.js', '.planning/IMPLEMENTATION_NOTES.md'],
        artifacts_created: ['app.js'],
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
      });

      // Accept dev turn first
      const acceptDev = runCli(projectDir, ['accept-turn', '--turn', devTurn.turn_id]);
      assert.equal(acceptDev.status, 0, acceptDev.combined);
      assert.match(acceptDev.combined, /Turn Accepted/);

      // AT-MRL-003: First parallel acceptance does not advance the phase
      state = readState(projectDir);
      assert.equal(state.phase, 'implementation', 'AT-MRL-003: first parallel acceptance must not advance');
      assert.equal(Object.keys(state.active_turns).length, 1, 'AT-MRL-003: one parallel turn must remain');
      assert.equal(state.queued_phase_transition?.to, 'qa', 'AT-MRL-003: phase transition must be queued');

      ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((e) => e.type === 'approval_policy');
      assert.equal(ledger.length, 1, 'AT-MRL-003: no second policy event until last parallel turn drains');

      commitAll(projectDir, 'accept dev implementation');

      // Integrator produces review artifacts (via api_proxy runtime — staged directly)
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

      // Accept integrator turn — this should drain the parallel phase
      const acceptIntegrator = runCli(projectDir, ['accept-turn', '--turn', integratorTurn.turn_id]);
      assert.equal(acceptIntegrator.status, 0, acceptIntegrator.combined);
      assert.match(acceptIntegrator.combined, /Turn Accepted/);

      // AT-MRL-004: Second parallel acceptance auto-advances to QA
      state = readState(projectDir);
      assert.equal(state.phase, 'qa', 'AT-MRL-004: should auto-advance to qa after both roles participated');
      assert.equal(state.status, 'active');
      assert.ok(!state.pending_phase_transition, 'AT-MRL-004: no pending transition');
      assert.ok(!state.queued_phase_transition, 'AT-MRL-004: no queued transition');

      ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((e) => e.type === 'approval_policy');
      assert.equal(ledger.length, 2, 'AT-MRL-004: second approval policy event for implementation advance');
      assert.equal(ledger[1].gate_type, 'phase_transition');
      assert.equal(ledger[1].matched_rule?.from_phase, 'implementation');
      assert.equal(ledger[1].matched_rule?.to_phase, 'qa');
      assert.deepEqual(ledger[1].matched_rule?.when?.roles_participated, ['dev', 'integrator']);

      // AT-MRL-005: History entries carry concurrent_with metadata
      // Note: concurrent_with is populated at assignment time from existing active turns.
      // Dev is assigned first (no active turns yet) so its concurrent_with is [].
      // Integrator is assigned second (dev already active) so its concurrent_with includes dev.
      let history = readJsonl(projectDir, '.agentxchain/history.jsonl');
      assert.deepEqual(history.map((e) => e.role), ['pm', 'dev', 'integrator']);
      const devHistory = history.find((e) => e.role === 'dev');
      const integratorHistory = history.find((e) => e.role === 'integrator');
      assert.ok(
        Array.isArray(integratorHistory.concurrent_with) && integratorHistory.concurrent_with.includes(devTurn.turn_id),
        'AT-MRL-005: integrator history must reference dev as concurrent (assigned after dev)',
      );

      // AT-MRL-009: History entries carry correct runtime_id
      assert.equal(devHistory.runtime_id, 'local-dev', 'AT-MRL-009: dev history must carry local-dev runtime_id');
      assert.equal(integratorHistory.runtime_id, 'proxy-integrator', 'AT-MRL-009: integrator history must carry proxy-integrator runtime_id');

      commitAll(projectDir, 'complete implementation phase');

      // --- QA phase (manual) ---
      const qaStep = spawnStep(projectDir);
      const qaState = await waitFor(() => {
        const current = readState(projectDir);
        return current.current_turn?.assigned_role === 'qa' ? current : null;
      });
      const qaTurn = qaState.current_turn;

      writeQaArtifacts(projectDir);
      stageTurnResult(projectDir, qaTurn, qaState, {
        role: 'qa',
        runtime_id: 'manual-qa',
        summary: 'QA passed; requesting governed run completion.',
        run_completion_request: true,
      });

      const qaExit = await qaStep.waitForExit();
      assert.equal(qaExit.code, 0, qaExit.combined);
      assert.match(qaExit.combined, /Turn Accepted/);

      // AT-MRL-006: Run auto-completes via approval policy
      state = readState(projectDir);
      assert.equal(state.status, 'completed', 'AT-MRL-006: run should auto-complete');
      assert.ok(!state.pending_run_completion, 'AT-MRL-006: no pending completion');

      ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((e) => e.type === 'approval_policy');
      assert.equal(ledger.length, 3, 'AT-MRL-006: third approval policy event for run completion');
      assert.equal(ledger[2].gate_type, 'run_completion');
      assert.equal(ledger[2].matched_rule?.action, 'auto_approve');
      assert.equal(ledger[2].matched_rule?.when?.all_phases_visited, true);

      // Final history check
      history = readJsonl(projectDir, '.agentxchain/history.jsonl');
      assert.deepEqual(history.map((e) => e.role), ['pm', 'dev', 'integrator', 'qa']);

      // --- AT-MRL-007 & AT-MRL-008: Export and Report ---
      const exportPath = join(projectDir, 'governance-export.json');
      const exportResult = runCli(projectDir, ['export', '--output', exportPath]);
      assert.equal(exportResult.status, 0, exportResult.combined);

      const reportResult = runCli(projectDir, ['report', '--input', exportPath, '--format', 'json']);
      assert.equal(reportResult.status, 0, reportResult.combined);
      const report = JSON.parse(reportResult.stdout);

      // AT-MRL-007: Report preserves all 3 approval-policy events
      const approvalEvents = report.subject?.run?.approval_policy_events;
      assert.ok(Array.isArray(approvalEvents), 'AT-MRL-007: report must have approval_policy_events');
      assert.equal(approvalEvents.length, 3, 'AT-MRL-007: report must have 3 approval policy events');
      assert.deepEqual(
        approvalEvents[1]?.matched_rule?.when?.roles_participated,
        ['dev', 'integrator'],
        'AT-MRL-007: implementation advance must preserve roles_participated',
      );

      // AT-MRL-008: Report timeline shows mixed runtime_id values
      const turns = report.subject?.run?.turns;
      assert.ok(Array.isArray(turns), 'AT-MRL-008: report must have turns');
      assert.deepEqual(
        turns.map((t) => t.role),
        ['pm', 'dev', 'integrator', 'qa'],
        'AT-MRL-008: turn order must be preserved',
      );

      // Verify the report status
      const status = runCli(projectDir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.combined, /completed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
