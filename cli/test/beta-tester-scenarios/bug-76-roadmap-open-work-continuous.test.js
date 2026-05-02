/**
 * BUG-76 beta-tester scenario: continuous vision mode must not idle/complete
 * when ROADMAP.md contains unchecked Mxx milestone work.
 *
 * Reproduction class:
 *   `agentxchain run --continuous --vision .planning/VISION.md --max-runs 1
 *    --max-idle-cycles 1` reported completed with runs_completed=0 and no
 *   objective even though tusq.dev ROADMAP.md contained unchecked M28/M29.
 *
 * This command-chain test proves the CLI-owned continuous path derives and
 * executes a roadmap-backed objective before falling back to vision idle.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

function createRoadmapProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug76-cli-'));
  tempDirs.push(dir);

  const agentPath = join(dir, '_bug76-agent.mjs');
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
    "const relPath = '.planning/bug76-roadmap-objective.md';",
    "const productRelPath = 'src/bug76-roadmap-objective.js';",
    "const absPath = join(root, relPath);",
    "const productAbsPath = join(root, productRelPath);",
    "mkdirSync(dirname(absPath), { recursive: true });",
    "mkdirSync(dirname(productAbsPath), { recursive: true });",
    "writeFileSync(absPath, `# BUG-76 Roadmap Objective\\n\\n${objective}\\n`);",
    "writeFileSync(productAbsPath, `export const bug76RoadmapObjective = ${JSON.stringify(objective)};\\n`);",
    'const result = {',
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    "  role: 'dev',",
    '  runtime_id: runtimeId,',
    "  status: 'completed',",
    "  summary: `Completed ${objective}`,",
    "  decisions: [{ id: 'DEC-001', category: 'implementation', statement: `Completed ${objective}`, rationale: 'BUG-76 command-chain proof.' }],",
    '  objections: [],',
    '  files_changed: [relPath, productRelPath],',
    '  artifacts_created: [relPath, productRelPath],',
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
    "console.log(`bug76-agent completed ${objective}`);",
    '',
  ].join('\n'));

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug76-cli-test', id: `bug76-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement roadmap work.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev', runtime: 'local-dev' },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [agentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: 'run_completed_with_open_roadmap',
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
  writeFileSync(join(dir, '.planning', 'VISION.md'), '# Vision\n\n## V2 Scope\n\n- broad future scope\n');
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), [
    '# Roadmap',
    '',
    '### M28: Static Sensitivity Class Inference from Manifest Evidence (~0.5 day)',
    '- [ ] Add classifySensitivity(capability) pure deterministic function',
    '',
    '### M29: Static Auth Requirements Inference from Manifest Evidence (~0.5 day)',
    '- [ ] Add classifyAuthRequirements(capability)',
    '',
  ].join('\n'));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "bug76@test.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "BUG-76 Test"', { cwd: dir, stdio: 'ignore' });
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

describe('BUG-76: continuous mode consumes unchecked roadmap work', () => {
  it('CLI-owned run --continuous starts M28 instead of completing idle with zero runs', () => {
    const dir = createRoadmapProject();
    const statusBefore = spawnSync(process.execPath, [CLI_BIN, 'status', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(statusBefore.status, 0, `status --json must succeed:\n${statusBefore.stdout}\n${statusBefore.stderr}`);
    const statusJson = JSON.parse(statusBefore.stdout);
    assert.ok(
      statusJson.next_actions.some((action) => action.type === 'roadmap_open_work_detected' && /M28:/.test(action.reason)),
      `status --json must surface roadmap-open-work next action, got ${JSON.stringify(statusJson.next_actions, null, 2)}`,
    );

    const run = runContinuousCli(dir);
    const combined = `${run.stdout || ''}${run.stderr || ''}`;

    assert.equal(run.status, 0, `BUG-76 command-chain run must exit cleanly:\n${combined}`);
    assert.match(combined, /Roadmap-derived: M28:/);
    assert.match(combined, /Run 1\/1 completed/);
    assert.doesNotMatch(combined, /no derivable work from vision/i);
    assert.doesNotMatch(combined, /All vision goals appear addressed/i);

    const session = readJson(join(dir, '.agentxchain', 'continuous-session.json'));
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 1, 'open roadmap work must produce a real governed run');
    assert.match(session.current_vision_objective, /^M28:/);

    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    const intents = readdirSync(intentsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(join(intentsDir, name)));
    assert.ok(intents.some((intent) => /^\[roadmap\] M28:/.test(intent.charter || '')),
      `expected a roadmap-backed M28 intent, got ${JSON.stringify(intents, null, 2)}`);

    assert.ok(existsSync(join(dir, '.planning', 'bug76-roadmap-objective.md')),
      'local_cli proof agent must have executed against the roadmap objective');
  });
});
