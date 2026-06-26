import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  dispatchLocalCli,
  saveDispatchLogs,
} from '../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-cost-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeClaudeShim(root, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, 'claude');
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_cost_test',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_cost_001',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 600000).toISOString(),
      runtime_id: 'local-claude',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides,
  };
}

function makeConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-cost', name: 'Cost Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-claude',
      },
    },
    runtimes: {
      'local-claude': {
        type: 'local_cli',
        command: ['node', '-e', 'console.log("hello")'],
        cwd: '.',
        ...runtimeOverrides,
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
  };
}

function makeValidTurnResult(state) {
  const turn = state.current_turn;
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Implemented feature.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['npm test'], evidence_summary: 'Tests pass.' },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function setupDispatchBundle(root, state, config) {
  writeDispatchBundle(root, state, config);
}

const STREAM_JSON_RESULT_EVENT = {
  type: 'result',
  subtype: 'success',
  cost_usd: 0.456,
  duration_ms: 60000,
  is_error: false,
  num_turns: 1,
  session_id: 'sess_test',
  usage: {
    input_tokens: 15000,
    output_tokens: 8000,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 1200,
  },
  result: 'Done.',
  model: 'claude-opus-4-6',
};

let tmpDirs = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('local-cli cost tracking', () => {

  // AT-COST-007: Adapter enriches turn result cost from stream-json
  it('AT-COST-007: adapter enriches turn result cost from stream-json output', async () => {
    const root = createAndTrack();
    const state = makeState();
    const turnResult = makeValidTurnResult(state);
    const resultEvent = JSON.stringify(STREAM_JSON_RESULT_EVENT);

    // Script: emits stream-json events to stdout, then writes staged result
    const script = `
      const fs = require('fs');
      const path = require('path');

      // Emit non-JSON diagnostic text (like real Claude Code does)
      process.stdout.write('Initializing session...\\n');
      // Emit a content event
      process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'assistant', message: 'working' }))} + '\\n');
      // Emit the result event with usage metadata
      process.stdout.write(${JSON.stringify(resultEvent)} + '\\n');

      // Write staged turn result (with zero cost, as agents typically report)
      const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagingDir, 'turn-result.json'),
        JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
      );
    `;
    const scriptPath = join(root, '_stream_json_agent.js');
    writeFileSync(scriptPath, script);

    // Claude shim wraps the node script — binary name ends with /claude
    // so isClaudeLocalCliRuntime returns true
    const shim = writeClaudeShim(root, `#!/bin/sh\nexec node "${scriptPath}"\n`);

    const config = makeConfig({
      command: [shim, '--print', '--output-format', 'stream-json', '--verbose', '--bare'],
      prompt_transport: 'stdin',
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, true, `dispatch should succeed: ${result.error}`);

    // Read the enriched staged result
    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.cost.input_tokens, 15000);
    assert.equal(staged.cost.output_tokens, 8000);
    assert.equal(staged.cost.source, 'stream_json');
    assert.equal(staged.cost.model, 'claude-opus-4-6');
    assert.equal(staged.cost.usd, 0.456); // prefers cost_usd from result event
    assert.equal(staged.cost.cache_creation_input_tokens, 500);
    assert.equal(staged.cost.cache_read_input_tokens, 1200);

    // Verify diagnostic log
    const logText = result.logs.join('');
    assert.ok(logText.includes('stream_json_cost_enriched'), 'should log cost enrichment diagnostic');
  });

  // AT-COST-008: Non-Claude runtime — no parsing
  it('AT-COST-008: non-Claude runtime does not trigger cost parsing', async () => {
    const root = createAndTrack();
    const state = makeState({
      current_turn: {
        turn_id: 'turn_cost_002',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 600000).toISOString(),
        runtime_id: 'local-node',
      },
    });
    const turnResult = makeValidTurnResult(state);
    turnResult.turn_id = state.current_turn.turn_id;
    turnResult.runtime_id = state.current_turn.runtime_id;

    // Script: emits what looks like a stream-json result event + writes staged result
    const resultEvent = JSON.stringify(STREAM_JSON_RESULT_EVENT);
    const script = `
      const fs = require('fs');
      const path = require('path');
      process.stdout.write(${JSON.stringify(resultEvent)} + '\\n');
      const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagingDir, 'turn-result.json'),
        JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
      );
    `;
    const scriptPath = join(root, '_non_claude_agent.js');
    writeFileSync(scriptPath, script);

    // Use a plain "node" command — NOT named "claude", so isClaudeLocalCliRuntime = false
    const config = makeConfig({
      command: ['node', scriptPath],
    });
    config.runtimes['local-node'] = config.runtimes['local-claude'];
    config.runtimes['local-node'].command = ['node', scriptPath];
    config.roles.dev.runtime_id = 'local-node';
    setupDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, true, `dispatch should succeed: ${result.error}`);

    // Cost should remain as the agent reported (unchanged), no enrichment
    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.cost.input_tokens, 0, 'agent-reported cost preserved');
    assert.equal(staged.cost.output_tokens, 0, 'agent-reported cost preserved');
    assert.equal(staged.cost.usd, 0, 'agent-reported cost preserved');
    assert.ok(!staged.cost.source, 'should NOT have stream_json source marker');

    // No cost enrichment diagnostic
    const logText = result.logs.join('');
    assert.ok(!logText.includes('stream_json_cost_enriched'), 'should NOT log cost enrichment');
  });

  // AT-COST-009: Fallback to agent cost on parse failure
  it('AT-COST-009: preserves agent-reported cost when no result event in stdout', async () => {
    const root = createAndTrack();
    const state = makeState();
    const turnResult = makeValidTurnResult(state);
    turnResult.cost = { input_tokens: 999, output_tokens: 444, usd: 0.55 };

    // Script: emits no stream-json result event, just noise + staged result
    const script = `
      const fs = require('fs');
      const path = require('path');
      process.stdout.write('Just some plain text output\\n');
      process.stdout.write('No JSON events here\\n');
      const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagingDir, 'turn-result.json'),
        JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
      );
    `;
    const scriptPath = join(root, '_no_result_event.js');
    writeFileSync(scriptPath, script);

    const shim = writeClaudeShim(root, `#!/bin/sh\nexec node "${scriptPath}"\n`);
    const config = makeConfig({
      command: [shim, '--print', '--output-format', 'stream-json', '--verbose', '--bare'],
      prompt_transport: 'stdin',
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, true, `dispatch should succeed: ${result.error}`);

    // Agent's self-reported cost should be preserved (no enrichment)
    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.cost.input_tokens, 999);
    assert.equal(staged.cost.output_tokens, 444);
    assert.equal(staged.cost.usd, 0.55);
    assert.ok(!staged.cost.source, 'should NOT have stream_json source marker');

    // No cost enrichment diagnostic (parser returned null)
    const logText = result.logs.join('');
    assert.ok(!logText.includes('stream_json_cost_enriched'), 'should NOT log cost enrichment');
  });

  // AT-COST-007b: USD falls back to bundled rate calculation when cost_usd absent
  it('AT-COST-007b: calculates USD from bundled rates when result event lacks cost_usd', async () => {
    const root = createAndTrack();
    const state = makeState();
    const turnResult = makeValidTurnResult(state);

    const resultEventNoCostUsd = JSON.stringify({
      type: 'result',
      subtype: 'success',
      duration_ms: 30000,
      is_error: false,
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
      model: 'claude-opus-4-6',
    });

    const script = `
      const fs = require('fs');
      const path = require('path');
      process.stdout.write(${JSON.stringify(resultEventNoCostUsd)} + '\\n');
      const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagingDir, 'turn-result.json'),
        JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
      );
    `;
    const scriptPath = join(root, '_rate_calc_agent.js');
    writeFileSync(scriptPath, script);

    const shim = writeClaudeShim(root, `#!/bin/sh\nexec node "${scriptPath}"\n`);
    const config = makeConfig({
      command: [shim, '--print', '--output-format', 'stream-json', '--verbose', '--bare'],
      prompt_transport: 'stdin',
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, true, `dispatch should succeed: ${result.error}`);

    // claude-opus-4-6: input $5/M, output $25/M
    // (1M/1M)*5 + (1M/1M)*25 = 30
    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.cost.usd, 30);
    assert.equal(staged.cost.source, 'stream_json');
    assert.equal(staged.cost.input_tokens, 1_000_000);
    assert.equal(staged.cost.output_tokens, 1_000_000);
  });

  // AT-COST-012: Budget tracking reflects parsed cost
  // This test verifies the enriched staged result has the right shape for
  // governed-state acceptTurn to read and apply to budget_status.spent_usd.
  // Full budget integration is an orchestrator concern — here we verify the
  // adapter produces the correct cost shape that acceptTurn consumes.
  it('AT-COST-012: enriched cost has the shape consumed by governed-state acceptTurn', async () => {
    const root = createAndTrack();
    const state = makeState();
    const turnResult = makeValidTurnResult(state);
    const resultEvent = JSON.stringify(STREAM_JSON_RESULT_EVENT);

    const script = `
      const fs = require('fs');
      const path = require('path');
      process.stdout.write(${JSON.stringify(resultEvent)} + '\\n');
      const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(
        path.join(stagingDir, 'turn-result.json'),
        JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
      );
    `;
    const scriptPath = join(root, '_budget_agent.js');
    writeFileSync(scriptPath, script);

    const shim = writeClaudeShim(root, `#!/bin/sh\nexec node "${scriptPath}"\n`);
    const config = makeConfig({
      command: [shim, '--print', '--output-format', 'stream-json', '--verbose', '--bare'],
      prompt_transport: 'stdin',
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, true);

    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));

    // Verify the cost object has all fields that governed-state.js acceptTurn reads
    assert.ok(typeof staged.cost === 'object', 'cost must be an object');
    assert.ok(Number.isFinite(staged.cost.input_tokens), 'input_tokens must be a finite number');
    assert.ok(Number.isFinite(staged.cost.output_tokens), 'output_tokens must be a finite number');
    assert.ok(Number.isFinite(staged.cost.usd), 'usd must be a finite number');
    assert.ok(staged.cost.usd > 0, 'usd must be positive for a real cost');
    assert.equal(staged.cost.source, 'stream_json', 'source must be stream_json');
  });
});
