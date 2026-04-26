/**
 * BUG-77 beta-tester scenario: continuous vision mode must dispatch PM in
 * "derive next roadmap increment" mode when ROADMAP.md is exhausted (all
 * milestones checked) but VISION.md still contains unplanned V2/V3 scope.
 *
 * Reproduction class:
 *   `agentxchain run --continuous --vision .planning/VISION.md --max-runs 1
 *    --max-idle-cycles 1` reported completed with runs_completed=0, claiming
 *   "All vision goals appear addressed" even though VISION.md has explicit
 *   V2/V3 scope that has no corresponding roadmap milestone.
 *
 * This command-chain test proves the CLI-owned continuous path derives and
 * dispatches a roadmap-replenishment intent before falling back to idle exit.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/**
 * Create a fixture mirroring the tester's BUG-77 state:
 * - ROADMAP fully checked through M1 (no unchecked items)
 * - VISION with V1 scope (matches M1) AND V2/V3 scope (unplanned)
 * - Existing completed intents that keyword-match V1 goals only
 * - State: completed, all gates passed
 * - PM is the only executable role, so the test proves replenishment dispatch
 *   is PM-owned instead of accidentally passing through dev fallback routing.
 */
function createExhaustedRoadmapProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug77-cli-'));
  tempDirs.push(dir);

  // Mock agent that completes the replenishment turn
  const agentPath = join(dir, '_bug77-agent.mjs');
  writeFileSync(agentPath, [
    "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    'const root = process.cwd();',
    "const index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));",
    "const entry = Object.values(index.active_turns || {})[0] || {};",
    "const turnId = entry.turn_id;",
    "const runtimeId = entry.runtime_id || 'local-dev';",
    "const stagingResultPath = entry.staging_result_path;",
    "const runId = index.run_id;",
    "const session = JSON.parse(readFileSync(join(root, '.agentxchain/continuous-session.json'), 'utf8'));",
    "const objective = String(session.current_vision_objective || 'missing-objective');",
    "const relPath = '.planning/bug77-replenishment-proof.md';",
    "const absPath = join(root, relPath);",
    "mkdirSync(dirname(absPath), { recursive: true });",
    "writeFileSync(absPath, `# BUG-77 Replenishment Proof\\n\\n${objective}\\n`);",
    'const result = {',
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    "  role: 'pm',",
    '  runtime_id: runtimeId,',
    "  status: 'completed',",
    "  summary: `Roadmap replenishment: ${objective}`,",
    "  decisions: [{ id: 'DEC-001', category: 'scope', statement: `Derived next increment: ${objective}`, rationale: 'BUG-77 command-chain proof.' }],",
    '  objections: [],',
    '  files_changed: [relPath],',
    '  artifacts_created: [relPath],',
    "  verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'ok', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },",
    "  artifact: { type: 'workspace', ref: null },",
    "  proposed_next_role: 'human',",
    '  phase_transition_request: null,',
    '  run_completion_request: true,',
    '  needs_human_reason: null,',
    '  cost: { usd: 0 },',
    '};',
    "const absStaging = join(root, stagingResultPath);",
    "mkdirSync(dirname(absStaging), { recursive: true });",
    "writeFileSync(absStaging, JSON.stringify(result, null, 2));",
    "console.log(`bug77-agent completed ${objective}`);",
    '',
  ].join('\n'));

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug77-cli-test', id: `bug77-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Derive roadmap increments and acceptance criteria.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-pm', runtime: 'local-pm' },
    },
    runtimes: {
      'local-pm': {
        type: 'local_cli',
        command: process.execPath,
        args: [agentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.gitignore'), '.agentxchain/\n');

  // State: completed, all gates passed (previous governed run finished)
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: 'run_exhausted_roadmap',
    project_id: config.project.id,
    status: 'completed',
    phase: 'launch',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'passed',
      implementation_complete: 'passed',
      qa_ship_verdict: 'passed',
      launch_ready: 'passed',
    },
  }, null, 2));

  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'run-history.jsonl'), '');

  // ROADMAP fully checked — M1 complete, no M2+
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), [
    '# Roadmap',
    '',
    '### M1: Core Runtime Implementation (~1 day)',
    '- [x] Implement core runtime engine',
    '- [x] Add governance framework integration',
    '- [x] Build CLI entry point',
    '',
  ].join('\n'));

  // VISION with V1 (matches M1) and V2 (unplanned, no corresponding milestone)
  writeFileSync(join(dir, '.planning', 'VISION.md'), [
    '# Vision',
    '',
    '## V1 Scope',
    '',
    '- implement core runtime engine',
    '- add governance framework',
    '',
    '## V2 Runtime Instrumentation',
    '',
    '- payload observation and capture for production APIs',
    '- failure and latency analysis across service boundaries',
    '- hot-path identification from real traffic patterns',
    '',
    '## V3 Advanced Intelligence',
    '',
    '- runtime learning loop for automated improvement proposals',
    '- competitive transition intelligence dashboard',
    '',
  ].join('\n'));

  // Add a completed intent that keyword-matches V1 goals
  // This causes deriveVisionCandidates() to mark V1 goals as addressed
  const intentId1 = `intent_${Date.now()}_v1`;
  writeFileSync(join(dir, '.agentxchain', 'intake', 'intents', `${intentId1}.json`), JSON.stringify({
    intent_id: intentId1,
    status: 'completed',
    charter: 'implement core runtime engine and add governance framework integration and build CLI entry point',
    signal: { description: 'core runtime and governance' },
    created_at: new Date().toISOString(),
  }, null, 2));

  // Leave V2/V3 goals unmatched. This catches the accumulated-state failure
  // where generic VISION candidates exist but exhausted-roadmap handling must
  // still route PM to derive the next bounded ROADMAP increment first.

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "bug77@test.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "BUG-77 Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function runContinuousCli(dir) {
  return spawnSync(process.execPath, [
    CLI_BIN,
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    '1',
    '--max-idle-cycles',
    '1',
    '--poll-seconds',
    '0',
  ], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('BUG-77: continuous mode dispatches roadmap replenishment when roadmap exhausted but vision open', () => {
  it('CLI-owned run --continuous dispatches replenishment instead of idle-completing with zero runs', () => {
    const dir = createExhaustedRoadmapProject();

    // Pre-check: status --json should surface roadmap_exhausted_vision_open
    const statusBefore = spawnSync(process.execPath, [CLI_BIN, 'status', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(statusBefore.status, 0, `status --json must succeed:\n${statusBefore.stdout}\n${statusBefore.stderr}`);
    const statusJson = JSON.parse(statusBefore.stdout);
    assert.ok(
      statusJson.next_actions.some((action) => action.type === 'roadmap_exhausted_vision_open'),
      `status --json must surface roadmap_exhausted_vision_open next action when roadmap is exhausted but vision is open, got ${JSON.stringify(statusJson.next_actions, null, 2)}`,
    );

    // Run continuous mode
    const run = runContinuousCli(dir);
    const combined = `${run.stdout || ''}${run.stderr || ''}`;

    assert.equal(run.status, 0, `BUG-77 command-chain run must exit cleanly:\n${combined}`);

    // Must NOT show idle exit / "All vision goals appear addressed"
    assert.doesNotMatch(combined, /All vision goals appear addressed/i,
      'Must not claim all vision goals are addressed when VISION has unplanned V2/V3 scope');
    assert.doesNotMatch(combined, /no derivable work from vision/i,
      'Must not claim no derivable work when VISION has unplanned scope');

    // Must show roadmap-replenishment dispatch
    assert.match(combined, /[Rr]oadmap.replenish|[Rr]oadmap.exhausted.*vision/,
      'Must log roadmap-replenishment or roadmap-exhausted-vision-open dispatch');
    assert.match(combined, /Run 1\/1 completed/,
      'Must complete a governed run for the replenishment intent');

    // Session must show runs_completed >= 1 (not 0)
    const session = readJson(join(dir, '.agentxchain', 'continuous-session.json'));
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 1, 'roadmap replenishment must produce a real governed run, not idle with runs_completed: 0');
    assert.ok(session.current_vision_objective, 'current_vision_objective must be set');

    // Intake must have a roadmap-replenishment intent
    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    const intents = readdirSync(intentsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(join(intentsDir, name)));
    assert.ok(intents.some((intent) => /^\[roadmap-replenishment\]/.test(intent.charter || '')),
      `expected a roadmap-replenishment intent, got charters: ${intents.map(i => i.charter).join('; ')}`);
    const replenishmentIntent = intents.find((intent) => /^\[roadmap-replenishment\]/.test(intent.charter || ''));
    assert.equal(replenishmentIntent.preferred_role, 'pm',
      'roadmap-replenishment intent must explicitly prefer PM so stale/default routing cannot dispatch dev');
    assert.equal(replenishmentIntent.phase_scope, 'planning',
      'roadmap-replenishment intent must be scoped to planning work');
    assert.ok(
      replenishmentIntent.history.some((entry) => entry.to === 'executing' && entry.role === 'pm'),
      `roadmap-replenishment execution must dispatch PM, got history: ${JSON.stringify(replenishmentIntent.history, null, 2)}`,
    );

    // Proof agent must have executed
    assert.ok(existsSync(join(dir, '.planning', 'bug77-replenishment-proof.md')),
      'local_cli proof agent must have executed against the replenishment objective');
  });
});
